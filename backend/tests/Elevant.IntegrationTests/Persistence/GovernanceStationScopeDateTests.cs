using Elevant.Persistence.Identity;

namespace Elevant.IntegrationTests.Persistence;

public sealed class GovernanceStationScopeDateTests
{
    [Fact]
    public void MovementAttributionUsesTheSameBusinessDayAsNewProfileScopes()
    {
        // 01:20 UTC of 6 October is still 5 October (21:20) in the Dominican Republic (2-N31).
        var utcMidnight = new DateTimeOffset(2026, 10, 6, 1, 20, 0,
            TimeSpan.Zero);

        Assert.True(RampScopeValidity.IsCurrent(
            new DateOnly(2026, 10, 5), null, utcMidnight));
        Assert.False(RampScopeValidity.IsCurrent(
            new DateOnly(2026, 10, 6), null, utcMidnight));
        Assert.False(RampScopeValidity.IsCurrent(
            new DateOnly(2026, 10, 4), new DateOnly(2026, 10, 4),
            utcMidnight));
        Assert.True(RampScopeValidity.IsCurrent(
            new DateOnly(2026, 10, 6), null, utcMidnight.AddHours(4)));
    }
}
