using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations.AirPicture;

namespace Elevant.Application.Operations.Weather;

/// <summary>
/// Why the region's weather is not live (plan M6): a stable code the screens translate and never print as it is. The
/// codes are the air picture's own (<see cref="AirPictureReasons"/>), so the screens already know them.
/// </summary>
public static class RegionWeatherReasons
{
    /// <summary>No weather service is configured (<c>AviationWeather:Enabled</c> is off): nothing is ever called.</summary>
    public const string NotConfigured = AirPictureReasons.NotConfigured;

    /// <summary>The service asked to slow down (HTTP 429).</summary>
    public const string RateLimited = AirPictureReasons.RateLimited;

    /// <summary>A timeout, a network error, another status, an answer that could not be read or a fault of the source.</summary>
    public const string ProviderError = AirPictureReasons.ProviderError;

    /// <summary>Every reason, in the order above.</summary>
    public static IReadOnlyList<string> All { get; } = [NotConfigured, RateLimited, ProviderError];

    /// <summary>The reason of a METAR read that failed as <paramref name="failure"/> says; null for one that did not.</summary>
    public static string? Of(WeatherServiceFailure? failure) => failure switch
    {
        null => null,
        WeatherServiceFailure.RateLimited => RateLimited,
        _ => ProviderError,
    };
}

/// <summary>
/// The state of a region's weather as the OCC reads it (plan M6), with the states of an airport's weather
/// (<see cref="AerodromeWeatherStatus"/>). It always travels in the read's 200: a weather service that fails is a state
/// of the weather, never a server error. The state follows the METARs; a TAF that comes or not never changes it.
/// </summary>
public static class RegionWeatherStatus
{
    /// <summary>The soonest a screen asks for the region's weather again: the time the METARs are kept.</summary>
    public static TimeSpan MinRefreshAfter { get; } = TimeSpan.FromMinutes(5);

    /// <summary>The latest a screen asks for it again, also while the service is waited out longer or is off.</summary>
    public static TimeSpan MaxRefreshAfter { get; } = TimeSpan.FromMinutes(15);

    /// <summary>
    /// The state and its reason for <paramref name="data"/> at <paramref name="now"/>; pure. No data (no weather service)
    /// is <see cref="AerodromeWeatherStatus.Disabled"/> (<c>not_configured</c>). Without any METAR it is
    /// <see cref="AerodromeWeatherStatus.Unavailable"/>, with the reason of the read that failed, or none when the service
    /// answered without reports. METARs kept after a failure are <see cref="AerodromeWeatherStatus.Stale"/> with that
    /// reason. Otherwise the region is <see cref="AerodromeWeatherStatus.Live"/> when at least one METAR is at most
    /// <see cref="AerodromeWeatherStatus.LiveMetarAge"/> older than <paramref name="now"/>, and
    /// <see cref="AerodromeWeatherStatus.Stale"/> without a reason when every one is older.
    /// </summary>
    public static (string Status, string? Reason) Of(RegionWeatherData? data, DateTimeOffset now)
    {
        if (data is null) return (AerodromeWeatherStatus.Disabled, RegionWeatherReasons.NotConfigured);
        var reason = RegionWeatherReasons.Of(data.MetarFailure);
        if (data.Metars.Count == 0) return (AerodromeWeatherStatus.Unavailable, reason);
        if (data.MetarsKeptAfterFailure) return (AerodromeWeatherStatus.Stale, reason);
        return data.Metars.Values.Any(metar => now - metar.ObservedAt <= AerodromeWeatherStatus.LiveMetarAge)
            ? (AerodromeWeatherStatus.Live, null)
            : (AerodromeWeatherStatus.Stale, null);
    }

    /// <summary>
    /// When a screen asks again, in whole seconds from <see cref="MinRefreshAfter"/> to <see cref="MaxRefreshAfter"/>;
    /// pure. Without a weather service it is the longest. While the source waits out a failure it is the rest of that
    /// wait, within those limits, since an earlier read would only bring what was kept; otherwise it is the shortest.
    /// </summary>
    public static int RefreshAfterSeconds(RegionWeatherData? data, DateTimeOffset now)
    {
        var shortest = (int)MinRefreshAfter.TotalSeconds;
        var longest = (int)MaxRefreshAfter.TotalSeconds;
        if (data is null) return longest;
        if (data.MetarRetryAt is not { } retryAt || retryAt <= now) return shortest;
        var wait = (retryAt - now).TotalSeconds;
        return wait >= longest ? longest : Math.Max(shortest, (int)Math.Ceiling(wait));
    }
}

/// <summary>
/// The ceiling of a METAR (plan M6): the base of its lowest broken (<c>BKN</c>), overcast (<c>OVC</c>) or obscured
/// (<c>OVX</c>, <c>VV</c>) layer, in feet. Scattered or few clouds make no ceiling.
/// </summary>
public static class MetarCeiling
{
    /// <summary>The covers that make a ceiling.</summary>
    public static IReadOnlyList<string> Covers { get; } = ["BKN", "OVC", "OVX", "VV"];

    /// <summary>
    /// The ceiling of <paramref name="clouds"/>, in feet; null without a layer that makes one, or when one of those
    /// layers gives no base (the ceiling is then unknown, never guessed); pure.
    /// </summary>
    public static int? Of(IReadOnlyList<AerodromeCloudLayer> clouds)
    {
        ArgumentNullException.ThrowIfNull(clouds);
        int? ceiling = null;
        foreach (var layer in clouds)
        {
            if (!Covers.Contains(layer.Cover, StringComparer.Ordinal)) continue;
            if (layer.BaseFeet is not { } baseFeet) return null;
            if (ceiling is null || baseFeet < ceiling) ceiling = baseFeet;
        }
        return ceiling;
    }
}
