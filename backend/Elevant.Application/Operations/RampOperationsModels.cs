namespace Elevant.Application.Operations;

public sealed record RampStationData(
    Guid Id,
    string Code,
    string Name,
    string IanaTimeZone);

public sealed record RampTerminalData(Guid Id, string Code, string Name);

public sealed record RampStandData(Guid Id, string Code, RampTerminalData? Terminal);

public sealed record RampAirlineData(
    Guid Id,
    string IataCode,
    string IcaoCode,
    string Name);

public sealed record RampAircraftData(
    Guid Id,
    string IcaoCode,
    string? IataCode,
    string Manufacturer,
    string Model,
    string? Registration);

public sealed record RampAirportData(
    Guid Id,
    string IataCode,
    string IcaoCode,
    string Name);

public sealed record RampFlightLegData(
    Guid Id,
    string FlightNumber,
    RampAirportData Origin,
    RampAirportData Destination,
    DateTimeOffset ScheduledAt,
    DateTimeOffset? EstimatedAt,
    DateTimeOffset? ActualAt);

public sealed record RampTurnaroundData(
    Guid Id,
    string OperationCode,
    DateOnly OperationDate,
    string Status,
    RampStationData Station,
    RampAirlineData Airline,
    RampAircraftData? Aircraft,
    RampStandData? Stand,
    RampFlightLegData? Arrival,
    RampFlightLegData? Departure);

public sealed record RampGroundOperationData(
    Guid Id,
    string Status,
    DateTimeOffset? PlannedStartAt,
    DateTimeOffset? PlannedEndAt,
    DateTimeOffset? ActualStartAt,
    DateTimeOffset? ActualEndAt,
    int? PassengersIn = null,
    int? PassengersOut = null,
    int? MtowKg = null);

public sealed record RampOperationalPositionData(Guid Id, string Code, string Name);

public sealed record RampAgentAssignmentData(
    Guid Id,
    Guid AgentId,
    RampOperationalPositionData? Position,
    string AssignmentRole,
    DateTimeOffset AssignedAt);

public sealed record RampOperationServiceData(
    Guid Id,
    int LineNumber,
    Guid ServiceDefinitionId,
    string Code,
    string Name,
    decimal ContractedQuantity,
    decimal ExecutedQuantity,
    string BillingUnit,
    string Status);

public sealed record RampAssignedOperationData(
    RampAgentAssignmentData Assignment,
    RampGroundOperationData Operation,
    RampTurnaroundData Turnaround,
    IReadOnlyList<RampOperationServiceData> Services,
    RampReviewFeedbackData? Review = null,
    IReadOnlyList<RampMilestoneData>? Milestones = null);

public sealed record RampReviewFeedbackData(
    Guid SubmissionId,
    int RevisionNumber,
    string Status,
    string? ReturnReason);

public enum RampOperationsReadFailure
{
    AgentProfileUnavailable,
}

public sealed record RampOperationsReadResult(
    IReadOnlyList<RampAssignedOperationData>? Operations,
    RampOperationsReadFailure? Failure)
{
    public bool IsSuccess => Operations is not null && Failure is null;

    public static RampOperationsReadResult Success(
        IReadOnlyList<RampAssignedOperationData> operations)
    {
        ArgumentNullException.ThrowIfNull(operations);
        return new(operations, null);
    }

    public static RampOperationsReadResult Failed(RampOperationsReadFailure failure) =>
        new(null, failure);
}
