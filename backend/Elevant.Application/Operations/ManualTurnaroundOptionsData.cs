namespace Elevant.Application.Operations;

public sealed record ManualTurnaroundAirlineData(Guid Id, string IataCode, string Name);

/// <summary>An active aircraft type OCC can give a new flight («type once», 2-A).</summary>
public sealed record ManualTurnaroundAircraftTypeData(Guid Id, string IcaoCode, string? IataCode, string Manufacturer,
    string Model, string? SizeCategory);

public sealed record ManualTurnaroundOptionsData(
    OccStationData Station,
    DateOnly Date,
    OccAirportData StationAirport,
    IReadOnlyList<ManualTurnaroundAirlineData> Airlines,
    IReadOnlyList<OccAirportData> Airports,
    IReadOnlyList<OccStandData> Stands,
    IReadOnlyList<ManualTurnaroundAirlineData>? CharterAirlines = null,
    IReadOnlyList<ManualTurnaroundAircraftTypeData>? AircraftTypes = null);
