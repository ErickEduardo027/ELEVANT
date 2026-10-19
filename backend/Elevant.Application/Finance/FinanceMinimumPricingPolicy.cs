namespace Elevant.Application.Finance;

public static class FinanceMinimumPricingPolicy
{
    public static decimal? TopUp(decimal executedQuantity, decimal minimumQuantity, decimal unitPrice)
    {
        if (executedQuantity < 0 || minimumQuantity < 0 || unitPrice < 0) return null;
        try
        {
            var amount = decimal.Round(Math.Max(0, minimumQuantity - executedQuantity) * unitPrice, 4, MidpointRounding.AwayFromZero);
            return amount > 900_000_000_000m ? null : amount;
        }
        catch (OverflowException) { return null; }
    }
}
