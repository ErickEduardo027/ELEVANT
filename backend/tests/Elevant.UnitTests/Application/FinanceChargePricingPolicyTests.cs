using Elevant.Application.Finance;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

public sealed class FinanceChargePricingPolicyTests
{
    private static ChargePricingInput Input(ChargeCalculationMethod method, ChargeQuantityRule rule = ChargeQuantityRule.One,
        decimal? minutes = null, int grace = 0, decimal rounding = 0, decimal? value = 10m, decimal minimum = 0,
        decimal serviceQuantity = 1, decimal serviceAmount = 100m) =>
        new(method, rule, grace, rounding, minutes, serviceQuantity, serviceAmount, value, minimum);

    [Fact]
    public void FixedChargeAppliesOnce()
    {
        var result = FinanceChargePricingPolicy.Price(Input(ChargeCalculationMethod.FixedAmount, value: 15m));
        Assert.True(result.Ready);
        Assert.Equal(1m, result.Quantity);
        Assert.Equal(15m, result.Amount);
    }

    [Fact]
    public void PercentChargeUsesTheServiceAmount()
    {
        var result = FinanceChargePricingPolicy.Price(Input(ChargeCalculationMethod.PercentOfService, value: 25m,
            serviceAmount: 125.50m));
        Assert.Equal(31.375m, result.Amount);
    }

    [Theory]
    [InlineData(10, 15, 0.25, 0)]       // inside the grace period
    [InlineData(50, 15, 0.25, 0.75)]    // 35 minutes rounds up to 0.75 h
    [InlineData(75, 15, 0.25, 1)]       // exactly one billable hour
    [InlineData(76, 15, 0.5, 1.5)]      // 61 minutes rounds up to 1.5 h
    public void HourlyChargeBillsTimeBeyondGraceRoundedUp(decimal minutes, int grace, decimal rounding, decimal hours)
    {
        var result = FinanceChargePricingPolicy.Price(Input(ChargeCalculationMethod.PerHour,
            ChargeQuantityRule.OperationOverrun, minutes, grace, rounding, 40m));
        Assert.True(result.Ready);
        Assert.Equal(hours, result.Quantity);
        Assert.Equal(hours * 40m, result.Amount);
    }

    [Fact]
    public void PerMinuteChargeRoundsToItsIncrement()
    {
        var result = FinanceChargePricingPolicy.Price(Input(ChargeCalculationMethod.PerMinute,
            ChargeQuantityRule.ArrivalDelay, 43m, 30, 5m, 1.5m));
        Assert.Equal(15m, result.Quantity);
        Assert.Equal(22.5m, result.Amount);
    }

    [Fact]
    public void TimeChargeWithoutRecordedTimeIsBlocked()
    {
        var result = FinanceChargePricingPolicy.Price(Input(ChargeCalculationMethod.PerHour,
            ChargeQuantityRule.ServiceDuration, minutes: null));
        Assert.False(result.Ready);
        Assert.Equal("charge_measurement_missing", result.BlockingReason);
    }

    [Fact]
    public void UnitChargeCanBillTheServiceQuantity()
    {
        var result = FinanceChargePricingPolicy.Price(Input(ChargeCalculationMethod.PerUnit,
            ChargeQuantityRule.ServiceQuantity, value: 2m, serviceQuantity: 3.5m));
        Assert.Equal(3.5m, result.Quantity);
        Assert.Equal(7m, result.Amount);
    }

    [Fact]
    public void MinimumAppliesOnlyToPositiveAmounts()
    {
        Assert.Equal(20m, FinanceChargePricingPolicy.Price(Input(ChargeCalculationMethod.PerHour,
            ChargeQuantityRule.OperationOverrun, 20m, 0, 0.25m, 40m, 20m)).Amount);
        Assert.Equal(0m, FinanceChargePricingPolicy.Price(Input(ChargeCalculationMethod.PerHour,
            ChargeQuantityRule.OperationOverrun, 5m, 15, 0.25m, 40m, 20m)).Amount);
    }

    [Fact]
    public void MissingRateIsBlocked()
    {
        var result = FinanceChargePricingPolicy.Price(Input(ChargeCalculationMethod.FixedAmount, value: null));
        Assert.Equal("charge_rate_missing", result.BlockingReason);
    }

    [Fact]
    public void ConversionKeepsFourDecimals()
    {
        Assert.Equal(1462.5m, FinanceChargePricingPolicy.Convert(25m, 58.5m));
        Assert.Equal(0.4274m, FinanceChargePricingPolicy.Convert(25m, 0.0170940171m));
    }
}
