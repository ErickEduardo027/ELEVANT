using Elevant.Application.Finance;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

public sealed class FinanceApprovedServicePolicyTests
{
    [Theory]
    [InlineData(ServiceExecutionStatus.Completed, "2.5", "40", "USD", "hour", true, null, "100")]
    [InlineData(ServiceExecutionStatus.Completed, "0", "40", "USD", "hour", false, "no_executed_quantity", null)]
    [InlineData(ServiceExecutionStatus.NotPerformed, "2", "40", "USD", "hour", false, "service_not_completed", null)]
    [InlineData(ServiceExecutionStatus.Exception, "2", "40", "USD", "hour", false, "service_not_completed", null)]
    [InlineData(ServiceExecutionStatus.Completed, "2", null, "USD", "hour", false, "missing_frozen_rate", null)]
    [InlineData(ServiceExecutionStatus.Completed, "2", "-1", "USD", "hour", false, "missing_frozen_rate", null)]
    [InlineData(ServiceExecutionStatus.Completed, "2", "40", null, "hour", false, "invalid_currency", null)]
    [InlineData(ServiceExecutionStatus.Completed, "2", "40", "usd", "hour", false, "invalid_currency", null)]
    [InlineData(ServiceExecutionStatus.Completed, "2", "40", "USD", "", false, "invalid_billing_unit", null)]
    public void OnlyCompletedPricedExecutionCanBeBilled(
        ServiceExecutionStatus status, string executed, string? unitPrice,
        string? currency, string? billingUnit, bool ready, string? reason,
        string? amount)
    {
        var result = FinanceApprovedServicePolicy.Evaluate(
            status, decimal.Parse(executed, System.Globalization.CultureInfo.InvariantCulture),
            unitPrice is null ? null : decimal.Parse(unitPrice, System.Globalization.CultureInfo.InvariantCulture),
            currency, billingUnit);

        Assert.Equal(ready, result.Ready);
        Assert.Equal(reason, result.BlockingReason);
        Assert.Equal(amount is null ? null : decimal.Parse(amount, System.Globalization.CultureInfo.InvariantCulture), result.Amount);
    }

    [Theory]
    [InlineData(2026, 9, 1, 2026, 10, 1, true)]
    [InlineData(2026, 9, 1, 2026, 10, 2, false)]
    [InlineData(2026, 9, 2, 2026, 9, 1, false)]
    public void DateWindowIsInclusiveAndBounded(
        int fromYear, int fromMonth, int fromDay,
        int toYear, int toMonth, int toDay, bool valid)
    {
        Assert.Equal(valid, FinanceApprovedServicePolicy.IsValidWindow(
            new DateOnly(fromYear, fromMonth, fromDay),
            new DateOnly(toYear, toMonth, toDay)));
    }

    [Fact]
    public void ExcessiveFrozenValuesAreBlockedInsteadOfThrowing()
    {
        var result = FinanceApprovedServicePolicy.Evaluate(
            ServiceExecutionStatus.Completed, 100_000_000_000_000m,
            1_000_000_000_000_000m, "USD", "operation");
        Assert.False(result.Ready);
        Assert.Equal("invalid_amount", result.BlockingReason);
    }
}
