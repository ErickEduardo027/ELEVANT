using Elevant.Application.Identity;

namespace Elevant.UnitTests.Application;

public sealed class HumanResourcesReportPolicyTests
{
    [Fact]
    public void DateRangeAllowsThirtyInclusiveDaysButNotThirtyOne()
    {
        var first = new DateOnly(2026, 10, 1);

        Assert.True(HumanResourcesReportPolicy.ValidRange(first,
            new DateOnly(2026, 10, 30)));
        Assert.False(HumanResourcesReportPolicy.ValidRange(first,
            new DateOnly(2026, 10, 31)));
    }
}
