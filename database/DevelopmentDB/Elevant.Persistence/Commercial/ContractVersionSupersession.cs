using System.Globalization;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Commercial;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

/// <summary>
/// A version starts to govern at its second signature (2-C): the approved versions it replaces become
/// <c>Superseded</c> and end the day before it starts (never later than they already ended), and the
/// flights still bound to them on or after that start, not executed yet, move to it with their planned
/// lines at the signed rates. Executed services keep the rate they were captured with.
/// </summary>
internal static class ContractVersionSupersession
{
    public static async Task ApplyAsync(ElevantDbContext context, ContractVersion next, long actor, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        // 2-N12: the coverage end moves with the version that now governs, so its expiry notice restarts.
        var contract = await context.Contracts.SingleAsync(item => item.Id == next.ContractId, cancellationToken);
        contract.ExpiryNoticeSentAt = null;
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
        await RebindFlightsAsync(context, replaced.Select(item => item.Id).ToArray(), next, now, cancellationToken);
        // OCC re-reads «Contratos listos» and the planning of the stations the version covers.
        foreach (var station in await (from link in context.Set<ContractVersionStation>().AsNoTracking()
                                       join item in context.Stations.AsNoTracking() on link.StationId equals item.Id
                                       where link.ContractVersionId == next.Id
                                       select new { item.Id, item.PublicId }).ToArrayAsync(cancellationToken))
            await OccPlanningChangeWriter.AddForStationAsync(context, station.Id, station.PublicId, now, cancellationToken);
    }

    /// <summary>
    /// Flights of the replaced versions dated within the new one, at one of its stations, scheduled or
    /// confirmed, whose operations have not started. A flight without planned lines moves; planned lines
    /// move only when each one has the same service at the same position among the signed rates (the order
    /// OCC materializes them in). Otherwise the flight keeps the binding and the prices it was planned with.
    /// </summary>
    private static async Task RebindFlightsAsync(ElevantDbContext context, long[] replaced, ContractVersion next,
        DateTimeOffset now, CancellationToken cancellationToken)
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
            if (lines.Any(line => line.CurrentStatus != ServiceExecutionStatus.Planned || line.ExecutedQuantity != 0m ||
                    line.LineNumber < 1 || line.LineNumber > signedRates.Length ||
                    signedRates[line.LineNumber - 1].ServiceDefinitionId != line.ServiceDefinitionId))
                continue;
            foreach (var line in lines)
            {
                var rate = signedRates[line.LineNumber - 1];
                line.ContractServiceRateId = rate.Id;
                line.BillingUnitSnapshot = rate.BillingUnit;
                line.UnitPriceSnapshot = rate.UnitPrice;
                line.CurrencyCodeSnapshot = next.CurrencyCode;
                line.ContractedQuantity = rate.MinimumQuantity;
                line.UpdatedAt = now;
            }
            flight.ContractVersionId = next.Id;
            flight.UpdatedAt = now;
        }
    }

    private static string? Text(DateOnly? day) => day?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
}
