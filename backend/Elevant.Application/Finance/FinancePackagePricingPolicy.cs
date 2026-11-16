namespace Elevant.Application.Finance;

public sealed record FinancePackagePricing(bool Ready, string? BlockingReason, decimal BaseAmount,
    decimal IncludedQuantity, decimal ExcessQuantity, decimal ExcessBlocksAfter, decimal ExcessAmount)
{
    public decimal Amount => BaseAmount + ExcessAmount;
}

/// <summary>Values the incremental consumption of one component, never the same begun block twice.</summary>
public static class FinancePackagePricingPolicy
{
    public static FinancePackagePricing Price(decimal basePrice, decimal includedQuantity, decimal excessBlockSize,
        decimal excessBlockPrice, decimal consumedBefore, decimal quantity, bool baseAlreadyCharged)
    {
        if (basePrice is < 0 or > 900_000_000_000m || includedQuantity < 0 || excessBlockSize <= 0 ||
            excessBlockPrice is < 0 or > 900_000_000_000m || consumedBefore < 0 || quantity <= 0)
            return new(false, "invalid_package_rule", 0, 0, 0, 0, 0);
        try
        {
            var after = consumedBefore + quantity;
            var excessBefore = Math.Max(0, consumedBefore - includedQuantity);
            var excessAfter = Math.Max(0, after - includedQuantity);
            var blocksBefore = decimal.Ceiling(excessBefore / excessBlockSize);
            var blocksAfter = decimal.Ceiling(excessAfter / excessBlockSize);
            var included = Math.Min(quantity, Math.Max(0, includedQuantity - consumedBefore));
            var baseAmount = baseAlreadyCharged ? 0 : basePrice;
            var excessAmount = decimal.Round((blocksAfter - blocksBefore) * excessBlockPrice, 4, MidpointRounding.AwayFromZero);
            if (baseAmount + excessAmount > 900_000_000_000m)
                return new(false, "invalid_amount", 0, 0, 0, 0, 0);
            return new(true, null, baseAmount, included, quantity - included, blocksAfter, excessAmount);
        }
        catch (OverflowException) { return new(false, "invalid_amount", 0, 0, 0, 0, 0); }
    }
}
