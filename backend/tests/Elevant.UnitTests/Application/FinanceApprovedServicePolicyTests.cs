using Elevant.Application.Finance;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

public sealed class FinanceApprovedServicePolicyTests
{
    [Theory]
    [InlineData(ServiceExecutionStatus.Completed, "2.5", "40", "USD", "hour", true, null, "100")]
    [InlineData(ServiceExecutionStatus.Completed, "0", "40", "USD", "hour", false, "no_executed_quantity", null)]
    [InlineData(ServiceExecutionStatus.NotPerformed, "2", "40", "USD", "hour", false, "service_not_completed", null)]
    // 3-N11: a service in exception is billed by the quantity executed, like a completed one.
    [InlineData(ServiceExecutionStatus.Exception, "2", "40", "USD", "hour", true, null, "80")]
    [InlineData(ServiceExecutionStatus.Exception, "0", "40", "USD", "hour", false, "no_executed_quantity", null)]
    [InlineData(ServiceExecutionStatus.InProgress, "2", "40", "USD", "hour", false, "service_not_completed", null)]
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

    /// <summary>
    /// 3-N11: what OCC excluded in the review is never billed; 3-N29: a charge the contract excludes blocks the service
    /// instead of being valued at zero.
    /// </summary>
    [Fact]
    public void ReviewExclusionsAndContractExcludedChargesBlockTheService()
    {
        var excluded = FinanceApprovedServicePolicy.Evaluate(ServiceExecutionStatus.Exception, 2m, 40m, "USD", "hour",
            billingExcluded: true);
        Assert.Equal((false, "excluded_in_review", (decimal?)null), (excluded.Ready, excluded.BlockingReason, excluded.Amount));
        var charged = FinanceApprovedServicePolicy.Evaluate(ServiceExecutionStatus.Completed, 2m, 40m, "USD", "hour",
            hasContractExcludedCharge: true);
        Assert.Equal((false, "charge_excluded_by_contract"), (charged.Ready, charged.BlockingReason));
        // A service not completed is still reported as such first.
        Assert.Equal("service_not_completed", FinanceApprovedServicePolicy.Evaluate(ServiceExecutionStatus.NotPerformed, 0m,
            40m, "USD", "hour", hasContractExcludedCharge: true).BlockingReason);
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
