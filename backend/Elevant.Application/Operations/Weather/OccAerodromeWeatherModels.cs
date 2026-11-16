using Elevant.Application.Abstractions.Operations;

namespace Elevant.Application.Operations.Weather;

/// <summary>
/// The weather of a station's airport as the OCC reads it (ADR-0043, contracts 1.4). <paramref name="IcaoCode"/> is the
/// airport's, four letters in upper case; <paramref name="Status"/> one of <see cref="AerodromeWeatherStatus"/>, resolved
/// at <paramref name="ServerTime"/>. <paramref name="RetrievedAt"/> is the last time the weather service answered for the
/// airport (null before it ever did, and always while it is <see cref="AerodromeWeatherStatus.Disabled"/>, which has no
/// report either). <paramref name="Source"/> is the credit every screen shows with the weather, also while it is disabled.
/// </summary>
public sealed record OccAerodromeWeatherData(Guid StationId, string IcaoCode, string Status, DateTimeOffset ServerTime,
    DateTimeOffset? RetrievedAt, AerodromeWeatherAttribution Source, AerodromeMetar? Metar, AerodromeTaf? Taf);
