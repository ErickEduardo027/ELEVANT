using Elevant.Infrastructure.Integrations.AviationWeather;

namespace Elevant.UnitTests.Infrastructure;

/// <summary>
/// ADR-0043 (contracts 1.4): after a failed read the weather source waits once before it asks the service again: 1, 2, 4
/// and 8 minutes for the first four failures in a row, then 15 minutes for good. A longer <c>Retry-After</c> wins, up to an
/// hour.
/// </summary>
public sealed class AviationWeatherBackOffTests
{
    [Theory]
    [InlineData(0, 1)]
    [InlineData(1, 1)]
    [InlineData(2, 2)]
    [InlineData(3, 4)]
    [InlineData(4, 8)]
    [InlineData(5, 15)]
    [InlineData(6, 15)]
    [InlineData(40, 15)]
    [InlineData(int.MaxValue, 15)]
    public void BacksOffOneTwoFourUpToFifteenMinutes(int failures, int minutes) =>
        Assert.Equal(TimeSpan.FromMinutes(minutes), AviationWeatherBackOff.Next(failures, null));

    [Theory]
    [InlineData(1, 0, 60)]
    [InlineData(1, 30, 60)]
    [InlineData(1, 600, 600)]
    [InlineData(3, 600, 600)]
    [InlineData(5, 600, 900)]
    [InlineData(5, 1_800, 1_800)]
    [InlineData(1, 3_600, 3_600)]
    [InlineData(1, 7_200, 3_600)]
    [InlineData(9, 86_400, 3_600)]
    public void ALongerRetryAfterWinsUpToAnHour(int failures, int retryAfterSeconds, int seconds) =>
        Assert.Equal(TimeSpan.FromSeconds(seconds),
            AviationWeatherBackOff.Next(failures, TimeSpan.FromSeconds(retryAfterSeconds)));
}
