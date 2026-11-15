namespace Elevant.Application.Abstractions.Operations;

/// <summary>
/// The weather of an airport for the OCC (ADR-0043, contracts 1.4): its latest METAR, decoded and raw, and its latest
/// TAF, raw and in periods, as a weather service publishes them. The service is asked only when someone reads an
/// airport's weather, and what it answered is kept in memory; nothing is persisted.
/// </summary>
public interface IAerodromeWeatherSource
{
    /// <summary>
    /// The weather of the airport whose ICAO code is <paramref name="icaoCode"/>; null when no weather service is
    /// configured, and then nothing is called. A refusal, a timeout or an answer that cannot be read leaves the reports the
    /// source may still serve, never an exception; only the caller's own cancellation is thrown.
    /// </summary>
    Task<AerodromeWeatherData?> ReadAsync(string icaoCode, CancellationToken cancellationToken = default);
}

/// <summary>
/// The weather of one airport. <paramref name="Metar"/> and <paramref name="Taf"/> are null when the service has no
/// report for it, or none the source may still serve. <paramref name="MetarKeptAfterFailure"/> is true when the METAR is
/// the one kept from an earlier read because the last refresh failed or the service is being waited out.
/// <paramref name="RetrievedAt"/> is the last time the service answered a read for this airport; null before it ever did.
/// </summary>
public sealed record AerodromeWeatherData(string IcaoCode, AerodromeMetar? Metar, bool MetarKeptAfterFailure,
    AerodromeTaf? Taf, DateTimeOffset? RetrievedAt);

/// <summary>
/// A METAR: its raw text, the instant it describes and its basics in aviation units (degrees true, knots, statute miles,
/// degrees Celsius and hectopascals). <paramref name="WindVariable"/> marks a variable wind, which leaves
/// <paramref name="WindDirectionDegrees"/> null; <paramref name="FlightCategory"/> is VFR, MVFR, IFR or LIFR;
/// <paramref name="Weather"/> is the present weather as the report codes it (for example <c>-RA BR</c>).
/// </summary>
public sealed record AerodromeMetar(string Raw, DateTimeOffset ObservedAt, string? FlightCategory,
    int? WindDirectionDegrees, bool WindVariable, int? WindSpeedKnots, int? WindGustKnots,
    double? VisibilityStatuteMiles, double? TemperatureCelsius, double? DewpointCelsius,
    double? AltimeterHectopascals, string? Weather, IReadOnlyList<AerodromeCloudLayer> Clouds);

/// <summary>A cloud layer: its cover (FEW, SCT, BKN, OVC…) and its base in feet above the aerodrome, null when not given.</summary>
public sealed record AerodromeCloudLayer(string Cover, int? BaseFeet);

/// <summary>A TAF: its raw text, when it was issued, the time it covers and its periods in the order it gives them.</summary>
public sealed record AerodromeTaf(string Raw, DateTimeOffset IssuedAt, DateTimeOffset ValidFrom, DateTimeOffset ValidTo,
    IReadOnlyList<AerodromeTafPeriod> Periods);

/// <summary>
/// One period of a TAF, from <paramref name="From"/> to <paramref name="To"/>, in the units of
/// <see cref="AerodromeMetar"/>. <paramref name="Change"/> is how the period starts (FM, BECMG, TEMPO or PROB; null for
/// the first one) and <paramref name="ProbabilityPercent"/> the chance a PROB group gives it.
/// </summary>
public sealed record AerodromeTafPeriod(DateTimeOffset From, DateTimeOffset To, string? Change, int? ProbabilityPercent,
    int? WindDirectionDegrees, bool WindVariable, int? WindSpeedKnots, int? WindGustKnots, double? VisibilityStatuteMiles,
    string? Weather, IReadOnlyList<AerodromeCloudLayer> Clouds);

/// <summary>What a weather service requires to be shown wherever its data is: its name and its home page.</summary>
public sealed record AerodromeWeatherAttribution(string Name, string HomeUrl)
{
    /// <summary>The service the OCC reads its weather from, aviationweather.gov.</summary>
    public static AerodromeWeatherAttribution NoaaAviationWeatherCenter { get; } =
        new("NOAA Aviation Weather Center", "https://aviationweather.gov");
}

/// <summary>
/// The source without a weather service, the default of every host (tools, tests, an API with
/// <c>AviationWeather:Enabled</c> off): every read answers null and nothing is ever called.
/// </summary>
public sealed class DisabledAerodromeWeatherSource : IAerodromeWeatherSource
{
    public Task<AerodromeWeatherData?> ReadAsync(string icaoCode, CancellationToken cancellationToken = default) =>
        Task.FromResult<AerodromeWeatherData?>(null);
}
