using Elevant.Persistence.Commercial;
using Elevant.Persistence.Operations;
using System.Globalization;
using System.Text.Json;
using Elevant.Application.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

internal sealed record PackageChargeableService(long ServiceId, long DefinitionId, long? RateId, long TurnaroundId, long SubmissionId, DateTimeOffset SubmittedAt, DateOnly OperationDate, decimal Quantity, string Unit, ServiceTimingEvidence? Timing = null);
internal sealed record PackageValuedService(long ServiceId, long ConsumptionId, long ComponentId, decimal Quantity, string Code, string Name, string Unit, decimal ExcessBlockPrice, FinancePackagePricing Price, string CalculationJson);
internal sealed record PackageValuation(string? BlockingReason, IReadOnlyDictionary<long, PackageValuedService> Services);

internal static class FinancePackageValuation
{
    /// <summary>Called inside the same serializable transaction that reserves preinvoice source lines.</summary>
    public static async Task<PackageValuation> ReserveAsync(ElevantDbContext context, long stationId, string currency, IReadOnlyList<PackageChargeableService> services, DateTimeOffset now, CancellationToken ct)
    {
        var rateIds = services.Where(x => x.RateId.HasValue).Select(x => x.RateId!.Value).ToArray();
        var contractRates = await context.ContractServiceRates.AsNoTracking().Where(x => rateIds.Contains(x.Id)).ToDictionaryAsync(x => x.Id, ct);
        var versionIds = contractRates.Values.Select(x => x.ContractVersionId).Distinct().ToArray();
        var versions = await context.ContractVersions.AsNoTracking().Where(x => versionIds.Contains(x.Id)).ToDictionaryAsync(x => x.Id, ct);
        var contractIds = versions.Values.Where(v => v.Status == ContractVersionStatus.Superseded).Select(v => v.ContractId).Distinct().ToArray();
        var replacements = await context.ContractVersions.AsNoTracking().Where(v => contractIds.Contains(v.ContractId) &&
            v.ApprovedAt != null && (v.Status == ContractVersionStatus.Approved || v.Status == ContractVersionStatus.Superseded)).ToArrayAsync(ct);
        // 2-C: a replacement takes over at its second signature; a legacy one (no signatures) at its approval.
        var secondSignatures = await GoverningContractVersions.SecondSignatureAtAsync(context,
            replacements.Select(v => v.Id).ToArray(), ct);
        DateTimeOffset? TakesOverAt(ContractVersion next) =>
            secondSignatures.TryGetValue(next.Id, out var signedAt) ? signedAt : next.ApprovedAt;
        var supersededIds = versions.Values.Where(v => v.Status == ContractVersionStatus.Superseded).Select(v => v.Id).ToHashSet();
        var historicalServiceIds = services.Where(s => s.RateId is { } id && contractRates.TryGetValue(id, out var r) &&
            supersededIds.Contains(r.ContractVersionId)).Select(s => s.ServiceId).ToArray();
        var completionEvents = (await context.Set<OperationServiceStatusEvent>().AsNoTracking()
            .Where(e => historicalServiceIds.Contains(e.OperationServiceId) &&
                (e.ToStatus == ServiceExecutionStatus.Completed || e.ToStatus == ServiceExecutionStatus.Exception))
            .OrderBy(e => e.OccurredAt).Select(e => new { e.OperationServiceId, e.OccurredAt }).ToArrayAsync(ct))
            .ToLookup(e => e.OperationServiceId);
        var bindings = await (from link in context.Set<ContractServicePackage>().AsNoTracking()
            join package in context.Set<ServicePackageVersion>().AsNoTracking() on link.PackageVersionId equals package.Id
            join component in context.Set<ServicePackageComponent>().AsNoTracking() on package.Id equals component.PackageVersionId
            where versionIds.Contains(link.ContractVersionId)
            select new { Link = link, Package = package, Component = component }).ToArrayAsync(ct);
        var result = new Dictionary<long, PackageValuedService>();
        var baseReserved = new HashSet<long>();
        var consumed = new Dictionary<(long Scope, long Component), decimal>();
        foreach (var source in services)
        {
            if (source.RateId is not { } rateId || !contractRates.TryGetValue(rateId, out var rate)) continue;
            var matches = bindings.Where(x => x.Link.ContractVersionId == rate.ContractVersionId && x.Component.ServiceDefinitionId == source.DefinitionId).ToArray();
            if (matches.Length == 0) continue;
            if (matches.Length != 1) return new("ambiguous_package_coverage", result);
            var binding = matches[0]; var package = binding.Package; var component = binding.Component;
            var contractVersion = versions[rate.ContractVersionId];
            // The second signature of a backdated amendment shortens an older version retrospectively. Preserve its
            // server-bound rate for execution already completed (or submitted) before it took over, including
            // evidence submitted after the amendment.
            var capturedAt = completionEvents[source.ServiceId].LastOrDefault(e => e.OccurredAt <= source.SubmittedAt)?.OccurredAt ?? source.SubmittedAt;
            var historicalExecution = contractVersion.Status == ContractVersionStatus.Superseded && contractVersion.ValidTo is { } intervalEnd &&
                replacements.Any(next => next.ContractId == contractVersion.ContractId && next.VersionNumber > contractVersion.VersionNumber &&
                    next.ValidFrom.DayNumber == intervalEnd.DayNumber + 1 && next.ValidFrom <= source.OperationDate && TakesOverAt(next) > capturedAt);
            if (contractVersion.Status is not (ContractVersionStatus.Approved or ContractVersionStatus.Superseded) ||
                package.CurrencyCode != currency || contractVersion.CurrencyCode != currency ||
                source.OperationDate < contractVersion.ValidFrom ||
                source.OperationDate > contractVersion.ValidTo && !historicalExecution)
                return new("package_contract_mismatch", result);
            string scopeKey;
            if (package.Scope == PackageConsumptionScope.Turnaround) scopeKey = "turnaround:" + source.TurnaroundId.ToString(CultureInfo.InvariantCulture);
            else if (package.Scope == PackageConsumptionScope.Flight)
            {
                var legs = await context.FlightLegs.AsNoTracking().Where(x => x.TurnaroundId == source.TurnaroundId && x.Direction == package.FlightDirection).Select(x => x.PublicId).ToArrayAsync(ct);
                if (legs.Length != 1) return new("package_flight_scope_ambiguous", result);
                scopeKey = "flight:" + legs[0].ToString("D");
            }
            else
            {
                if (package.PeriodDays is not (>= 1 and <= 366)) return new("package_period_missing", result);
                var period = (source.OperationDate.DayNumber - contractVersion.ValidFrom.DayNumber) / package.PeriodDays.Value;
                scopeKey = "period:" + contractVersion.ValidFrom.AddDays(period * package.PeriodDays.Value).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            }
            var consumption = await context.Set<PackageConsumption>().SingleOrDefaultAsync(x => x.ContractPackageId == binding.Link.Id && x.StationId == stationId && x.ScopeKey == scopeKey, ct);
            if (consumption is null)
            {
                consumption = new() { PublicId = Guid.CreateVersion7(), ContractPackageId = binding.Link.Id, StationId = stationId, ScopeKey = scopeKey, Revision = 1, CreatedAt = now, UpdatedAt = now };
                context.Add(consumption); await context.SaveChangesAsync(ct);
            }
            else
            {
                await context.Set<PackageConsumption>().Where(x => x.Id == consumption.Id).ExecuteUpdateAsync(s => s.SetProperty(x => x.Revision, x => x.Revision + 1).SetProperty(x => x.UpdatedAt, now), ct);
            }
            var history = await (from entry in context.Set<PackageConsumptionEntry>().AsNoTracking()
                join line in context.PreinvoiceLines.AsNoTracking() on entry.PreinvoiceLineId equals line.Id
                join draft in context.Preinvoices.AsNoTracking() on line.PreinvoiceId equals draft.Id
                where entry.ConsumptionId == consumption.Id && line.ReleasedAt == null
                select new { entry.ComponentId, entry.Quantity, entry.BaseAmount, draft.Status }).ToArrayAsync(ct);
            // A new draft cannot depend on unissued coverage that may still be voided.
            if (history.Any(x => x.Status != PreinvoiceStatus.Invoiced)) return new("package_scope_has_unissued_preinvoice", result);
            decimal quantity;
            if (component.BillingUnit is "minute" or "hour")
            {
                if (source.Timing is { } frozen)
                {
                    if (frozen.ServiceMinutes is not > 0) return new("package_measurement_missing", result);
                    quantity = decimal.Round(frozen.ServiceMinutes.Value / (component.BillingUnit == "hour" ? 60 : 1), 4, MidpointRounding.AwayFromZero);
                }
                else
                {
                var events = await context.Set<OperationServiceStatusEvent>().AsNoTracking().Where(x => x.OperationServiceId == source.ServiceId && x.OccurredAt <= source.SubmittedAt).OrderBy(x => x.OccurredAt).ToArrayAsync(ct);
                var start = events.LastOrDefault(x => x.ToStatus == ServiceExecutionStatus.InProgress)?.OccurredAt;
                var end = events.LastOrDefault(x => x.ToStatus == ServiceExecutionStatus.Completed || x.ToStatus == ServiceExecutionStatus.Exception)?.OccurredAt;
                if (start is null || end is null || end <= start) return new("package_measurement_missing", result);
                quantity = decimal.Round((decimal)(end.Value - start.Value).Ticks / TimeSpan.TicksPerMinute / (component.BillingUnit == "hour" ? 60 : 1), 4, MidpointRounding.AwayFromZero);
                }
            }
            else
            {
                if (component.BillingUnit != source.Unit) return new("package_unit_mismatch", result);
                quantity = source.Quantity;
            }
            var key = (consumption.Id, component.Id);
            var before = consumed.GetValueOrDefault(key, history.Where(x => x.ComponentId == component.Id).Sum(x => x.Quantity));
            var price = FinancePackagePricingPolicy.Price(package.BasePrice, component.IncludedQuantity, component.ExcessBlockSize, component.ExcessBlockPrice, before, quantity, baseReserved.Contains(consumption.Id) || history.Any(x => x.BaseAmount > 0));
            if (!price.Ready) return new(price.BlockingReason, result);
            consumed[key] = before + quantity; baseReserved.Add(consumption.Id);
            var calculation = JsonSerializer.Serialize(new { package = package.PublicId, package.Code, package.VersionNumber, scope = scopeKey, stationId, currency, quantity, unit = component.BillingUnit, consumedBefore = before, includedLimit = component.IncludedQuantity, component.ExcessBlockSize, component.ExcessBlockPrice, price.BaseAmount, price.IncludedQuantity, price.ExcessQuantity, price.ExcessBlocksAfter, price.ExcessAmount, total = price.Amount });
            result.Add(source.ServiceId, new(source.ServiceId, consumption.Id, component.Id, quantity, package.Code, package.Name, component.BillingUnit, component.ExcessBlockPrice, price, calculation));
        }
        return new(null, result);
    }
}
