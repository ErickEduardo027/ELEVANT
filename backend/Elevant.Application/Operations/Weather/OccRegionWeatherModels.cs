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
