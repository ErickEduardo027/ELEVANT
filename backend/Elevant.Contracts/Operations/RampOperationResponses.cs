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

/// <param name="PassengersIn">Passengers who arrive.</param>
/// <param name="PassengersOut">Passengers who leave.</param>
/// <param name="MtowKg">Maximum take-off weight in kilograms.</param>
/// <param name="AircraftRegistration">Correction typed once on the ramp; null keeps the current one.</param>
/// <param name="AircraftTypeId">
/// The aircraft type the agent sees on the ramp (3-B); null keeps the current one, so an older tablet's command keeps
/// its meaning. Locked from the first submission.
/// </param>
public sealed record UpdateRampFlightDataRequest(int? PassengersIn, int? PassengersOut, int? MtowKg,
    string? AircraftRegistration, Guid? AircraftTypeId = null);

/// <summary>An active aircraft type of the shared catalog, as the tablet offers it (3-B).</summary>
public sealed record RampAircraftTypeResponse(Guid Id, string IcaoCode, string? IataCode, string Manufacturer, string Model);

/// <summary>The active aircraft types the agent can choose on the ramp, by manufacturer and model.</summary>
public sealed record RampAircraftTypesResponse(IReadOnlyList<RampAircraftTypeResponse> AircraftTypes);

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
