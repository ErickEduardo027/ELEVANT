using Elevant.Application.Finance;

namespace Elevant.UnitTests.Application;

public sealed class FinancePackagePricingPolicyTests
{
    [Theory]
    [InlineData(60, 500)]
    [InlineData(61, 520)]
    [InlineData(75, 520)]
    [InlineData(76, 540)]
    [InlineData(83, 540)]
    public void BillsOnlyBegunExcessBlocks(decimal minutes, decimal total)
    {
        var result = FinancePackagePricingPolicy.Price(500, 60, 15, 20, 0, minutes, false);
        Assert.True(result.Ready);
        Assert.Equal(total, result.Amount);
    }

    [Fact]
    public void SplitConsumptionDoesNotChargeTheBaseOrAnExcessBlockTwice()
    {
        var first = FinancePackagePricingPolicy.Price(500, 60, 15, 20, 0, 40, false);
        var second = FinancePackagePricingPolicy.Price(500, 60, 15, 20, 40, 21, true);
        var third = FinancePackagePricingPolicy.Price(500, 60, 15, 20, 61, 14, true);
        var fourth = FinancePackagePricingPolicy.Price(500, 60, 15, 20, 75, 8, true);
        Assert.Equal(500, first.Amount);
        Assert.Equal(20, second.Amount);
        Assert.Equal(0, third.Amount);
        Assert.Equal(20, fourth.Amount);
        Assert.Equal(2, fourth.ExcessBlocksAfter);
    }

    [Fact]
    public void IncludedConsumptionIsNotAlsoIndividuallyPriced()
    {
        var result = FinancePackagePricingPolicy.Price(500, 60, 15, 20, 50, 20, true);
        Assert.Equal(10, result.IncludedQuantity);
        Assert.Equal(10, result.ExcessQuantity);
        Assert.Equal(20, result.Amount);
    }

    [Theory]
    [InlineData(-1, 60, 15, 20, 0, 10)]
    [InlineData(500, 60, 0, 20, 0, 10)]
    [InlineData(500, 60, 15, 20, -1, 10)]
    [InlineData(500, 60, 15, 20, 0, 0)]
    public void InvalidCommercialRulesOrMeasurementsAreBlocked(decimal price, decimal included, decimal block, decimal excess, decimal before, decimal used)
    {
        Assert.False(FinancePackagePricingPolicy.Price(price, included, block, excess, before, used, false).Ready);
    }
}
