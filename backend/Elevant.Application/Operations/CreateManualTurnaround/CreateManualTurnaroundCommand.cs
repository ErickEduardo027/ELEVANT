namespace Elevant.Application.Operations.CreateManualTurnaround;

public sealed record CreateManualTurnaroundCommand(
    Guid AccountId,
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
    Guid CorrelationId,
    string RequestId,
    bool Charter = false);
