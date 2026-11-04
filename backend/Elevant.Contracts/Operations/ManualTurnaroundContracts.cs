using System.Text.Json.Serialization;

namespace Elevant.Contracts.Operations;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CreateManualTurnaroundRequest(
    Guid TurnaroundId,
    Guid StationId,
    Guid AirlineId,
    Guid StandId,
    DateOnly OperationDate,
    string ArrivalFlightNumber,
    string ArrivalOriginIata,
    DateTimeOffset ArrivalScheduledAt,
    string DepartureFlightNumber,
    string DepartureDestinationIata,
    DateTimeOffset DepartureScheduledAt,
    bool Charter = false);

public sealed record ManualTurnaroundResponse(
    Guid TurnaroundId,
    string OperationCode,
    bool Replayed);

public sealed record ManualTurnaroundAirlineResponse(Guid Id, string IataCode, string Name);

public sealed record ManualTurnaroundOptionsResponse(
    OccStationResponse Station,
    DateOnly Date,
    OccAirportResponse StationAirport,
    IReadOnlyList<ManualTurnaroundAirlineResponse> Airlines,
    IReadOnlyList<OccAirportResponse> Airports,
    IReadOnlyList<OccStandResponse> Stands,
    IReadOnlyList<ManualTurnaroundAirlineResponse>? CharterAirlines = null);
