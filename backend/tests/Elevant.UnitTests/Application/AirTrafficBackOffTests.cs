using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations.AirPicture;

namespace Elevant.UnitTests.Application;

/// <summary>
/// ADR-0042 (contracts 1.3): after each read the air traffic reader waits once: the interval after a success, what the
/// network asks (at least a minute) after a 429, half an hour after a refusal or a spent budget, and 15 seconds doubled up
/// to five minutes after failures. Never less than the interval.
/// </summary>
public sealed class AirTrafficBackOffTests
{
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(10);

    [Theory]
    [InlineData(0, 15)]
    [InlineData(1, 15)]
    [InlineData(2, 30)]
    [InlineData(3, 60)]
    [InlineData(4, 120)]
    [InlineData(5, 240)]
    [InlineData(6, 300)]
    [InlineData(40, 300)]
    [InlineData(int.MaxValue, 300)]
    public void FailuresWaitFifteenSecondsDoubledUpToFiveMinutes(int failures, int seconds) =>
        Assert.Equal(TimeSpan.FromSeconds(seconds), AirTrafficBackOff.Next(AirTrafficOutcome.Failed, failures, null, Interval));

    [Theory]
    [InlineData(null, 60)]
    [InlineData(0, 60)]
    [InlineData(59, 60)]
    [InlineData(61, 61)]
    [InlineData(3_600, 3_600)]
    [InlineData(200_000, 86_400)]
    public void ARateLimitWaitsWhatItAsksAndAtLeastAMinute(int? retryAfterSeconds, int seconds)
    {
        var retryAfter = retryAfterSeconds is { } value ? TimeSpan.FromSeconds(value) : (TimeSpan?)null;
        Assert.Equal(TimeSpan.FromSeconds(seconds), AirTrafficBackOff.Next(AirTrafficOutcome.RateLimited, 1, retryAfter, Interval));
    }

    [Fact]
    public void RefusalsWaitHalfAnHourAndASuccessTheInterval()
    {
        Assert.Equal(TimeSpan.FromMinutes(30), AirTrafficBackOff.Next(AirTrafficOutcome.Unauthorized, 1, null, Interval));
        Assert.Equal(TimeSpan.FromMinutes(30),
            AirTrafficBackOff.Next(AirTrafficOutcome.QuotaExceeded, 9, TimeSpan.FromHours(2), Interval));
        Assert.Equal(Interval, AirTrafficBackOff.Next(AirTrafficOutcome.Succeeded, 0, null, Interval));
    }

    [Fact]
    public void NeverWaitsLessThanTheInterval()
    {
        var slow = TimeSpan.FromMinutes(2);
        Assert.Equal(slow, AirTrafficBackOff.Next(AirTrafficOutcome.Failed, 1, null, slow));
        Assert.Equal(slow, AirTrafficBackOff.Next(AirTrafficOutcome.RateLimited, 1, TimeSpan.FromSeconds(30), slow));
        Assert.Equal(slow, AirTrafficBackOff.Next(AirTrafficOutcome.Succeeded, 0, null, slow));
        Assert.Equal(TimeSpan.FromMinutes(30), AirTrafficBackOff.Next(AirTrafficOutcome.Unauthorized, 1, null, slow));
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            AirTrafficBackOff.Next(AirTrafficOutcome.Succeeded, 0, null, TimeSpan.Zero));
    }
}
