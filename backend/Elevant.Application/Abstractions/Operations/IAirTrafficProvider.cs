namespace Elevant.Application.Abstractions.Operations;

/// <summary>
/// An open ADS-B network the OCC map reads live aircraft from (ADR-0042, contracts 1.3). One read returns the aircraft
/// around a point as the network sees them now, in aviation units (feet, knots, feet per minute). Nothing is persisted,
/// and the network is never asked for an aircraft's past track: the trails come only from what earlier reads saw.
/// </summary>
public interface IAirTrafficProvider
{
    /// <summary>False when no network is configured: <see cref="ReadAsync"/> then answers Failed and calls nothing.</summary>
    bool IsConfigured { get; }

    /// <summary>
    /// The credit of the network that answers the reads, which every map shows; null when nothing is configured. With a
    /// list of networks it is the active one, and it changes when another one takes over.
    /// </summary>
    AirTrafficAttribution? Attribution { get; }

    /// <summary>
    /// One read of the network around the area. A refusal, a timeout or an answer that cannot be read comes back as
    /// its outcome, never as an exception; only the caller's own cancellation is thrown.
    /// </summary>
    Task<AirTrafficReadResult> ReadAsync(AirTrafficArea area, CancellationToken cancellationToken = default);
}

/// <summary>The circle a read asks for: its centre in decimal degrees and its radius in nautical miles.</summary>
public sealed record AirTrafficArea(double Latitude, double Longitude, int RadiusNm);

/// <summary>How a read ended.</summary>
public enum AirTrafficOutcome
{
    /// <summary>The network answered and its answer was read (the aircraft list may be empty).</summary>
    Succeeded,

    /// <summary>The network asked to slow down (HTTP 429); <see cref="AirTrafficReadResult.RetryAfter"/> says for how long when it said so.</summary>
    RateLimited,

    /// <summary>The network refused the address or the key (HTTP 401 or 403).</summary>
    Unauthorized,

    /// <summary>The day's own request budget for this network is spent; nothing was sent.</summary>
    QuotaExceeded,

    /// <summary>A timeout, a network error, another status or an answer that cannot be read; or nothing is configured.</summary>
    Failed,
}

/// <summary>
/// The result of one read. <paramref name="Source"/> is the credit of the network that was asked (null only without a
/// configured network); <paramref name="ObservedAt"/> is the instant the network's answer describes, and
/// <paramref name="Aircraft"/> is empty unless the read succeeded.
/// </summary>
public sealed record AirTrafficReadResult(AirTrafficOutcome Outcome, AirTrafficAttribution? Source,
    DateTimeOffset? ObservedAt, IReadOnlyList<AirTrafficAircraft> Aircraft, TimeSpan? RetryAfter)
{
    /// <summary>A read that brought no aircraft: anything but <see cref="AirTrafficOutcome.Succeeded"/>.</summary>
    public static AirTrafficReadResult Failure(AirTrafficOutcome outcome, AirTrafficAttribution? source,
        TimeSpan? retryAfter = null) => new(outcome, source, null, [], retryAfter);
}

/// <summary>
/// One aircraft of a read. <paramref name="Hex"/> is its ICAO 24-bit address, six lower-case hexadecimal digits;
/// <paramref name="AltitudeFeet"/> is null on the ground; <paramref name="PositionAt"/> is when the network last placed it.
/// </summary>
public sealed record AirTrafficAircraft(string Hex, string? Callsign, string? Registration, string? TypeIcaoCode,
    string? Category, double Latitude, double Longitude, int? AltitudeFeet, bool OnGround, double? GroundSpeedKnots,
    double? TrackDegrees, int? VerticalRateFeetPerMinute, string? Squawk, DateTimeOffset PositionAt);

/// <summary>
/// What a network requires to be shown wherever its data is: its name, its home page and its licence (owner decision 6).
/// </summary>
public sealed record AirTrafficAttribution(string Name, string HomeUrl, string LicenseName, string? LicenseUrl);

/// <summary>
/// The provider without a configured network, the default of every host (tools, tests, an API with
/// <c>AirTraffic:Enabled</c> off or no <c>AirTraffic:Providers</c>): it reports itself unconfigured and never calls anything.
/// </summary>
public sealed class UnconfiguredAirTrafficProvider : IAirTrafficProvider
{
    public bool IsConfigured => false;

    public AirTrafficAttribution? Attribution => null;

    public Task<AirTrafficReadResult> ReadAsync(AirTrafficArea area, CancellationToken cancellationToken = default) =>
        Task.FromResult(AirTrafficReadResult.Failure(AirTrafficOutcome.Failed, null));
}
