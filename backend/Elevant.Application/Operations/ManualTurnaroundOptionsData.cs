namespace Elevant.Application.Operations;

public sealed record ManualTurnaroundAirlineData(Guid Id, string IataCode, string Name);

public sealed record ManualTurnaroundOptionsData(
    OccStationData Station,
    DateOnly Date,
    OccAirportData StationAirport,
    IReadOnlyList<ManualTurnaroundAirlineData> Airlines,
    IReadOnlyList<OccAirportData> Airports,
    IReadOnlyList<OccStandData> Stands,
    IReadOnlyList<ManualTurnaroundAirlineData>? CharterAirlines = null);
