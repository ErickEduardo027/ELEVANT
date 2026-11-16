using Elevant.Domain.Enumerations;

namespace Elevant.Application.Finance;

/// <summary>What a charge needs to be valued: its definition, the measured time and the applicable rate.</summary>
public sealed record ChargePricingInput(
    ChargeCalculationMethod Method,
    ChargeQuantityRule QuantityRule,
    int GraceMinutes,
    decimal RoundingIncrement,
    decimal? MeasuredMinutes,
    decimal ServiceQuantity,
    decimal ServiceAmount,
    decimal? RateValue,
    decimal RateMinimum);

public sealed record ChargePricing(bool Ready, string? BlockingReason, decimal Quantity, decimal UnitPrice, decimal Amount)
{
    public static ChargePricing Blocked(string reason) => new(false, reason, 0m, 0m, 0m);
}

/// <summary>
/// Values a charge an agent marked. Fixed and percentage charges apply once;
/// hourly and per-minute charges bill the recorded time beyond the grace period,
/// rounded up to the increment; unit charges bill one unit or the service quantity.
/// A positive amount never falls below the rate's minimum.
/// </summary>
public static class FinanceChargePricingPolicy
{
    private const decimal MaximumMoney = 900_000_000_000m;

    public static ChargePricing Price(ChargePricingInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        if (input.RateValue is not decimal value || value < 0 || input.RateMinimum < 0)
            return ChargePricing.Blocked("charge_rate_missing");

        decimal quantity;
        switch (input.Method)
        {
            case ChargeCalculationMethod.FixedAmount:
                quantity = 1m;
                break;
            case ChargeCalculationMethod.PercentOfService:
                return Finish(1m, decimal.Round(input.ServiceAmount * value / 100m, 4, MidpointRounding.AwayFromZero),
                    input.RateMinimum);
            case ChargeCalculationMethod.PerHour or ChargeCalculationMethod.PerMinute:
                if (input.MeasuredMinutes is not decimal measured)
                    return ChargePricing.Blocked("charge_measurement_missing");
                var billableMinutes = Math.Max(0m, measured - input.GraceMinutes);
                quantity = input.Method == ChargeCalculationMethod.PerHour ? billableMinutes / 60m : billableMinutes;
                quantity = RoundUp(quantity, input.RoundingIncrement);
                break;
            case ChargeCalculationMethod.PerUnit:
                quantity = input.QuantityRule == ChargeQuantityRule.ServiceQuantity ? input.ServiceQuantity : 1m;
                break;
            default:
                return ChargePricing.Blocked("charge_method_unsupported");
        }
        return Finish(quantity, quantity * value, input.RateMinimum, value);
    }

    private static ChargePricing Finish(decimal quantity, decimal amount, decimal minimum, decimal? unitPrice = null)
    {
        quantity = decimal.Round(quantity, 4, MidpointRounding.AwayFromZero);
        amount = decimal.Round(amount, 4, MidpointRounding.AwayFromZero);
        if (amount > 0 && amount < minimum) amount = minimum;
        if (amount is < 0 or > MaximumMoney) return ChargePricing.Blocked("invalid_amount");
        var price = unitPrice ?? (quantity == 0 ? amount : decimal.Round(amount / quantity, 4, MidpointRounding.AwayFromZero));
        return new ChargePricing(true, null, quantity, price, amount);
    }

    /// <summary>Rounds up to the next multiple of the increment; zero or negative increments leave the value as is.</summary>
    public static decimal RoundUp(decimal value, decimal increment) =>
        increment <= 0 ? value : Math.Ceiling(value / increment) * increment;

    /// <summary>Converts an amount with a rate, keeping four decimals.</summary>
    public static decimal Convert(decimal amount, decimal rate) =>
        decimal.Round(amount * rate, 4, MidpointRounding.AwayFromZero);
}
