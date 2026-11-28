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

/// <summary>
/// The weather of the region around a station's airport for the OCC (plan M6): the latest METAR and TAF of every airport
/// of the region (Punta Cana's: the 32 airports within 300 NM that the maps draw in Región), from the Data API of
/// aviationweather.gov, read for the whole region at once and kept by the API (the METARs five minutes, the TAFs
/// thirty). It always comes in a 200: <paramref name="Status"/> is <c>Live</c> (at least one METAR at most 90 minutes
/// older than <paramref name="ServerTime"/>), <c>Stale</c> (every METAR is older, or they are the ones kept after the
/// service failed), <c>Unavailable</c> (no METAR of any airport; TAFs may still come) or <c>Disabled</c> (no weather
/// service here: no report at all). <paramref name="Reason"/> says why it is not live: <c>not_configured</c>,
/// <c>rate_limited</c> or <c>provider_error</c>, the air picture's codes (null when there is nothing to explain).
/// Screens ask again after <paramref name="RefreshAfterSeconds"/> (300 to 900), never sooner. <paramref name="Credit"/>
/// is the credit every screen shows with the weather, also while it is disabled. <paramref name="Stations"/> lists every
/// airport of the region, nearest first, with or without its reports.
/// </summary>
public sealed record OccRegionWeatherResponse(Guid StationId, string Status, string? Reason, DateTimeOffset ServerTime,
    int RefreshAfterSeconds, OccRegionWeatherCreditResponse Credit, IReadOnlyList<OccRegionWeatherStationResponse> Stations);

/// <summary>What the weather service requires wherever its data is shown: its name and its home page.</summary>
public sealed record OccRegionWeatherCreditResponse(string Name, string Url);

/// <summary>
/// One airport of the region: its ICAO code, its IATA code and its name (each null when it has none) and where it is in
/// decimal degrees, with its latest METAR and its latest TAF (null when the service has none now).
/// </summary>
public sealed record OccRegionWeatherStationResponse(string Icao, string? Iata, string? Name, double Latitude,
    double Longitude, OccRegionMetarResponse? Metar, OccRegionTafResponse? Taf);

/// <summary>
/// The latest METAR of an airport of the region: its raw text, the instant it describes and its basics in aviation units
/// (degrees true, knots, statute miles, feet, degrees Celsius and hectopascals). <paramref name="WindDirectionDegrees"/>
/// is null for a variable wind (or one the report does not give); <paramref name="CeilingFeet"/> is the base of the
/// lowest broken, overcast or obscured layer (null without one, or when its base is not given);
/// <paramref name="FlightCategory"/> is the service's own, <c>VFR</c>, <c>MVFR</c>, <c>IFR</c> or <c>LIFR</c>. A value
/// the report does not give, or gives out of its range, is null.
/// </summary>
public sealed record OccRegionMetarResponse(string Raw, DateTimeOffset ObservedAt, int? WindDirectionDegrees,
    int? WindSpeedKnots, int? WindGustKnots, double? VisibilityStatuteMiles, int? CeilingFeet, string? FlightCategory,
    double? TemperatureCelsius, double? DewpointCelsius, double? AltimeterHectopascals);

/// <summary>The latest TAF of an airport of the region: its raw text, when it was issued and the time it covers.</summary>
public sealed record OccRegionTafResponse(string Raw, DateTimeOffset IssuedAt, DateTimeOffset ValidFrom,
    DateTimeOffset ValidTo);

/// <summary>
/// The international SIGMETs over the region around a station's airport for the OCC (plan M6): those of the Data API of
/// aviationweather.gov whose area touches the region's box (Punta Cana's: 12°N to 24°N, 76°W to 60°W) and are still valid
/// at <paramref name="ServerTime"/>, ordered by the end of their validity. The API reads the worldwide list once for the
/// region and keeps it ten minutes. <paramref name="Status"/>, <paramref name="Reason"/> and
/// <paramref name="RefreshAfterSeconds"/> (600 while the service answers, 300 to 900 while a failure is waited out) work
/// as in <see cref="OccRegionWeatherResponse"/>; a live state with no SIGMET means there are none.
/// </summary>
public sealed record OccSigmetsResponse(Guid StationId, string Status, string? Reason, DateTimeOffset ServerTime,
    int RefreshAfterSeconds, OccRegionWeatherCreditResponse Credit, IReadOnlyList<OccSigmetResponse> Sigmets);

/// <summary>
/// One SIGMET: <paramref name="Id"/> is the service's FIR, series and start of validity (stable between reads, not an
/// identifier of ELEVANT); <paramref name="FirId"/> the FIR it covers (null when not given); <paramref name="Hazard"/> its
/// code (<c>TS</c>, <c>TURB</c>, <c>ICE</c>, <c>VA</c>, <c>MTW</c>, <c>TC</c>…) and <paramref name="Qualifier"/> how it
/// qualifies it (<c>EMBD</c>, <c>SEV</c>…, null when not given). Its levels are in feet (null when not given) and
/// <paramref name="Polygon"/> is its area as a closed ring of <c>[longitude, latitude]</c> pairs, ready for GeoJSON. A
/// SIGMET of several areas comes as one per area.
/// </summary>
public sealed record OccSigmetResponse(string Id, string? FirId, string Hazard, string? Qualifier, DateTimeOffset ValidFrom,
    DateTimeOffset ValidTo, int? BaseFeet, int? TopFeet, string Raw, IReadOnlyList<IReadOnlyList<double>> Polygon);

/// <summary>
/// The wind 10 m above the ground over the region around a station's airport for the OCC (plan M6): a coarse grid from
/// the forecast API of Open-Meteo (CC BY 4.0; its free tier is non-commercial, so only Development turns it on), read for
/// the whole grid at once and kept an hour. <paramref name="ValidAt"/> is the time the service gives the wind for (null
/// without a grid). <paramref name="Status"/>, <paramref name="Reason"/> and <paramref name="RefreshAfterSeconds"/> (3600
/// while the service answers, 300 to 3600 while a failure is waited out) work as in <see cref="OccRegionWeatherResponse"/>.
/// </summary>
public sealed record OccWindGridResponse(Guid StationId, string Status, string? Reason, DateTimeOffset ServerTime,
    int RefreshAfterSeconds, OccRegionWeatherCreditResponse Credit, DateTimeOffset? ValidAt, OccWindGridAreaResponse Grid);

/// <summary>
/// The grid: its box in decimal degrees and its shape, <paramref name="Columns"/> points west to east by
/// <paramref name="Rows"/> south to north, evenly spread with the edges included. <paramref name="Points"/> holds those the
/// service answered (none while there is no grid).
/// </summary>
public sealed record OccWindGridAreaResponse(double LonMin, double LonMax, double LatMin, double LatMax, int Columns, int Rows,
    IReadOnlyList<OccWindPointResponse> Points);

/// <summary>The wind at one point of the grid: knots, and the degrees true it blows from.</summary>
public sealed record OccWindPointResponse(double Latitude, double Longitude, double SpeedKnots, int DirectionDegrees);

/// <summary>
/// The radar frames over the region around a station's airport for the OCC (plan M6): the latest scans of San Juan's
/// NEXRAD (TJUA, NOAA), as tiles of the Iowa Environmental Mesonet (<paramref name="Provider"/> <c>iem-tjua</c>; RainViewer,
/// whose free API is for personal and educational use only, is not used, so <c>rainviewer</c> never comes now). The index
/// is kept five minutes. <paramref name="MaxZoom"/> is the deepest zoom of the tiles (0 without frames);
/// <paramref name="Frames"/> are oldest first, each with its tile address (<c>{z}</c>, <c>{x}</c>, <c>{y}</c> to fill, XYZ).
/// <paramref name="Provider"/> is null, and the frames empty, when there is nothing to draw. <paramref name="Status"/>,
/// <paramref name="Reason"/> and <paramref name="RefreshAfterSeconds"/> (300 while the service answers, 300 to 900 while a
/// failure is waited out) work as in <see cref="OccRegionWeatherResponse"/>; frames whose latest scan is older than 30
/// minutes are <c>Stale</c>.
/// </summary>
public sealed record OccRadarFramesResponse(Guid StationId, string Status, string? Reason, DateTimeOffset ServerTime,
    int RefreshAfterSeconds, OccRegionWeatherCreditResponse Credit, string? Provider, int MaxZoom,
    IReadOnlyList<OccRadarFrameResponse> Frames);

/// <summary>One radar scan: when it was taken and the address of its tiles.</summary>
public sealed record OccRadarFrameResponse(DateTimeOffset Time, string TileUrlTemplate);
