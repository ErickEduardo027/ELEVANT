using Elevant.Application.Abstractions.Operations;

namespace Elevant.Application.Operations.AirPicture;

/// <summary>
/// The state of the live aircraft the OCC map shows (ADR-0042, contracts 1.3). It always travels in a 200: an empty list
/// never passes for success, because the state says why it is empty, and the rest of the map keeps drawing.
/// </summary>
public static class AirPictureStatus
{
    /// <summary>The last read is recent: no older than 30 seconds or two and a half intervals.</summary>
    public const string Live = "Live";

    /// <summary>The last good read is up to ten minutes old: its aircraft are still shown, dimmed by the screens.</summary>
    public const string Stale = "Stale";

    /// <summary>Someone started watching again and the first read has not come back yet: no aircraft for a moment.</summary>
    public const string Warming = "Warming";

    /// <summary>Nothing read in the last ten minutes and the last attempt failed: no aircraft.</summary>
    public const string Unavailable = "Unavailable";

    /// <summary><c>AirTraffic</c> is off or names no network: nothing is ever read.</summary>
    public const string Disabled = "Disabled";

    /// <summary>Every state, in the order above.</summary>
    public static IReadOnlyList<string> All { get; } = [Live, Stale, Warming, Unavailable, Disabled];
}

/// <summary>
/// Why the picture is not live (contracts 1.3): a stable code the screens translate and never print as it is.
/// </summary>
public static class AirPictureReasons
{
    /// <summary>No network is configured, or <c>AirTraffic:Enabled</c> is off.</summary>
    public const string NotConfigured = "not_configured";

    /// <summary>The day's own request budget for the network is spent.</summary>
    public const string QuotaExceeded = "quota_exceeded";

    /// <summary>The network asked to slow down (HTTP 429).</summary>
    public const string RateLimited = "rate_limited";

    /// <summary>The network refused the address or the key (HTTP 401 or 403).</summary>
    public const string Unauthorized = "unauthorized";

    /// <summary>A timeout, a network error, another status or an answer that could not be read.</summary>
    public const string ProviderError = "provider_error";

    /// <summary>Every reason, in the order above.</summary>
    public static IReadOnlyList<string> All { get; } = [NotConfigured, QuotaExceeded, RateLimited, Unauthorized, ProviderError];

    /// <summary>The reason of a read that brought no aircraft; null for a successful read.</summary>
    public static string? Of(AirTrafficOutcome outcome) => outcome switch
    {
        AirTrafficOutcome.Succeeded => null,
        AirTrafficOutcome.RateLimited => RateLimited,
        AirTrafficOutcome.Unauthorized => Unauthorized,
        AirTrafficOutcome.QuotaExceeded => QuotaExceeded,
        _ => ProviderError,
    };
}

/// <summary>
/// One point of an aircraft's trail, as a read placed it: when, where, how high (null on the ground or when the network
/// did not say) and whether it was on the ground.
/// </summary>
public sealed record AirTrailPoint(DateTimeOffset At, double Latitude, double Longitude, int? AltitudeFeet, bool OnGround);

/// <summary>
/// An aircraft of the picture with its short trail: the last points of its current segment, oldest first (at most eight,
/// or none when the screen asked for none).
/// </summary>
public sealed record AirPictureAircraft(AirTrafficAircraft Aircraft, IReadOnlyList<AirTrailPoint> Trail);

/// <summary>
/// The picture as it is served from memory (contracts 1.3). <paramref name="ObservedAt"/> is the instant the network's
/// answer describes and <paramref name="AgeSeconds"/> how long before <paramref name="ServerTime"/> that was;
/// <paramref name="RefreshAfterSeconds"/> is the pace the screens ask again at, never faster; <paramref name="Source"/>
/// is the credit every map shows, null only while nothing is configured.
/// </summary>
public sealed record AirPictureSnapshot(string Status, string? Reason, DateTimeOffset ServerTime, DateTimeOffset? ObservedAt,
    int? AgeSeconds, int RefreshAfterSeconds, AirTrafficAttribution? Source, IReadOnlyList<AirPictureAircraft> Aircraft);

/// <summary>
/// The trail of one aircraft from memory (contracts 1.3): its last segment only, at most 600 points, oldest first. The
/// network is never asked for it.
/// </summary>
public sealed record AirTrackData(string Hex, DateTimeOffset ServerTime, AirTrafficAttribution? Source,
    IReadOnlyList<AirTrailPoint> Points);
