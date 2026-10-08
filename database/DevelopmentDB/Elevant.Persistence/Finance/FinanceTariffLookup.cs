using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

/// <summary>Resolves the published Finance tariff that applied on a date.</summary>
internal static class FinanceTariffLookup
{
    public sealed record BaseServiceRate(long ServiceDefinitionId, string BillingUnit, decimal UnitPrice,
        decimal MinimumBillableQuantity);

    public sealed record BaseChargeRate(long ChargeDefinitionId, decimal Value, decimal MinimumAmount);

    /// <summary>Base service prices in a currency on a date; a station-specific price wins over the all-stations one.</summary>
    public static async Task<IReadOnlyDictionary<long, BaseServiceRate>> ServiceRatesAsync(ElevantDbContext context,
        string currency, DateOnly date, long? stationId, IReadOnlyCollection<long> serviceIds,
        CancellationToken cancellationToken)
    {
        var version = await context.ServiceTariffVersions.AsNoTracking()
            .Where(item => item.CurrencyCode == currency && item.Status != TariffVersionStatus.Draft &&
                item.ValidFrom <= date && (item.ValidTo == null || item.ValidTo >= date))
            .OrderByDescending(item => item.ValidFrom).Select(item => (long?)item.Id).FirstOrDefaultAsync(cancellationToken);
        if (version is null) return new Dictionary<long, BaseServiceRate>();
        var rates = await context.ServiceTariffRates.AsNoTracking()
            .Where(rate => rate.ServiceTariffVersionId == version && serviceIds.Contains(rate.ServiceDefinitionId) &&
                (rate.StationId == null || rate.StationId == stationId))
            .ToArrayAsync(cancellationToken);
        return rates.GroupBy(rate => rate.ServiceDefinitionId)
            .Select(group => group.OrderByDescending(rate => rate.StationId != null).First())
            .ToDictionary(rate => rate.ServiceDefinitionId,
                rate => new BaseServiceRate(rate.ServiceDefinitionId, rate.BillingUnit, rate.UnitPrice,
                    rate.MinimumBillableQuantity));
    }

    public static async Task<IReadOnlyDictionary<long, BaseChargeRate>> ChargeRatesAsync(ElevantDbContext context,
        string currency, DateOnly date, CancellationToken cancellationToken)
    {
        var version = await context.ChargeTariffVersions.AsNoTracking()
            .Where(item => item.CurrencyCode == currency && item.Status != TariffVersionStatus.Draft &&
                item.ValidFrom <= date && (item.ValidTo == null || item.ValidTo >= date))
            .OrderByDescending(item => item.ValidFrom).Select(item => (long?)item.Id).FirstOrDefaultAsync(cancellationToken);
        if (version is null) return new Dictionary<long, BaseChargeRate>();
        return await context.ChargeRates.AsNoTracking().Where(rate => rate.ChargeTariffVersionId == version)
            .ToDictionaryAsync(rate => rate.ChargeDefinitionId,
                rate => new BaseChargeRate(rate.ChargeDefinitionId, rate.Value, rate.MinimumAmount), cancellationToken);
    }

    /// <summary>Current rate converting <paramref name="from"/> into <paramref name="to"/> on a date, inverse allowed.</summary>
    public static async Task<decimal?> ExchangeRateAsync(ElevantDbContext context, string from, string to, DateOnly date,
        CancellationToken cancellationToken)
    {
        if (from == to) return 1m;
        var rate = await context.ExchangeRates.AsNoTracking()
            .Where(item => item.IsCurrent && item.RateDate <= date &&
                (item.FromCurrency == from && item.ToCurrency == to || item.FromCurrency == to && item.ToCurrency == from))
            .OrderByDescending(item => item.RateDate).FirstOrDefaultAsync(cancellationToken);
        if (rate is null) return null;
        return rate.FromCurrency == from ? rate.Rate : decimal.Round(1m / rate.Rate, 10);
    }
}
