using Elevant.Application.Abstractions.Operations;

namespace Elevant.Application.Operations.AirPicture;

/// <summary>
/// How long the air traffic reader waits before its next read (ADR-0042, contracts 1.3). One wait per read, whatever
/// happened: a refusal is never retried in a loop, and the wait is never shorter than the configured interval.
/// </summary>
public static class AirTrafficBackOff
{
    /// <summary>The shortest wait after the network asked to slow down, whatever its <c>Retry-After</c> says.</summary>
    public static TimeSpan MinimumRateLimitWait { get; } = TimeSpan.FromSeconds(60);

    /// <summary>The wait after the network refused the address or the key, or after the day's budget ran out.</summary>
    public static TimeSpan RefusedWait { get; } = TimeSpan.FromMinutes(30);

    /// <summary>The first wait after a failed read; it doubles with each failure in a row.</summary>
    public static TimeSpan FirstFailureWait { get; } = TimeSpan.FromSeconds(15);

    /// <summary>The longest wait after failed reads.</summary>
    public static TimeSpan MaxFailureWait { get; } = TimeSpan.FromMinutes(5);

    /// <summary>
    /// The longest wait of all: a <c>Retry-After</c> beyond it is waited out in more than one step, and the timers of the
    /// runtime never receive a span they cannot hold.
    /// </summary>
    public static TimeSpan MaxWait { get; } = TimeSpan.FromDays(1);

    /// <summary>
    /// The wait after a read that ended with <paramref name="outcome"/>. A success waits the interval; a request to slow
    /// down waits what <paramref name="retryAfter"/> asks and at least a minute; a refusal or a spent budget waits 30
    /// minutes; a failure waits 15 seconds, doubled for each failure in a row (<paramref name="consecutiveFailures"/>
    /// counts this one) up to five minutes. Never less than <paramref name="interval"/>.
    /// </summary>
    public static TimeSpan Next(AirTrafficOutcome outcome, int consecutiveFailures, TimeSpan? retryAfter, TimeSpan interval)
    {
        if (interval <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(interval), "The interval must be positive.");
        var wait = outcome switch
        {
            AirTrafficOutcome.Succeeded => interval,
            AirTrafficOutcome.RateLimited => Max(retryAfter ?? TimeSpan.Zero, MinimumRateLimitWait),
            AirTrafficOutcome.Unauthorized or AirTrafficOutcome.QuotaExceeded => RefusedWait,
            _ => FailureWait(consecutiveFailures),
        };
        return Min(Max(wait, interval), MaxWait);
    }

    private static TimeSpan FailureWait(int consecutiveFailures)
    {
        var wait = FirstFailureWait;
        // 15, 30, 60, 120, 240 seconds, then five minutes for good.
        for (var failure = 1; failure < consecutiveFailures && wait < MaxFailureWait; failure++) wait += wait;
        return Min(wait, MaxFailureWait);
    }

    private static TimeSpan Max(TimeSpan left, TimeSpan right) => left > right ? left : right;

    private static TimeSpan Min(TimeSpan left, TimeSpan right) => left < right ? left : right;
}
