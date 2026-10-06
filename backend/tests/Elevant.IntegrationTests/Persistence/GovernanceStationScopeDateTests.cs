using Elevant.Persistence.Identity;

namespace Elevant.IntegrationTests.Persistence;

public sealed class GovernanceStationScopeDateTests
{
    [Fact]
    public void MovementAttributionUsesTheSameUtcDateAsNewProfileScopes()
    {
        var utcMidnight = new DateTimeOffset(2026, 10, 6, 1, 20, 0,
            TimeSpan.Zero);

        Assert.True(RampScopeValidity.IsCurrent(
            new DateOnly(2026, 10, 6), null, utcMidnight));
        Assert.False(RampScopeValidity.IsCurrent(
            new DateOnly(2026, 10, 7), null, utcMidnight));
        Assert.False(RampScopeValidity.IsCurrent(
            new DateOnly(2026, 10, 5), new DateOnly(2026, 10, 5),
            utcMidnight));
    }
}
