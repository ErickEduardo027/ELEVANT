using System.Text.Json;
using Elevant.Application.Finance;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Operations;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

/// <summary>An approved service with the charges its delivery evidence froze.</summary>
internal sealed record ChargeableService(long ServiceId, long OperationId, long TurnaroundId, long? ContractServiceRateId,
    DateOnly OperationDate, decimal ExecutedQuantity, decimal ServiceAmount, IReadOnlyList<ServiceChargeEvidence> Charges, DateTimeOffset? SubmittedAt = null, ServiceTimingEvidence? Timing = null, bool HasPackageCoverage = false);

internal sealed record ValuedCharge(long ServiceId, long ChargeDefinitionId, string Code, string Name, string? BillingUnit,
    decimal Quantity, decimal UnitPrice, decimal Amount, bool IsExcluded);

internal sealed record ChargeValuationResult(IReadOnlyList<ValuedCharge> Charges, string? BlockingReason);

/// <summary>
/// Values the charges marked on approved services in the preinvoice currency: the
/// contract's negotiated rate wins over the Finance charge tariff in force on the
/// operation date; a tariff in the other currency is converted with that day's rate.
/// </summary>
internal static class FinanceChargeValuation
{
    public static async Task<ChargeValuationResult> ValueAsync(ElevantDbContext context, string currency,
        IReadOnlyList<ChargeableService> services, CancellationToken cancellationToken)
    {
        var marks = services.SelectMany(service => service.Charges.Select(charge => (service, charge))).ToArray();
        if (marks.Length == 0) return new ChargeValuationResult([], null);

        var chargeIds = marks.Select(mark => mark.charge.ChargeId).Distinct().ToArray();
        var definitions = await context.ChargeDefinitions.AsNoTracking()
            .Where(charge => chargeIds.Contains(charge.PublicId)).ToDictionaryAsync(charge => charge.PublicId, cancellationToken);
        if (definitions.Count != chargeIds.Length) return new ChargeValuationResult([], "charge_definition_missing");

        var rateIds = services.Where(service => service.ContractServiceRateId != null)
            .Select(service => service.ContractServiceRateId!.Value).Distinct().ToArray();
        var versionByRate = await context.ContractServiceRates.AsNoTracking().Where(rate => rateIds.Contains(rate.Id))
            .ToDictionaryAsync(rate => rate.Id, rate => rate.ContractVersionId, cancellationToken);
        var versionIds = versionByRate.Values.Distinct().ToArray();
        var pricingVersions = await context.ContractVersions.AsNoTracking().Where(v => versionIds.Contains(v.Id)).ToDictionaryAsync(v => v.Id, v => v.PricingPolicyVersion, cancellationToken);
        var negotiated = (await context.ContractChargeRates.AsNoTracking()
                .Where(rate => versionIds.Contains(rate.ContractVersionId)).ToArrayAsync(cancellationToken))
            .ToDictionary(rate => (rate.ContractVersionId, rate.ChargeDefinitionId));

        var measurements = await MeasureAsync(context, services, cancellationToken);
        var otherCurrency = currency == "USD" ? "DOP" : "USD";
        var baseCache = new Dictionary<(string, DateOnly), IReadOnlyDictionary<long, FinanceTariffLookup.BaseChargeRate>>();
        async Task<IReadOnlyDictionary<long, FinanceTariffLookup.BaseChargeRate>> BaseAsync(string code, DateOnly date)
        {
            if (!baseCache.TryGetValue((code, date), out var rates))
                baseCache[(code, date)] = rates = await FinanceTariffLookup.ChargeRatesAsync(context, code, date, cancellationToken);
            return rates;
        }

        var valued = new List<ValuedCharge>();
        foreach (var (service, mark) in marks)
        {
            var definition = definitions[mark.ChargeId];
            var policy = new ContractChargePolicySnapshot(definition.Code, definition.Name, definition.BillingUnit, definition.Method, definition.QuantityRule, definition.GraceMinutes, definition.RoundingIncrement);
            var modern = service.ContractServiceRateId is { } sourceRate && versionByRate.TryGetValue(sourceRate, out var sourceVersion) && pricingVersions.GetValueOrDefault(sourceVersion) > 0;
            decimal? value = null;
            var minimum = 0m;
            var excluded = false;
            if (service.ContractServiceRateId is { } rateId && versionByRate.TryGetValue(rateId, out var versionId) &&
                negotiated.TryGetValue((versionId, definition.Id), out var contractRate))
            {
                excluded = contractRate.IsExcluded;
                value = contractRate.Value;
                minimum = contractRate.MinimumAmount ?? 0m;
                if (modern)
                {
                    if (contractRate.DefinitionSnapshotJson is null) return new([], "contract_charge_policy_missing");
                    try { var frozen = JsonSerializer.Deserialize<ContractChargePolicySnapshot>(contractRate.DefinitionSnapshotJson); if (frozen is null) return new([], "contract_charge_policy_invalid"); policy = frozen; }
                    catch (JsonException) { return new([], "contract_charge_policy_invalid"); }
                }
            }
            if (modern && !excluded && value is null) return new([], "contract_charge_rate_missing");
            if (!excluded && value is null)
            {
                var percent = policy.Method == ChargeCalculationMethod.PercentOfService;
                if ((await BaseAsync(currency, service.OperationDate)).TryGetValue(definition.Id, out var own))
                {
                    value = own.Value;
                    minimum = own.MinimumAmount;
                }
                else if ((await BaseAsync(otherCurrency, service.OperationDate)).TryGetValue(definition.Id, out var foreign))
                {
                    var rate = await FinanceTariffLookup.ExchangeRateAsync(context, otherCurrency, currency,
                        service.OperationDate, cancellationToken);
                    if (rate is null) return new ChargeValuationResult([], "exchange_rate_missing");
                    value = percent ? foreign.Value : FinanceChargePricingPolicy.Convert(foreign.Value, rate.Value);
                    minimum = FinanceChargePricingPolicy.Convert(foreign.MinimumAmount, rate.Value);
                }
            }
            if (excluded)
            {
                valued.Add(new ValuedCharge(service.ServiceId, definition.Id, policy.Code, policy.Name,
                    policy.BillingUnit, 0m, 0m, 0m, true));
                continue;
            }
            // A package has no allocated per-service percentage basis. Use the approved contract policy,
            // after exclusions, so catalog edits cannot change eligibility or silently price against zero.
            if (service.HasPackageCoverage && policy.Method == ChargeCalculationMethod.PercentOfService)
                return new([], "package_percentage_basis_required");
            var pricing = FinanceChargePricingPolicy.Price(new ChargePricingInput(policy.Method, policy.QuantityRule,
                policy.GraceMinutes, policy.RoundingIncrement,
                measurements.GetValueOrDefault((service.ServiceId, policy.QuantityRule)),
                service.ExecutedQuantity, service.ServiceAmount, value, minimum));
            if (!pricing.Ready) return new ChargeValuationResult([], pricing.BlockingReason);
            valued.Add(new ValuedCharge(service.ServiceId, definition.Id, policy.Code, policy.Name,
                policy.BillingUnit, pricing.Quantity, pricing.UnitPrice, pricing.Amount, false));
        }
        return new ChargeValuationResult(valued, null);
    }

    /// <summary>Recorded minutes per service and rule: service duration, operation overrun and arrival delay.</summary>
    private static async Task<IReadOnlyDictionary<(long, ChargeQuantityRule), decimal?>> MeasureAsync(
        ElevantDbContext context, IReadOnlyList<ChargeableService> services, CancellationToken cancellationToken)
    {
        var serviceIds = services.Select(service => service.ServiceId).ToArray();
        var operationIds = services.Select(service => service.OperationId).Distinct().ToArray();
        var turnaroundIds = services.Select(service => service.TurnaroundId).Distinct().ToArray();
        var events = (await context.Set<Elevant.Domain.Entities.Operations.OperationServiceStatusEvent>().AsNoTracking()
                .Where(item => serviceIds.Contains(item.OperationServiceId)).OrderBy(item => item.OccurredAt)
                .ToArrayAsync(cancellationToken))
            .ToLookup(item => item.OperationServiceId);
        var operations = await context.GroundOperations.AsNoTracking().Where(item => operationIds.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id, item => new { item.PlannedEndAt, item.ActualEndAt }, cancellationToken);
        var arrivals = (await context.FlightLegs.AsNoTracking()
                .Where(leg => turnaroundIds.Contains(leg.TurnaroundId) && leg.Direction == FlightDirection.Arrival)
                .ToArrayAsync(cancellationToken))
            .GroupBy(leg => leg.TurnaroundId).ToDictionary(group => group.Key, group => group.First());

        static decimal? Minutes(DateTimeOffset? from, DateTimeOffset? to) =>
            from is { } start && to is { } end ? Math.Max(0m, (decimal)(end - start).TotalMinutes) : null;

        var result = new Dictionary<(long, ChargeQuantityRule), decimal?>();
        foreach (var service in services)
        {
            if (service.Timing is { } frozen)
            {
                result[(service.ServiceId, ChargeQuantityRule.ServiceDuration)] = frozen.ServiceMinutes;
                result[(service.ServiceId, ChargeQuantityRule.OperationOverrun)] = frozen.OperationOverrunMinutes;
                result[(service.ServiceId, ChargeQuantityRule.ArrivalDelay)] = frozen.ArrivalDelayMinutes;
                continue;
            }
            var serviceEvents = events[service.ServiceId].Where(item => service.SubmittedAt == null || item.OccurredAt <= service.SubmittedAt).ToArray();
            var started = serviceEvents.LastOrDefault(item => item.ToStatus == ServiceExecutionStatus.InProgress)?.OccurredAt;
            var finished = serviceEvents.LastOrDefault(item => item.ToStatus is ServiceExecutionStatus.Completed or
                ServiceExecutionStatus.Exception && item.OccurredAt >= started)?.OccurredAt;
            result[(service.ServiceId, ChargeQuantityRule.ServiceDuration)] = Minutes(started, finished);
            var operation = operations.GetValueOrDefault(service.OperationId);
            result[(service.ServiceId, ChargeQuantityRule.OperationOverrun)] =
                Minutes(operation?.PlannedEndAt, operation?.ActualEndAt);
            var arrival = arrivals.GetValueOrDefault(service.TurnaroundId);
            result[(service.ServiceId, ChargeQuantityRule.ArrivalDelay)] = Minutes(arrival?.ScheduledAt, arrival?.ActualAt);
        }
        return result;
    }
}
