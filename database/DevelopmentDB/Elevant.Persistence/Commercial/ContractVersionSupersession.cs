using System.Globalization;
using System.Text.Json;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Commercial;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Operations;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

/// <summary>
/// A version starts to govern at its second signature (2-C): the approved versions it replaces become
/// <c>Superseded</c> and end the day before it starts (never later than they already ended), and the
/// flights still bound to them on or after that start, not executed yet, move to it with their planned
/// lines rebuilt from the signed rates. Executed services keep the rate they were captured with.
/// </summary>
internal static class ContractVersionSupersession
{
    /// <summary>Audit action of an operation whose planned services changed with the version that now governs.</summary>
    public const string ServicesReplannedAction = "occ.operation.services_replanned";

    public static async Task ApplyAsync(ElevantDbContext context, ContractVersion next, long actor, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var contract = await context.Contracts.SingleAsync(item => item.Id == next.ContractId, cancellationToken);
        // The ends the contract was covered until before this second signature: the other versions that govern and,
        // as the legacy exemption (the first approved version of a contract that left Draft), this one already.
        var ends = await GoverningContractVersions.Of(context).AsNoTracking()
            .Where(item => item.ContractId == next.ContractId && item.Id != next.Id)
            .Select(item => new { item.Id, item.ValidTo })
            .ToDictionaryAsync(item => item.Id, item => item.ValidTo, cancellationToken);
        var firstApproved = !await context.ContractVersions.AsNoTracking().AnyAsync(earlier =>
            earlier.ContractId == next.ContractId && earlier.VersionNumber < next.VersionNumber &&
            (earlier.Status == ContractVersionStatus.Approved || earlier.Status == ContractVersionStatus.Superseded),
            cancellationToken);
        var coveredUntil = ContractVersionGovernance.CoverageEnd(
            ContractVersionGovernance.Governs(ContractVersionStatus.Approved, false, firstApproved, contract.Status)
                ? ends.Values.Append(next.ValidTo) : ends.Values);
        var replaced = await context.ContractVersions.Where(item => item.ContractId == next.ContractId &&
                item.Id != next.Id && item.Status == ContractVersionStatus.Approved && item.ValidFrom < next.ValidFrom)
            .ToArrayAsync(cancellationToken);
        foreach (var version in replaced)
        {
            var end = ContractVersionGovernance.SupersededEnd(version.ValidTo, next.ValidFrom);
            CommercialAuditWriter.Add(context, actor, "commercial.contract.version_superseded", "commercial.contract_versions",
                version.PublicId, null,
                new AuditFieldChangeData("version.status", nameof(ContractVersionStatus.Approved),
                    nameof(ContractVersionStatus.Superseded)),
                new AuditFieldChangeData("version.valid_to", Text(version.ValidTo), Text(end)));
            version.Status = ContractVersionStatus.Superseded;
            version.ValidTo = end;
            version.UpdatedAt = now;
        }
        // 2-N12: the expiry notice restarts only when the coverage end moves. A renewal moves it; an amendment that
        // keeps the end of the version it replaces does not, so the airline is never told twice about the same end.
        // Every replaced version governs from now on as superseded, with the end it keeps.
        foreach (var version in replaced.Append(next)) ends[version.Id] = version.ValidTo;
        if (ContractVersionGovernance.CoverageEnd(ends.Values) != coveredUntil) contract.ExpiryNoticeSentAt = null;
        await RebindFlightsAsync(context, replaced.Select(item => item.Id).ToArray(), next, actor, now, cancellationToken);
        // OCC re-reads «Contratos listos» and the planning of the stations the version covers.
        foreach (var station in await (from link in context.Set<ContractVersionStation>().AsNoTracking()
                                       join item in context.Stations.AsNoTracking() on link.StationId equals item.Id
                                       where link.ContractVersionId == next.Id
                                       select new { item.Id, item.PublicId }).ToArrayAsync(cancellationToken))
            await OccPlanningChangeWriter.AddForStationAsync(context, station.Id, station.PublicId, now, cancellationToken);
    }

    /// <summary>
    /// Flights of the replaced versions dated within the new one, at one of its stations, scheduled or
    /// confirmed, whose operations have not started (planned, assigned or cancelled, every line still planned
    /// with nothing executed). The version they were planned with no longer covers those dates, so they always
    /// move: otherwise OCC could never plan them again. Their planned lines become the signed rates in the order
    /// OCC materializes them (<see cref="EfOccPlanningCommandStore"/>): a line whose position keeps its service
    /// takes the signed rate, a line whose position now holds another service (or none) is withdrawn, and an
    /// operation that already had lines gets a new one for every position left without a line. An operation
    /// without lines gets them when OCC assigns it. A flight with something executed keeps its binding and prices.
    /// </summary>
    private static async Task RebindFlightsAsync(ElevantDbContext context, long[] replaced, ContractVersion next,
        long actor, DateTimeOffset now, CancellationToken cancellationToken)
    {
        if (replaced.Length == 0) return;
        var stations = await context.Set<ContractVersionStation>().AsNoTracking()
            .Where(link => link.ContractVersionId == next.Id).Select(link => link.StationId).ToArrayAsync(cancellationToken);
        var flights = await context.Turnarounds.Where(item => item.ContractVersionId != null &&
                replaced.Contains(item.ContractVersionId.Value) && stations.Contains(item.StationId) &&
                item.OperationDate >= next.ValidFrom && (next.ValidTo == null || item.OperationDate <= next.ValidTo) &&
                (item.CurrentStatus == TurnaroundStatus.Scheduled || item.CurrentStatus == TurnaroundStatus.Confirmed))
            .ToArrayAsync(cancellationToken);
        if (flights.Length == 0) return;
        var signedRates = await (from rate in context.ContractServiceRates.AsNoTracking()
                                 join definition in context.ServiceDefinitions.AsNoTracking()
                                     on rate.ServiceDefinitionId equals definition.Id
                                 where rate.ContractVersionId == next.Id && definition.IsActive
                                 orderby definition.Name, definition.Code, definition.PublicId
                                 select rate).ToArrayAsync(cancellationToken);
        var replans = new List<OperationReplan>();
        foreach (var flight in flights)
        {
            var operations = await context.GroundOperations.Where(item => item.TurnaroundId == flight.Id)
                .ToArrayAsync(cancellationToken);
            if (operations.Any(item => item.CurrentStatus is not (GroundOperationStatus.Planned or
                    GroundOperationStatus.Assigned or GroundOperationStatus.Cancelled)))
                continue;
            var operationIds = operations.Select(item => item.Id).ToArray();
            var lines = await context.OperationServices.Where(item => operationIds.Contains(item.GroundOperationId))
                .ToArrayAsync(cancellationToken);
            if (lines.Any(line => line.CurrentStatus != ServiceExecutionStatus.Planned || line.ExecutedQuantity != 0m))
                continue;
            foreach (var operation in operations)
            {
                var planned = lines.Where(line => line.GroundOperationId == operation.Id).ToArray();
                if (planned.Length > 0)
                    replans.Add(ReplanLines(operation, flight.StationId, planned, signedRates, next.CurrencyCode, now));
            }
            flight.ContractVersionId = next.Id;
            flight.UpdatedAt = now;
        }
        await ApplyReplansAsync(context, replans, next, actor, now, cancellationToken);
    }

    private sealed record OperationReplan(GroundOperation Operation, long StationId, OperationService[] Withdrawn,
        OperationService[] Added);

    /// <summary>
    /// The planned lines of one operation against the signed rates: a kept line takes the signed rate and the
    /// contracted quantity exactly as OCC would materialize it; every other line is withdrawn, and each position
    /// without a kept line gets a new planned line.
    /// </summary>
    private static OperationReplan ReplanLines(GroundOperation operation, long stationId, OperationService[] planned,
        ContractServiceRate[] signedRates, string currencyCode, DateTimeOffset now)
    {
        var kept = new HashSet<int>();
        var withdrawn = new List<OperationService>();
        foreach (var line in planned.OrderBy(item => item.LineNumber))
        {
            var rate = line.LineNumber >= 1 && line.LineNumber <= signedRates.Length ? signedRates[line.LineNumber - 1] : null;
            if (rate is null || rate.ServiceDefinitionId != line.ServiceDefinitionId || !kept.Add(line.LineNumber))
            {
                withdrawn.Add(line);
                continue;
            }
            line.ContractServiceRateId = rate.Id;
            line.BillingUnitSnapshot = rate.BillingUnit;
            line.UnitPriceSnapshot = rate.UnitPrice;
            line.CurrencyCodeSnapshot = currencyCode;
            line.ContractedQuantity = rate.MinimumQuantity;
            line.UpdatedAt = now;
        }
        var added = signedRates.Select((rate, index) => (Rate: rate, LineNumber: index + 1))
            .Where(item => !kept.Contains(item.LineNumber))
            .Select(item => new OperationService
            {
                PublicId = Guid.CreateVersion7(), GroundOperationId = operation.Id, LineNumber = item.LineNumber,
                ServiceDefinitionId = item.Rate.ServiceDefinitionId, ContractServiceRateId = item.Rate.Id,
                ContractedQuantity = item.Rate.MinimumQuantity, ExecutedQuantity = 0m,
                BillingUnitSnapshot = item.Rate.BillingUnit, UnitPriceSnapshot = item.Rate.UnitPrice,
                CurrencyCodeSnapshot = currencyCode, CurrentStatus = ServiceExecutionStatus.Planned,
                CreatedAt = now, UpdatedAt = now,
            }).ToArray();
        return new OperationReplan(operation, stationId, [.. withdrawn], added);
    }

    /// <summary>
    /// Withdraws and adds the lines of the replanned operations, audits each operation whose services changed and
    /// tells the agent of an assigned operation that its services changed (OCC re-reads the station anyway).
    /// </summary>
    private static async Task ApplyReplansAsync(ElevantDbContext context, IReadOnlyList<OperationReplan> replans,
        ContractVersion next, long actor, DateTimeOffset now, CancellationToken cancellationToken)
    {
        if (replans.Count == 0) return;
        var withdrawn = replans.SelectMany(item => item.Withdrawn).ToArray();
        var added = replans.SelectMany(item => item.Added).ToArray();
        var definitionIds = withdrawn.Concat(added).Select(line => line.ServiceDefinitionId).Distinct().ToArray();
        var codes = await context.ServiceDefinitions.AsNoTracking().Where(item => definitionIds.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id, item => item.Code, cancellationToken);
        if (withdrawn.Length > 0)
        {
            // A planned line only carries the event of its materialization: it goes with the line, and the audit
            // below keeps the change. The lines leave before new ones take their positions (one line per position).
            var lineIds = withdrawn.Select(line => line.Id).ToArray();
            context.Set<OperationServiceStatusEvent>().RemoveRange(await context.Set<OperationServiceStatusEvent>()
                .Where(item => lineIds.Contains(item.OperationServiceId)).ToArrayAsync(cancellationToken));
            context.OperationServices.RemoveRange(withdrawn);
            await context.SaveChangesAsync(cancellationToken);
        }
        if (added.Length > 0)
        {
            context.OperationServices.AddRange(added);
            await context.SaveChangesAsync(cancellationToken);
            context.Set<OperationServiceStatusEvent>().AddRange(added.Select(line => new OperationServiceStatusEvent
            {
                OperationServiceId = line.Id, FromStatus = null, ToStatus = ServiceExecutionStatus.Planned, OccurredAt = now,
                Note = "Materialized from the contract version that governs since its second signature.",
            }));
        }
        foreach (var replan in replans)
        {
            if (replan.Withdrawn.Length > 0 || replan.Added.Length > 0)
                context.AuditEntries.Add(new AuditEntry
                {
                    PublicId = Guid.CreateVersion7(), OccurredAt = now, ActorType = AuditActorType.Account,
                    ActorAccountId = actor, Action = ServicesReplannedAction, EntityType = nameof(GroundOperation),
                    EntityPublicId = replan.Operation.PublicId, StationId = replan.StationId, Source = AuditSource.Api,
                    CorrelationId = Guid.CreateVersion7(),
                    Reason = $"La versión {next.VersionNumber} del contrato rige desde su segunda firma: " +
                        "los servicios planificados pasan a sus tarifas firmadas.",
                    MetadataJson = JsonSerializer.Serialize(new
                    {
                        contractVersionId = next.PublicId,
                        withdrawn = replan.Withdrawn.Select(line => codes[line.ServiceDefinitionId]).ToArray(),
                        added = replan.Added.Select(line => codes[line.ServiceDefinitionId]).ToArray(),
                    }),
                });
            if (replan.Operation.CurrentStatus == GroundOperationStatus.Assigned)
                await RampOperationChangeWriter.AnnounceAsync(context, replan.Operation.Id, now, false, cancellationToken);
        }
    }

    private static string? Text(DateOnly? day) => day?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
}
