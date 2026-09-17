namespace Elevant.Contracts.Operations;

public sealed record RampAssignedOperationsResponse(
    IReadOnlyList<RampAssignedOperationResponse> Operations);

public sealed record RampAssignedOperationResponse(
    RampAgentAssignmentResponse Assignment,
    RampGroundOperationResponse Operation,
    RampTurnaroundResponse Turnaround,
    IReadOnlyList<RampOperationServiceResponse> Services);

public sealed record RampAgentAssignmentResponse(
    Guid Id,
    Guid AgentId,
    RampOperationalPositionResponse? Position,
    string AssignmentRole,
    DateTimeOffset AssignedAt);

public sealed record RampOperationalPositionResponse(
    Guid Id,
    string Code,
    string Name);

public sealed record RampGroundOperationResponse(
    Guid Id,
    string Status,
    DateTimeOffset? PlannedStartAt,
    DateTimeOffset? PlannedEndAt,
    DateTimeOffset? ActualStartAt,
    DateTimeOffset? ActualEndAt);

public sealed record RampTurnaroundResponse(
    Guid Id,
    string OperationCode,
    DateOnly OperationDate,
    string Status,
    RampStationResponse Station,
    RampAirlineResponse Airline,
    RampAircraftResponse? Aircraft,
    RampStandResponse? Stand,
    RampFlightLegResponse? Arrival,
    RampFlightLegResponse? Departure);

public sealed record RampStationResponse(
    Guid Id,
    string Code,
    string Name,
    string IanaTimeZone);

public sealed record RampTerminalResponse(Guid Id, string Code, string Name);

public sealed record RampStandResponse(
    Guid Id,
    string Code,
    RampTerminalResponse? Terminal);

public sealed record RampAirlineResponse(
    Guid Id,
    string IataCode,
    string IcaoCode,
    string Name);

public sealed record RampAircraftResponse(
    Guid Id,
    string IcaoCode,
    string? IataCode,
    string Manufacturer,
    string Model,
    string? Registration);

public sealed record RampAirportResponse(
    Guid Id,
    string IataCode,
    string IcaoCode,
    string Name);

public sealed record RampFlightLegResponse(
    Guid Id,
    string FlightNumber,
    RampAirportResponse Origin,
    RampAirportResponse Destination,
    DateTimeOffset ScheduledAt,
    DateTimeOffset? EstimatedAt,
    DateTimeOffset? ActualAt);

public sealed record RampOperationServiceResponse(
    Guid Id,
    int LineNumber,
    Guid ServiceDefinitionId,
    string Code,
    string Name,
    decimal ContractedQuantity,
    decimal ExecutedQuantity,
    string BillingUnit,
    string Status);
