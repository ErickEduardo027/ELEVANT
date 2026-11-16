namespace Elevant.Domain.Entities.Commercial;
public static class FinanceTreasuryRules
{
    public static decimal Balance(decimal total, decimal legacyPaid, decimal legacyCredited, decimal applied,
        decimal credited, decimal debited) => total + debited - legacyPaid - legacyCredited - applied - credited;
    public static decimal Available(decimal received, decimal applied, decimal refunded, bool reversed) =>
        reversed ? 0m : received - applied - refunded;
    public static bool Money(decimal value) => value > 0m && value <= 900_000_000_000m && decimal.Round(value, 4) == value;
    public static bool CanApply(decimal amount, decimal available, decimal balance) => Money(amount) && amount <= available && amount <= balance;
    public static decimal Convert(decimal amount, decimal rate) => decimal.Round(amount * rate, 4, MidpointRounding.AwayFromZero);
    public static bool CanAdjust(decimal quantity, decimal amount, decimal remainingQuantity, decimal remainingAmount) =>
        quantity >= 0m && quantity <= 900_000_000_000m && decimal.Round(quantity, 4) == quantity &&
        (quantity > 0m || remainingQuantity == 0m) && Money(amount) && quantity <= remainingQuantity && amount <= remainingAmount;
    public static string AgingBucket(int days) => days switch { <= 0 => "Current", <= 30 => "1-30", <= 60 => "31-60", <= 90 => "61-90", _ => "91+" };
}
