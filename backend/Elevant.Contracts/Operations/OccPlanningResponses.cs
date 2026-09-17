namespace Elevant.Contracts.Operations;

public sealed record OccPlanningSnapshotResponse(
    OccStationResponse Station,
    DateOnly Date,
    IReadOnlyList<OccTurnaroundResponse> Turnarounds);

public sealed record OccStationResponse(
    Guid Id,
    string Code,
    string Name,
    string IanaTimeZone);

public sealed record OccTerminalResponse(Guid Id, string Code, string Name);

public sealed record OccStandResponse(
    Guid Id,
    string Code,
    OccTerminalResponse? Terminal);

public sealed record OccAirlineResponse(
    Guid Id,
    string IataCode,
    string IcaoCode,
    string Name);

public sealed record OccAircraftResponse(
    Guid Id,
    string IcaoCode,
    string? IataCode,
    string Manufacturer,
    string Model,
    string? Registration);

public sealed record OccAirportResponse(
    Guid Id,
    string IataCode,
    string IcaoCode,
    string Name);

public sealed record OccFlightLegResponse(
    Guid Id,
    string FlightNumber,
    OccAirportResponse Origin,
    OccAirportResponse Destination,
    DateTimeOffset ScheduledAt,
    DateTimeOffset? EstimatedAt,
    DateTimeOffset? ActualAt);

public sealed record OccGroundOperationResponse(
    Guid Id,
    string Status,
    DateTimeOffset? PlannedStartAt,
    DateTimeOffset? PlannedEndAt,
    DateTimeOffset? ActualStartAt,
    DateTimeOffset? ActualEndAt);

public sealed record OccAssignedAgentResponse(
    Guid AssignmentId,
    Guid AgentId,
    string DisplayName,
    string EmployeeNumber,
    Guid? PositionId,
    string? PositionCode,
    string? PositionName,
    string AssignmentRole,
    DateTimeOffset AssignedAt);

public sealed record OccAssignedEquipmentResponse(
    Guid AssignmentId,
    Guid EquipmentId,
    string AssetCode,
    Guid EquipmentTypeId,
    string EquipmentTypeCode,
    string EquipmentTypeName,
    string Status,
    DateTimeOffset AssignedAt);

public sealed record OccOperationServiceResponse(
    Guid Id,
    int LineNumber,
    Guid ServiceDefinitionId,
    string Code,
    string Name,
    decimal ContractedQuantity,
    decimal ExecutedQuantity,
    string BillingUnit,
    string Status);

public sealed record OccTurnaroundResponse(
    Guid Id,
    string OperationCode,
    DateOnly OperationDate,
    string Status,
    OccAirlineResponse Airline,
    OccAircraftResponse? Aircraft,
    OccStandResponse? Stand,
    OccFlightLegResponse? Arrival,
    OccFlightLegResponse? Departure,
    OccGroundOperationResponse? Operation,
    IReadOnlyList<OccAssignedAgentResponse> Agents,
    IReadOnlyList<OccAssignedEquipmentResponse> Equipment,
    IReadOnlyList<OccOperationServiceResponse> Services);

public sealed record OccPlanningOptionsResponse(
    OccPlanningTurnaroundContextResponse Turnaround,
    OccContractOptionResponse? Contract,
    IReadOnlyList<OccServiceOptionResponse> Services,
    IReadOnlyList<OccAgentOptionResponse> Agents);

public sealed record OccPlanningTurnaroundContextResponse(
    Guid Id,
    string OperationCode,
    DateOnly OperationDate,
    OccStationResponse Station,
    OccStandResponse? Stand,
    DateTimeOffset ReferenceTime);

public sealed record OccContractOptionResponse(
    Guid Id,
    string Code,
    int Version,
    DateOnly ValidFrom,
    DateOnly? ValidTo,
    string CurrencyCode);

public sealed record OccServiceOptionResponse(
    Guid Id,
    Guid ServiceDefinitionId,
    string Code,
    string Name,
    string BillingUnit,
    decimal MinimumQuantity,
    decimal UnitPrice,
    string CurrencyCode);

public sealed record OccAgentOptionResponse(
    Guid Id,
    string DisplayName,
    string EmployeeNumber,
    bool Eligible,
    IReadOnlyList<string> EligibilityReasons);
