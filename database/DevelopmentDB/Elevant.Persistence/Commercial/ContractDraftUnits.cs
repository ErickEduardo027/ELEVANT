using Elevant.Application.Commercial;
using Elevant.Application.Common;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Finance;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

/// <summary>
/// The one rule of the unit a service is billed with when it enters a contract draft (N31): the unit of Finance's base
/// rate for the draft's currency, start and stations (<see cref="ContractDraftRules.BaseStation"/>) or, when the service
/// has no base rate, its catalog unit, both as codes of <c>ref.billing_units</c> (1-E). The approval and the scope of a
/// draft start their rates with it, and a commercial request shows and keeps the unit its draft is born with.
/// </summary>
internal static class ContractDraftUnits
{
    /// <summary>Currency of the draft an approved request creates; Contratos may change it in the draft.</summary>
    public const string Currency = "USD";

    /// <summary>What a service's rate starts with in a draft: its unit and the Finance base rate, if it has one.</summary>
    public sealed record StartingRate(string BillingUnit, FinanceTariffLookup.BaseServiceRate? BaseRate);

    /// <summary>
    /// The starting rate of each service in <paramref name="serviceIds"/> for a draft in <paramref name="currency"/>
    /// that starts on <paramref name="validFrom"/> and covers <paramref name="stationIds"/>.
    /// </summary>
    public static async Task<IReadOnlyDictionary<long, StartingRate>> StartingRatesAsync(ElevantDbContext context,
        IReadOnlyCollection<long> serviceIds, string currency, DateOnly validFrom, IReadOnlyCollection<long> stationIds,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(serviceIds);
        var ids = serviceIds.Distinct().ToArray();
        if (ids.Length == 0) return new Dictionary<long, StartingRate>();
        var catalogUnits = await context.ServiceDefinitions.AsNoTracking().Where(service => ids.Contains(service.Id))
            .Select(service => new { service.Id, service.DefaultBillingUnit })
            .ToDictionaryAsync(service => service.Id, service => service.DefaultBillingUnit, cancellationToken);
        var baseRates = await FinanceTariffLookup.ServiceRatesAsync(context, currency, validFrom,
            ContractDraftRules.BaseStation(stationIds), ids, cancellationToken);
        var units = await BillingUnitCodes.LoadAsync(context, cancellationToken);
        return catalogUnits.ToDictionary(service => service.Key, service =>
            baseRates.GetValueOrDefault(service.Key) is { } baseRate
                ? new StartingRate(units.Normalize(baseRate.BillingUnit), baseRate)
                : new StartingRate(units.CodeOrDefault(service.Value), null));
    }

    /// <summary>
    /// The unit each service would have in the draft of a request approved at <paramref name="now"/>: USD, AVIAM's
    /// business day and, as a request has no stations until it is approved, the all-stations base rate.
    /// </summary>
    public static async Task<IReadOnlyDictionary<long, string>> RequestUnitsAsync(ElevantDbContext context,
        IReadOnlyCollection<long> serviceIds, DateTimeOffset now, CancellationToken cancellationToken) =>
        (await StartingRatesAsync(context, serviceIds, Currency, BusinessCalendar.Today(now), [], cancellationToken))
        .ToDictionary(service => service.Key, service => service.Value.BillingUnit);
}
