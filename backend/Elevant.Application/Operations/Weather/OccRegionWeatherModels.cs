using Elevant.Application.Abstractions.Operations;

namespace Elevant.Application.Operations.Weather;

/// <summary>
/// The weather of the region around a station's airport as the OCC reads it (plan M6). <paramref name="Status"/> is one
/// of <see cref="AerodromeWeatherStatus"/> and <paramref name="Reason"/> one of <see cref="RegionWeatherReasons"/> (null
/// when there is nothing to explain), both resolved at <paramref name="ServerTime"/>; screens ask again after
/// <paramref name="RefreshAfterSeconds"/> (300 to 900). <paramref name="Credit"/> is the credit every screen shows with
/// the weather, also while it is disabled. <paramref name="Stations"/> holds every airport of the region, in the order of
/// <see cref="RegionWeatherStations"/>, with or without its reports.
/// </summary>
public sealed record OccRegionWeatherData(Guid StationId, string Status, string? Reason, DateTimeOffset ServerTime,
    int RefreshAfterSeconds, AerodromeWeatherAttribution Credit, IReadOnlyList<OccRegionStationWeather> Stations);

/// <summary>
/// One airport of the region with its latest METAR and the ceiling it gives (<see cref="MetarCeiling"/>), and its latest
/// TAF; each null when the service has none, or none the source may still serve.
/// </summary>
public sealed record OccRegionStationWeather(RegionWeatherStation Station, AerodromeMetar? Metar, int? CeilingFeet,
    AerodromeTaf? Taf);

/// <summary>
/// The international SIGMETs over the region around a station's airport as the OCC reads them (plan M6), with the state,
/// reason, pace and credit of <see cref="OccRegionWeatherData"/>. <paramref name="Sigmets"/> holds those that touch the
/// region's box and are still valid at <paramref name="ServerTime"/>, ordered by the end of their validity; an empty list
/// with a live state means there are none.
/// </summary>
public sealed record OccRegionSigmetsData(Guid StationId, string Status, string? Reason, DateTimeOffset ServerTime,
    int RefreshAfterSeconds, AerodromeWeatherAttribution Credit, IReadOnlyList<RegionSigmet> Sigmets);

/// <summary>
/// The wind grid over the region around a station's airport as the OCC reads it (plan M6), with the state, reason, pace and
/// credit of <see cref="OccRegionWeatherData"/>. <paramref name="Grid"/> always has the region's box and shape; its points
/// and <paramref name="ValidAt"/> only when the service gave them.
/// </summary>
public sealed record OccRegionWindData(Guid StationId, string Status, string? Reason, DateTimeOffset ServerTime,
    int RefreshAfterSeconds, AerodromeWeatherAttribution Credit, DateTimeOffset? ValidAt, RegionWindGrid Grid);

/// <summary>
/// The radar frames over the region around a station's airport as the OCC reads them (plan M6), with the state, reason,
/// pace and credit of <see cref="OccRegionWeatherData"/>. <paramref name="Provider"/> is null, and
/// <paramref name="Frames"/> empty, when there is nothing to draw.
/// </summary>
public sealed record OccRegionRadarData(Guid StationId, string Status, string? Reason, DateTimeOffset ServerTime,
    int RefreshAfterSeconds, AerodromeWeatherAttribution Credit, string? Provider, int MaxZoom,
    IReadOnlyList<RegionRadarFrame> Frames);

/// <summary>The shape of a region's wind grid (plan M6): 10 points west to east by 8 south to north, 80 in one request.</summary>
public static class RegionWindGridShape
{
    public const int Columns = 10;

    public const int Rows = 8;
}
