using Elevant.Application.Finance;
namespace Elevant.UnitTests.Application;
public sealed class FinanceMinimumPricingPolicyTests
{
    [Theory]
    [InlineData(1, 3, 10, 20)]
    [InlineData(3, 3, 10, 0)]
    [InlineData(4, 3, 10, 0)]
    public void MinimumAddsOnlyTheMissingQuantity(decimal executed, decimal minimum, decimal price, decimal expected) =>
        Assert.Equal(expected, FinanceMinimumPricingPolicy.TopUp(executed, minimum, price));
    [Fact]
    public void InvalidInputCannotProduceAPrice() => Assert.Null(FinanceMinimumPricingPolicy.TopUp(-1, 3, 10));
}
