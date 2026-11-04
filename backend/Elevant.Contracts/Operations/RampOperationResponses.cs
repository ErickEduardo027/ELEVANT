namespace Elevant.Contracts.Operations;

public sealed record RampAssignedOperationsResponse(
    IReadOnlyList<RampAssignedOperationResponse> Operations);

public sealed record RampOperationStartResponse(
    Guid ReceiptId,
    RampGroundOperationResponse Operation);

public sealed record RampAssignedOperationResponse(
    RampAgentAssignmentResponse Assignment,
    RampGroundOperationResponse Operation,
    RampTurnaroundResponse Turnaround,
    IReadOnlyList<RampOperationServiceResponse> Services,
    RampReviewFeedbackResponse? Review,
    IReadOnlyList<RampMilestoneResponse> Milestones);

/// <summary>A recorded Flight Report milestone (ADR-0031).</summary>
public sealed record RampMilestoneResponse(string Code, DateTimeOffset ActualAt);

/// <summary>Milestones and flight data after a Flight Report write from the tablet (ADR-0031).</summary>
public sealed record RampExecutionResponse(Guid ReceiptId, Guid OperationId, IReadOnlyList<RampMilestoneResponse> Milestones,
    int? PassengersIn, int? PassengersOut, int? MtowKg, string? AircraftRegistration);

public sealed record RecordRampMilestoneRequest(DateTimeOffset OccurredAt);

/// <param name="AircraftRegistration">Correction typed once on the ramp; null keeps the current one.</param>
public sealed record UpdateRampFlightDataRequest(int? PassengersIn, int? PassengersOut, int? MtowKg,
    string? AircraftRegistration);

public sealed record RampReviewFeedbackResponse(
    Guid SubmissionId,
    int RevisionNumber,
    string Status,
    string? ReturnReason);

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
    DateTimeOffset? ActualEndAt,
    int? PassengersIn,
    int? PassengersOut,
    int? MtowKg);

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
