namespace Elevant.Application.Operations;

public sealed record OccStationData(Guid Id, string Code, string Name, string IanaTimeZone);

public sealed record OccTerminalData(Guid Id, string Code, string Name);

public sealed record OccStandData(Guid Id, string Code, OccTerminalData? Terminal);

public sealed record OccAirlineData(
    Guid Id,
    string IataCode,
    string IcaoCode,
    string Name);

public sealed record OccAircraftData(
    Guid Id,
    string IcaoCode,
    string? IataCode,
    string Manufacturer,
    string Model,
    string? Registration);

public sealed record OccAirportData(
    Guid Id,
    string IataCode,
    string IcaoCode,
    string Name);

public sealed record OccFlightLegData(
    Guid Id,
    string FlightNumber,
    OccAirportData Origin,
    OccAirportData Destination,
    DateTimeOffset ScheduledAt,
    DateTimeOffset? EstimatedAt,
    DateTimeOffset? ActualAt);

public sealed record OccGroundOperationData(
    Guid Id,
    string Status,
    DateTimeOffset? PlannedStartAt,
    DateTimeOffset? PlannedEndAt,
    DateTimeOffset? ActualStartAt,
    DateTimeOffset? ActualEndAt);

public sealed record OccAssignedAgentData(
    Guid AssignmentId,
    Guid AgentId,
    string DisplayName,
    string EmployeeNumber,
    Guid? PositionId,
    string? PositionCode,
    string? PositionName,
    string AssignmentRole,
    DateTimeOffset AssignedAt);

public sealed record OccAssignedEquipmentData(
    Guid AssignmentId,
    Guid EquipmentId,
    string AssetCode,
    Guid EquipmentTypeId,
    string EquipmentTypeCode,
    string EquipmentTypeName,
    string Status,
    DateTimeOffset AssignedAt);

public sealed record OccOperationServiceData(
    Guid Id,
    int LineNumber,
    Guid ServiceDefinitionId,
    string Code,
    string Name,
    decimal ContractedQuantity,
    decimal ExecutedQuantity,
    string BillingUnit,
    string Status);

public sealed record OccTurnaroundData(
    Guid Id,
    string OperationCode,
    DateOnly OperationDate,
    string Status,
    OccAirlineData Airline,
    OccAircraftData? Aircraft,
    OccStandData? Stand,
    OccFlightLegData? Arrival,
    OccFlightLegData? Departure,
    OccGroundOperationData? Operation,
    IReadOnlyList<OccAssignedAgentData> Agents,
    IReadOnlyList<OccAssignedEquipmentData> Equipment,
    IReadOnlyList<OccOperationServiceData> Services);

public sealed record OccPlanningSnapshotData(
    OccStationData Station,
    DateOnly Date,
    IReadOnlyList<OccTurnaroundData> Turnarounds);

public sealed record OccPlanningTurnaroundContextData(
    Guid Id,
    string OperationCode,
    DateOnly OperationDate,
    OccStationData Station,
    OccStandData? Stand,
    DateTimeOffset ReferenceTime,
    string ConcurrencyToken);

public sealed record OccContractOptionData(
    Guid Id,
    string Code,
    int Version,
    DateOnly ValidFrom,
    DateOnly? ValidTo,
    string CurrencyCode);

public sealed record OccServiceOptionData(
    Guid Id,
    Guid ServiceDefinitionId,
    string Code,
    string Name,
    string BillingUnit,
    decimal MinimumQuantity,
    decimal UnitPrice,
    string CurrencyCode);

public sealed record OccAgentCandidateData(
    Guid Id,
    string DisplayName,
    string EmployeeNumber,
    bool IsActive,
    bool HasMobileAccount,
    bool HasStationScope,
    bool HasTerminalScope,
    bool HasCurrentQualification,
    bool HasCurrentAirportId,
    bool HasCurrentRampDriverLicense,
    bool HasCompatibleShift,
    Guid? OperationalPositionId,
    bool HasAssignmentConflict,
    bool HasApprovedAbsence = false);

public sealed record OccPlanningOptionsSourceData(
    OccPlanningTurnaroundContextData Turnaround,
    OccContractOptionData? Contract,
    IReadOnlyList<OccServiceOptionData> Services,
    IReadOnlyList<OccAgentCandidateData> AgentCandidates,
    bool IsCharter = false);

public enum OccPlanningOptionsReadFailure
{
    NotFound,
    ContractConflict,
    OperationalConflict,
}

public sealed record OccPlanningOptionsReadResult(
    OccPlanningOptionsSourceData? Options,
    OccPlanningOptionsReadFailure? Failure)
{
    public bool IsSuccess => Options is not null && Failure is null;

    public static OccPlanningOptionsReadResult Success(OccPlanningOptionsSourceData options) =>
        new(options, null);

    public static OccPlanningOptionsReadResult Failed(OccPlanningOptionsReadFailure failure) =>
        new(null, failure);
}

public sealed record OccAgentOptionData(
    Guid Id,
    string DisplayName,
    string EmployeeNumber,
    bool Eligible,
    IReadOnlyList<string> EligibilityReasons);

public sealed record OccPlanningOptionsData(
    OccPlanningTurnaroundContextData Turnaround,
    OccContractOptionData? Contract,
    IReadOnlyList<OccServiceOptionData> Services,
    IReadOnlyList<OccAgentOptionData> Agents,
    bool IsCharter = false);
