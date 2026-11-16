namespace Elevant.Contracts.Operations;

/// <summary>
/// The weather of a station's airport for the OCC (ADR-0043, contracts 1.4): its latest METAR, decoded and raw, and its
/// latest TAF, raw and in periods, from the Data API of aviationweather.gov. The API reads the service only when someone
/// asks and keeps its answers (the METAR five minutes, the TAF thirty), so screens may ask often without reaching it. It
/// always comes in a 200: <paramref name="Status"/> is <c>Live</c> (a METAR at most 90 minutes older than
/// <paramref name="ServerTime"/>), <c>Stale</c> (an older METAR, or the one kept after the service failed),
/// <c>Unavailable</c> (no METAR to show; the TAF may still come) or <c>Disabled</c> (no weather service here: no METAR,
/// no TAF and no <paramref name="RetrievedAt"/>). <paramref name="IcaoCode"/> is the airport's, four letters in upper
/// case. <paramref name="RetrievedAt"/> is the last time the service answered for this airport; null before it ever did.
/// <paramref name="Source"/> is the credit every screen shows with the weather, also while it is disabled.
/// </summary>
public sealed record OccAerodromeWeatherResponse(Guid StationId, string IcaoCode, string Status, DateTimeOffset ServerTime,
    DateTimeOffset? RetrievedAt, OccWeatherSourceResponse Source, OccMetarResponse? Metar, OccTafResponse? Taf);

/// <summary>What the weather service requires wherever its data is shown: its name and its home page.</summary>
public sealed record OccWeatherSourceResponse(string Name, string HomeUrl);

/// <summary>
/// A METAR: its raw text (screens may decode the rest from it), the instant it describes and its basics in aviation units:
/// degrees true, knots, statute miles, degrees Celsius and hectopascals. <paramref name="FlightCategory"/> is <c>VFR</c>,
/// <c>MVFR</c>, <c>IFR</c> or <c>LIFR</c>; <paramref name="WindVariable"/> marks a variable wind, which has no
/// <paramref name="WindDirectionDegrees"/>; <paramref name="Weather"/> is the present weather as the report codes it
/// (for example <c>-RA BR</c>). A value the report does not give, or gives out of its range, is null.
/// </summary>
public sealed record OccMetarResponse(string Raw, DateTimeOffset ObservedAt, string? FlightCategory, int? WindDirectionDegrees,
    bool WindVariable, int? WindSpeedKnots, int? WindGustKnots, double? VisibilityStatuteMiles, double? TemperatureCelsius,
    double? DewpointCelsius, double? AltimeterHectopascals, string? Weather, IReadOnlyList<OccCloudLayerResponse> Clouds);

/// <summary>A cloud layer: its cover (<c>FEW</c>, <c>SCT</c>, <c>BKN</c>, <c>OVC</c>, <c>VV</c>…) and its base in feet; null when not given.</summary>
public sealed record OccCloudLayerResponse(string Cover, int? BaseFeet);

/// <summary>A TAF: its raw text, when it was issued, the time it covers and its periods in the order it gives them.</summary>
public sealed record OccTafResponse(string Raw, DateTimeOffset IssuedAt, DateTimeOffset ValidFrom, DateTimeOffset ValidTo,
    IReadOnlyList<OccTafPeriodResponse> Periods);

/// <summary>
/// One period of a TAF, from <paramref name="From"/> to <paramref name="To"/>, in the units of the METAR.
/// <paramref name="Change"/> is how the period starts (<c>FM</c>, <c>BECMG</c>, <c>TEMPO</c> or <c>PROB</c>; null for
/// the first one) and <paramref name="ProbabilityPercent"/> the chance a <c>PROB</c> group gives it.
/// </summary>
public sealed record OccTafPeriodResponse(DateTimeOffset From, DateTimeOffset To, string? Change, int? ProbabilityPercent,
    int? WindDirectionDegrees, bool WindVariable, int? WindSpeedKnots, int? WindGustKnots, double? VisibilityStatuteMiles,
    string? Weather, IReadOnlyList<OccCloudLayerResponse> Clouds);
