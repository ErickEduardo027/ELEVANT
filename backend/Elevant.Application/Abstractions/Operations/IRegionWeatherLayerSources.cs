namespace Elevant.Application.Abstractions.Operations;

/// <summary>
/// The box a weather region's layers cover (plan M6 of 27 November 2026), in decimal degrees: west to east
/// (<paramref name="LongitudeMin"/> to <paramref name="LongitudeMax"/>) and south to north (<paramref name="LatitudeMin"/>
/// to <paramref name="LatitudeMax"/>). <paramref name="RadarSite"/> is the ICAO code of the weather radar that covers it
/// (for Punta Cana, San Juan's NEXRAD <c>TJUA</c>); null when none does.
/// </summary>
public sealed record RegionWeatherArea(double LongitudeMin, double LongitudeMax, double LatitudeMin, double LatitudeMax,
    string? RadarSite)
{
    /// <summary>Whether a box from <paramref name="west"/> to <paramref name="east"/> and <paramref name="south"/> to <paramref name="north"/> touches this one.</summary>
    public bool Overlaps(double west, double east, double south, double north) =>
        west <= LongitudeMax && east >= LongitudeMin && south <= LatitudeMax && north >= LatitudeMin;
}

/// <summary>
/// One layer of a region's weather as a source may serve it now (plan M6): <paramref name="Value"/> (null when there is
/// none it may still serve), whether it is the one kept after the last read failed (<paramref name="KeptAfterFailure"/>),
/// how that read failed (<paramref name="Failure"/>, null after one that succeeded) and, while the source waits that
/// failure out, when it asks the service again (<paramref name="RetryAt"/>).
/// </summary>
public sealed record RegionWeatherLayer<T>(T? Value, bool KeptAfterFailure, WeatherServiceFailure? Failure,
    DateTimeOffset? RetryAt) where T : class
{
    /// <summary>A layer with nothing to serve, after a read that failed as <paramref name="failure"/> says (null: none failed).</summary>
    public static RegionWeatherLayer<T> Without(WeatherServiceFailure? failure) => new(null, false, failure, null);
}

/// <summary>A point in decimal degrees, longitude first as GeoJSON orders it.</summary>
public readonly record struct RegionPoint(double Longitude, double Latitude);

/// <summary>
/// An international SIGMET over a region (plan M6), as the weather service publishes it: <paramref name="Id"/> is the
/// service's FIR, series and start of validity, so the same SIGMET keeps it between reads; <paramref name="Hazard"/> is
/// its code (<c>TS</c>, <c>TURB</c>, <c>ICE</c>, <c>VA</c>, <c>MTW</c>, <c>TC</c>…) and <paramref name="Qualifier"/> how it
/// qualifies it (<c>EMBD</c>, <c>SEV</c>…, or the volcano's name). Its levels are in feet (null when it gives none) and
/// <paramref name="Polygon"/> is the area it covers, a closed ring of at least four points. A SIGMET whose area is several
/// polygons travels as one SIGMET per polygon.
/// </summary>
public sealed record RegionSigmet(string Id, string? FirId, string Hazard, string? Qualifier, DateTimeOffset ValidFrom,
    DateTimeOffset ValidTo, int? BaseFeet, int? TopFeet, string Raw, IReadOnlyList<RegionPoint> Polygon);

/// <summary>
/// The wind 10 m above the ground on a coarse grid over a region (plan M6), as the forecast service gives it for
/// <paramref name="ValidAt"/>: <paramref name="Columns"/> points west to east and <paramref name="Rows"/> south to north,
/// evenly spread over the box, the edges included. <paramref name="Points"/> holds those the service answered.
/// </summary>
public sealed record RegionWindGrid(DateTimeOffset ValidAt, RegionWeatherArea Area, int Columns, int Rows,
    IReadOnlyList<RegionWindPoint> Points);

/// <summary>The wind at one point of the grid: knots, and the degrees true it blows from.</summary>
public sealed record RegionWindPoint(double Latitude, double Longitude, double SpeedKnots, int DirectionDegrees);

/// <summary>
/// The radar frames over a region (plan M6): <paramref name="Provider"/> names who draws them (<c>iem-tjua</c>: San Juan's
/// NEXRAD through the Iowa Environmental Mesonet), <paramref name="MaxZoom"/> is the deepest zoom it has tiles for, and
/// <paramref name="Frames"/> are the latest scans, oldest first.
/// </summary>
public sealed record RegionRadarFrames(string Provider, int MaxZoom, IReadOnlyList<RegionRadarFrame> Frames);

/// <summary>One radar scan: when it was taken and the address of its tiles, with <c>{z}</c>, <c>{x}</c> and <c>{y}</c> to fill.</summary>
public sealed record RegionRadarFrame(DateTimeOffset Time, string TileUrlTemplate);

/// <summary>
/// The international SIGMETs over a region (plan M6), read only when someone asks and kept in memory. Null when no
/// SIGMET service is configured, and then nothing is called. A refusal, a timeout or an answer that cannot be read
/// leaves what the source may still serve, never an exception; only the caller's own cancellation is thrown.
/// </summary>
public interface IRegionSigmetSource
{
    Task<RegionWeatherLayer<IReadOnlyList<RegionSigmet>>?> ReadAsync(RegionWeatherArea area,
        CancellationToken cancellationToken = default);
}

/// <summary>The wind grid over a region (plan M6), with the rules of <see cref="IRegionSigmetSource"/>.</summary>
public interface IRegionWindSource
{
    Task<RegionWeatherLayer<RegionWindGrid>?> ReadAsync(RegionWeatherArea area, CancellationToken cancellationToken = default);
}

/// <summary>
/// The radar frames over a region (plan M6), with the rules of <see cref="IRegionSigmetSource"/>. A region without a
/// radar site is never asked about.
/// </summary>
public interface IRegionRadarSource
{
    Task<RegionWeatherLayer<RegionRadarFrames>?> ReadAsync(RegionWeatherArea area,
        CancellationToken cancellationToken = default);
}

/// <summary>The SIGMET source of every host without one (tools, tests, <c>AviationWeather:Enabled</c> off): nothing is called.</summary>
public sealed class DisabledRegionSigmetSource : IRegionSigmetSource
{
    public Task<RegionWeatherLayer<IReadOnlyList<RegionSigmet>>?> ReadAsync(RegionWeatherArea area,
        CancellationToken cancellationToken = default) => Task.FromResult<RegionWeatherLayer<IReadOnlyList<RegionSigmet>>?>(null);
}

/// <summary>The wind source of every host without one (tools, tests, <c>OpenMeteo:Enabled</c> off): nothing is called.</summary>
public sealed class DisabledRegionWindSource : IRegionWindSource
{
    public Task<RegionWeatherLayer<RegionWindGrid>?> ReadAsync(RegionWeatherArea area,
        CancellationToken cancellationToken = default) => Task.FromResult<RegionWeatherLayer<RegionWindGrid>?>(null);
}

/// <summary>The radar source of every host without one (tools, tests, <c>WeatherRadar:Enabled</c> off): nothing is called.</summary>
public sealed class DisabledRegionRadarSource : IRegionRadarSource
{
    public Task<RegionWeatherLayer<RegionRadarFrames>?> ReadAsync(RegionWeatherArea area,
        CancellationToken cancellationToken = default) => Task.FromResult<RegionWeatherLayer<RegionRadarFrames>?>(null);
}
