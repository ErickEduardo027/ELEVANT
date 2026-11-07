namespace Elevant.Application.Abstractions.Identity;

public sealed record JobPositionRefData(Guid Id, string Name, bool IsRampPosition);

public sealed record EmployeeAccountRefData(Guid Id, string Status);

public sealed record EmployeeSummaryData(
    Guid Id,
    string EmployeeNumber,
    string FirstName,
    string LastName,
    string Department,
    JobPositionRefData Position,
    string Status,
    DateOnly HireDate,
    IReadOnlyList<GovernanceStationData> Stations,
    EmployeeAccountRefData? Account,
    string? CorporateEmail,
    Guid? RequisitionId,
    string Version);

public sealed record EmployeePageData(int Page, int Limit, int Total, bool HasMore, IReadOnlyList<EmployeeSummaryData> Employees);

public sealed record EmployeeAssignmentData(string Department, string Position, DateTimeOffset ValidFrom,
    DateTimeOffset? ValidTo, string ChangedBy, string? Reason);

/// <summary>Full HR record; identification is visible only to Human Resources.</summary>
public sealed record EmployeeDetailData(
    EmployeeSummaryData Summary,
    string IdentificationType,
    string IdentificationNumber,
    bool IdentificationIsPlaceholder,
    string? PhoneNumber,
    DateOnly? TerminatedOn,
    string? TerminationReason,
    int FutureShifts,
    int PendingAccessRequests,
    IReadOnlyList<EmployeeAssignmentData> Assignments);

public sealed record JobPositionData(
    Guid Id,
    string Department,
    string Name,
    string? Description,
    bool IsRampPosition,
    bool IsActive,
    Guid? SuggestedAccessProfileId,
    string? SuggestedAccessProfileName,
    int Employees,
    string Version);

public sealed record RequisitionEmployeeData(Guid Id, string Name, string EmployeeNumber);

public sealed record RequisitionData(
    Guid Id,
    string Department,
    JobPositionRefData Position,
    int Quantity,
    int Filled,
    string Reason,
    GovernanceStationData? Station,
    DateOnly? DesiredStartOn,
    string Status,
    string RequestedBy,
    DateTimeOffset RequestedAt,
    string? AttendedBy,
    string? ClosedBy,
    DateTimeOffset? ClosedAt,
    string? ClosureReason,
    IReadOnlyList<RequisitionEmployeeData> Employees,
    string Version);

public sealed record EmployeeOptionsData(
    IReadOnlyList<string> IdentificationTypes,
    IReadOnlyList<JobPositionData> Positions,
    IReadOnlyList<GovernanceStationData> Stations,
    IReadOnlyList<RequisitionData> OpenRequisitions);

/// <summary>Employee a department may request access for (no active account, no pending request).</summary>
public sealed record AccessCandidateData(
    Guid EmployeeId,
    string FirstName,
    string LastName,
    string EmployeeNumber,
    JobPositionRefData Position,
    Guid? SuggestedAccessProfileId,
    IReadOnlyList<GovernanceStationData> Stations,
    string? Email,
    string? AccountStatus);

/// <summary>An internal account or ramp agent created before employees existed and still without a record.</summary>
public sealed record UnregisteredPersonData(
    Guid? AccountId,
    Guid? RampAgentId,
    string FirstName,
    string LastName,
    string? Email,
    string? Department,
    string? EmployeeNumber,
    IReadOnlyList<GovernanceStationData> Stations);

public sealed record ActivityEntryData(
    Guid Id,
    DateTimeOffset OccurredAt,
    Guid? ActorId,
    string? ActorName,
    string? Department,
    string Action,
    string Category,
    string EntityType,
    Guid? EntityId,
    string? StationCode,
    string? Reason);

public sealed record ActivityPageData(IReadOnlyList<ActivityEntryData> Entries, string? NextCursor);

public sealed record SaveEmployeeInput(
    string FirstName,
    string LastName,
    string IdentificationType,
    string IdentificationNumber,
    string EmployeeNumber,
    string Department,
    Guid PositionId,
    IReadOnlyList<Guid> StationIds,
    DateOnly HireDate,
    string? PhoneNumber = null,
    string? CorporateEmail = null,
    Guid? RequisitionId = null,
    string? ExpectedVersion = null);

public sealed record TransferEmployeeInput(string Department, Guid PositionId, IReadOnlyList<Guid> StationIds,
    string Reason, string ExpectedVersion);

public sealed record TerminateEmployeeInput(DateOnly TerminatedOn, string Reason, string ExpectedVersion);

public sealed record RegisterEmployeeInput(
    string IdentificationType,
    string IdentificationNumber,
    string EmployeeNumber,
    Guid PositionId,
    DateOnly HireDate,
    IReadOnlyList<Guid> StationIds,
    Guid? AccountId = null,
    Guid? RampAgentId = null,
    string? PhoneNumber = null);

public sealed record SaveJobPositionInput(string Department, string Name, string? Description, bool IsRampPosition,
    bool IsActive = true, string? ExpectedVersion = null);

public sealed record SetSuggestedProfileInput(Guid? AccessProfileId, string ExpectedVersion);

public sealed record CreateRequisitionInput(Guid RequestId, Guid PositionId, int Quantity, string Reason,
    Guid? StationId = null, DateOnly? DesiredStartOn = null);

public sealed record ChangeRequisitionStatusInput(string Status, string ExpectedVersion, string? Reason = null);

/// <summary>
/// Human Resources owns employees and job positions (ADR-0017); department administrators
/// request personnel and access for employees of their department, choose the suggested
/// access profile of their positions and read their department's activity. Reads return
/// null when the actor may not see the data.
/// </summary>
public interface IEmployeeGovernanceStore
{
    Task<EmployeePageData?> ListEmployeesAsync(Guid actorId, string? department, string? status, Guid? positionId,
        bool? hasAccount, string? search, int page, int limit, CancellationToken cancellationToken = default);
    Task<EmployeeDetailData?> GetEmployeeAsync(Guid actorId, Guid employeeId, CancellationToken cancellationToken = default);
    Task<EmployeeOptionsData?> GetEmployeeOptionsAsync(Guid actorId, CancellationToken cancellationToken = default);
    Task<GovernanceResult> CreateEmployeeAsync(Guid actorId, SaveEmployeeInput input, CancellationToken cancellationToken = default);
    Task<GovernanceResult> UpdateEmployeeAsync(Guid actorId, Guid employeeId, SaveEmployeeInput input,
        CancellationToken cancellationToken = default);
    /// <summary>
    /// Moves the employee to another department. Leaving the ramp ends their ramp duty through the release path
    /// (2-N06): coverages, unstarted operations and shifts are released, or <c>agent_has_operation_in_progress</c>.
    /// The Idempotency-Key is optional while older clients exist (expand).
    /// </summary>
    Task<GovernanceResult> TransferEmployeeAsync(Guid actorId, Guid employeeId, TransferEmployeeInput input,
        Guid? idempotencyKey, CancellationToken cancellationToken = default);
    /// <summary>
    /// Terminates the employee on a date up to today in AVIAM's calendar (2-N31), ending their ramp duty through
    /// the release path (2-N06). The Idempotency-Key is optional while older clients exist (expand).
    /// </summary>
    Task<GovernanceResult> TerminateEmployeeAsync(Guid actorId, Guid employeeId, TerminateEmployeeInput input,
        Guid? idempotencyKey, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<UnregisteredPersonData>?> ListUnregisteredAsync(Guid actorId, CancellationToken cancellationToken = default);
    Task<GovernanceResult> RegisterEmployeeAsync(Guid actorId, RegisterEmployeeInput input,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<JobPositionData>?> ListPositionsAsync(Guid actorId, string? department,
        CancellationToken cancellationToken = default);
    Task<GovernanceResult> SavePositionAsync(Guid actorId, Guid? positionId, SaveJobPositionInput input,
        CancellationToken cancellationToken = default);
    Task<GovernanceResult> SetSuggestedProfileAsync(Guid actorId, string department, Guid positionId,
        SetSuggestedProfileInput input, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<RequisitionData>?> ListRequisitionsAsync(Guid actorId, string? department, string? status,
        CancellationToken cancellationToken = default);
    Task<GovernanceResult> CreateRequisitionAsync(Guid actorId, string department, CreateRequisitionInput input,
        CancellationToken cancellationToken = default);
    Task<GovernanceResult> ChangeRequisitionStatusAsync(Guid actorId, Guid requisitionId,
        ChangeRequisitionStatusInput input, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<AccessCandidateData>?> ListAccessCandidatesAsync(Guid actorId, string department, string? search,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Audit trail. A department administrator reads its department; Human Resources with
    /// <c>human_resources.audit.read</c> and the super administrator read any department.
    /// </summary>
    Task<ActivityPageData?> ListActivityAsync(Guid actorId, string? department, DateTimeOffset from, DateTimeOffset to,
        string? category, Guid? accountId, string? cursor, int limit, CancellationToken cancellationToken = default);
}
