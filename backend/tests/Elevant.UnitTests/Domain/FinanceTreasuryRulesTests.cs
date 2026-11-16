using Elevant.Domain.Entities.Commercial;
namespace Elevant.UnitTests.Domain;
public sealed class FinanceTreasuryRulesTests
{
    [Fact] public void Invoice1000Applied300HasBalance700() => Assert.Equal(700m, FinanceTreasuryRules.Balance(1000m, 0m, 0m, 300m, 0m, 0m));
    [Fact] public void LegacyPaymentsAndCreditsAreCountedExactlyOnce() => Assert.Equal(550m, FinanceTreasuryRules.Balance(1000m, 100m, 50m, 300m, 20m, 20m));
    [Fact] public void UnappliedAdvanceAndRefundAreIndependentOfInvoiceCredits() => Assert.Equal(450m, FinanceTreasuryRules.Available(1000m, 300m, 250m, false));
    [Theory] [InlineData(701, 1000, 700, false)] [InlineData(300, 299, 700, false)] [InlineData(300, 300, 700, true)] [InlineData(0, 1000, 700, false)]
    public void ApplicationsCannotExceedReceiptOrInvoice(decimal amount, decimal available, decimal balance, bool valid) => Assert.Equal(valid, FinanceTreasuryRules.CanApply(amount, available, balance));
    [Fact] public void CrossCurrencyUsesRecordedRateAndFourDecimalRounding() => Assert.Equal(18150m, FinanceTreasuryRules.Convert(300m, 60.5m));
    [Theory] [InlineData(2, 200, 2, 200, true)] [InlineData(3, 200, 2, 200, false)] [InlineData(2, 201, 2, 200, false)] [InlineData(0, 200, 2, 200, false)] [InlineData(0, 200, 0, 200, true)]
    public void AdjustmentCannotExceedRemainingLine(decimal quantity, decimal amount, decimal remainingQuantity, decimal remainingAmount, bool valid) => Assert.Equal(valid, FinanceTreasuryRules.CanAdjust(quantity, amount, remainingQuantity, remainingAmount));
    [Theory] [InlineData(0, "Current")] [InlineData(1, "1-30")] [InlineData(30, "1-30")] [InlineData(31, "31-60")] [InlineData(61, "61-90")] [InlineData(91, "91+")]
    public void AgingUsesCutoffDate(int overdue, string bucket) => Assert.Equal(bucket, FinanceTreasuryRules.AgingBucket(overdue));
}
