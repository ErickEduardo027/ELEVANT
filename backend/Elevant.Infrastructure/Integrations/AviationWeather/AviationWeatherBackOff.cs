namespace Elevant.Infrastructure.Integrations.AviationWeather;

/// <summary>
/// How long the weather source waits after a failed read before it asks the service again (ADR-0043, contracts 1.4).
/// One wait per failure, never a loop: while it lasts the source serves what it kept and sends nothing.
/// </summary>
public static class AviationWeatherBackOff
{
    /// <summary>The wait after the first failure; it doubles with each failure in a row.</summary>
    public static TimeSpan FirstWait { get; } = TimeSpan.FromMinutes(1);

    /// <summary>The longest wait after failures in a row.</summary>
    public static TimeSpan MaxFailureWait { get; } = TimeSpan.FromMinutes(15);

    /// <summary>The longest wait of all, also when the service's <c>Retry-After</c> asks for more.</summary>
    public static TimeSpan MaxWait { get; } = TimeSpan.FromMinutes(60);

    /// <summary>
    /// The wait after a failed read: 1, 2, 4 and 8 minutes for the first four failures in a row
    /// (<paramref name="consecutiveFailures"/> counts this one), then 15 minutes for good. A longer
    /// <paramref name="retryAfter"/> wins, up to an hour.
    /// </summary>
    public static TimeSpan Next(int consecutiveFailures, TimeSpan? retryAfter)
    {
        var wait = FirstWait;
        for (var failure = 1; failure < consecutiveFailures && wait < MaxFailureWait; failure++) wait += wait;
        if (wait > MaxFailureWait) wait = MaxFailureWait;
        if (retryAfter is { } asked && asked > wait) wait = asked < MaxWait ? asked : MaxWait;
        return wait;
    }
}
