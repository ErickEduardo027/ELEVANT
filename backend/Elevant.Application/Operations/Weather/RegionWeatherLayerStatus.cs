using Elevant.Application.Abstractions.Operations;

namespace Elevant.Application.Operations.Weather;

/// <summary>
/// The pace a screen reads one layer of a region's weather at (plan M6), in seconds: <paramref name="Ordinary"/> while the
/// source answers (the time it keeps its answer), and from <paramref name="Shortest"/> to <paramref name="Longest"/>
/// while it waits out a failure; <paramref name="Longest"/> without a service.
/// </summary>
public sealed record RegionWeatherLayerPace(int Ordinary, int Shortest, int Longest)
{
    /// <summary>SIGMETs: kept ten minutes; 5 to 15 minutes while a failure is waited out.</summary>
    public static RegionWeatherLayerPace Sigmets { get; } = new(600, 300, 900);

    /// <summary>The wind grid: kept an hour; 5 minutes to an hour while a failure is waited out.</summary>
    public static RegionWeatherLayerPace Wind { get; } = new(3600, 300, 3600);

    /// <summary>Radar frames: kept five minutes, about a scan; 5 to 15 minutes while a failure is waited out.</summary>
    public static RegionWeatherLayerPace Radar { get; } = new(300, 300, 900);
}

/// <summary>
/// The state of one layer of a region's weather (plan M6: SIGMETs, wind, radar), with the states and reasons of the
/// region's METARs (<see cref="AerodromeWeatherStatus"/>, <see cref="RegionWeatherReasons"/>). It always travels in the
/// read's 200: a service that fails is a state of the layer, never a server error.
/// </summary>
public static class RegionWeatherLayerStatus
{
    /// <summary>Radar frames older than this are no longer live: a scan comes every five to ten minutes.</summary>
    public static TimeSpan LiveRadarAge { get; } = TimeSpan.FromMinutes(30);

    /// <summary>A wind grid valid longer ago than this is no longer live: the service gives it every quarter of an hour.</summary>
    public static TimeSpan LiveWindAge { get; } = TimeSpan.FromHours(3);

    /// <summary>
    /// The state and its reason for <paramref name="layer"/>; pure. No layer (no service) is
    /// <see cref="AerodromeWeatherStatus.Disabled"/> (<c>not_configured</c>). Nothing to serve is
    /// <see cref="AerodromeWeatherStatus.Unavailable"/>, with the reason of the read that failed (none when the service
    /// answered without anything). What was kept after a failure is <see cref="AerodromeWeatherStatus.Stale"/> with that
    /// reason. Otherwise it is <see cref="AerodromeWeatherStatus.Live"/> when <paramref name="current"/> says the value is
    /// still current, and <see cref="AerodromeWeatherStatus.Stale"/> without a reason when it is not.
    /// </summary>
    public static (string Status, string? Reason) Of<T>(RegionWeatherLayer<T>? layer, Func<T, bool> current) where T : class
    {
        ArgumentNullException.ThrowIfNull(current);
        if (layer is null) return (AerodromeWeatherStatus.Disabled, RegionWeatherReasons.NotConfigured);
        var reason = RegionWeatherReasons.Of(layer.Failure);
        if (layer.Value is not { } value) return (AerodromeWeatherStatus.Unavailable, reason);
        if (layer.KeptAfterFailure) return (AerodromeWeatherStatus.Stale, reason);
        return current(value) ? (AerodromeWeatherStatus.Live, null) : (AerodromeWeatherStatus.Stale, null);
    }

    /// <summary>
    /// When a screen asks for the layer again, in whole seconds; pure. Without a service it is
    /// <see cref="RegionWeatherLayerPace.Longest"/>. While the source waits out a failure it is the rest of that wait,
    /// from <see cref="RegionWeatherLayerPace.Shortest"/> to <see cref="RegionWeatherLayerPace.Longest"/>, since an
    /// earlier read would only bring what was kept; otherwise it is <see cref="RegionWeatherLayerPace.Ordinary"/>.
    /// </summary>
    public static int RefreshAfterSeconds<T>(RegionWeatherLayer<T>? layer, RegionWeatherLayerPace pace, DateTimeOffset now)
        where T : class
    {
        ArgumentNullException.ThrowIfNull(pace);
        if (layer is null) return pace.Longest;
        if (layer.RetryAt is not { } retryAt || retryAt <= now) return pace.Ordinary;
        var wait = (retryAt - now).TotalSeconds;
        return wait >= pace.Longest ? pace.Longest : Math.Max(pace.Shortest, (int)Math.Ceiling(wait));
    }
}
