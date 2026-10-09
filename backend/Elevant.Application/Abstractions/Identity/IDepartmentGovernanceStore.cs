namespace Elevant.Application.Abstractions.Identity;

public sealed record PermissionActionData(string Code, string Action, string Label);
public sealed record PermissionModuleData(string Key, string Label, IReadOnlyList<PermissionActionData> Actions);
public sealed record DepartmentCatalogData(string Department, string Label, IReadOnlyList<PermissionModuleData> Modules);

public sealed record GovernanceStationData(Guid Id, string Code);
public sealed record GovernanceTerminalData(Guid Id, string Code, Guid StationId);
public sealed record GovernanceSupervisorData(Guid Id, string Name, string EmployeeNumber);

/// <summary>What an actor may grant when creating or editing users of a department.</summary>
public sealed record DepartmentOptionsData(
    IReadOnlyList<GovernanceStationData> Stations,
    IReadOnlyList<GovernanceTerminalData> Terminals,
    IReadOnlyList<GovernanceSupervisorData> Supervisors);

/// <summary>Effective governance of the signed-in account.</summary>
public sealed record MyDepartmentAccessData(
    string Kind,
    string? Department,
    IReadOnlyList<string> Permissions,
    IReadOnlyList<GovernanceStationData> Stations,
    bool CanManageDepartmentUsers,
    bool CanValidateAccessRequests);

public sealed record DepartmentSummaryData(
    string Department,
    string Label,
    int Administrators,
    int Members,
    int RampAgents,
    int Inactive,
    int PendingRequests,
    int PendingFirstLogin,
    int ActiveProfiles);

public sealed record DepartmentsOverviewData(
    int TotalInternalUsers,
    int Administrators,
    int Members,
    int PendingRequests,
    IReadOnlyList<DepartmentSummaryData> Departments);

public sealed record DepartmentUserData(
    Guid Id,
    string FirstName,
    string LastName,
    string Email,
    string Kind,
    string Status,
    Guid? AccessProfileId,
    string? AccessProfileName,
    IReadOnlyList<string> Permissions,
    IReadOnlyList<GovernanceStationData> Stations,
    bool MustChangePassword,
    DateTimeOffset? LastLoginAt,
    string? AvatarMediaUrl,
    string Version);

public sealed record DepartmentUserPage(int Page, int Limit, int Total, bool HasMore,
    IReadOnlyList<DepartmentUserData> Users);

public sealed record AccessProfileData(
    Guid Id,
    string Department,
    string Name,
    string? Description,
    bool IsActive,
    IReadOnlyList<string> Permissions,
    int Members,
    string Version);

public sealed record AccessRequestData(
    Guid Id,
    string Department,
    string Kind,
    string Status,
    string RequestedBy,
    DateTimeOffset RequestedAt,
    string FirstName,
    string LastName,
    string Email,
    string? AvatarMediaUrl,
    Guid? AccessProfileId,
    string? AccessProfileName,
    IReadOnlyList<string> Permissions,
    IReadOnlyList<GovernanceStationData> Stations,
    IReadOnlyList<GovernanceTerminalData> Terminals,
    string? EmployeeNumber,
    string? Category,
    DateOnly? HireDate,
    Guid? SupervisorRampAgentId,
    string? SupervisorName,
    string? DecisionReason,
    DateTimeOffset? DecidedAt,
    string? DecidedBy,
    Guid? CreatedAccountId,
    string Version,
    Guid? EmployeeId = null);

public sealed record AccessRequestPage(int Page, int Limit, bool HasMore, IReadOnlyList<AccessRequestData> Requests);

public sealed record ClientAirlineData(Guid OrganizationId, string Name, string IataCode, int Users, int ActiveUsers);
public sealed record ClientUserData(Guid Id, string FirstName, string LastName, string Email, string Status,
    bool MustChangePassword, DateTimeOffset? LastLoginAt, string Version);

public sealed record LegacyRoleData(Guid Id, string Code, string Name, IReadOnlyList<string> Permissions, int ActiveUsers);

public sealed record SaveAccessProfileInput(string Name, string? Description,
    IReadOnlyList<string> PermissionCodes, string? ExpectedVersion = null);

/// <summary>
/// Direct account creation by the super administrator. New clients send <paramref name="EmployeeId"/>;
/// the typed person fields remain only for clients released before employees (ADR-0017, expand phase).
/// </summary>
public sealed record CreateDepartmentAccountInput(
    string? FirstName,
    string? LastName,
    string? Email,
    string TemporaryPassword,
    IReadOnlyList<Guid> StationIds,
    string? AvatarMediaUrl = null,
    Guid? AccessProfileId = null,
    IReadOnlyList<string>? PermissionCodes = null,
    Guid? EmployeeId = null);

public sealed record UpdateDepartmentUserInput(
    string FirstName,
    string LastName,
    string Email,
    IReadOnlyList<Guid> StationIds,
    string ExpectedVersion,
    string? AvatarMediaUrl = null,
    Guid? AccessProfileId = null,
    IReadOnlyList<string>? PermissionCodes = null);

public sealed record SetDepartmentUserStatusInput(bool IsActive, string ExpectedVersion);

/// <summary>
/// Access request of a department administrator. New clients send <paramref name="EmployeeId"/> and the
/// kind follows the employee position; the typed person and ramp fields are the pre-employee shape.
/// </summary>
public sealed record RequestUserAccessInput(
    Guid RequestId,
    string? Kind,
    string? FirstName,
    string? LastName,
    string? Email,
    IReadOnlyList<Guid> StationIds,
    string? AvatarMediaUrl = null,
    Guid? AccessProfileId = null,
    IReadOnlyList<string>? PermissionCodes = null,
    IReadOnlyList<Guid>? TerminalIds = null,
    string? EmployeeNumber = null,
    string? Category = null,
    DateOnly? HireDate = null,
    Guid? SupervisorRampAgentId = null,
    Guid? EmployeeId = null);

public sealed record DecideUserAccessInput(string ExpectedVersion, string? TemporaryPassword = null, string? Reason = null);

public sealed record CreateClientUserInput(string FirstName, string LastName, string Email, string TemporaryPassword);

/// <summary>
/// Department governance: two-level administration where the single super
/// administrator governs every department, department administrators manage their
/// own members and templates, and Human Resources validates new internal accounts.
/// Read methods return null when the actor may not see the requested data.
/// </summary>
public interface IDepartmentGovernanceStore
{
    Task<MyDepartmentAccessData?> GetMyAccessAsync(Guid actorId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<DepartmentCatalogData>?> GetCatalogAsync(Guid actorId, CancellationToken cancellationToken = default);
    Task<DepartmentsOverviewData?> GetOverviewAsync(Guid actorId, CancellationToken cancellationToken = default);
    Task<DepartmentSummaryData?> GetDepartmentSummaryAsync(Guid actorId, string department,
        CancellationToken cancellationToken = default);
    Task<DepartmentOptionsData?> GetOptionsAsync(Guid actorId, string department,
        CancellationToken cancellationToken = default);
    Task<DepartmentUserPage?> ListUsersAsync(Guid actorId, string department, int page, int limit,
        string? kind, string? status, Guid? accessProfileId, Guid? stationId, string? search,
        CancellationToken cancellationToken = default);
    Task<GovernanceResult> CreateAdministratorAsync(Guid actorId, string department,
        CreateDepartmentAccountInput input, CancellationToken cancellationToken = default);
    Task<GovernanceResult> CreateMemberAsync(Guid actorId, string department,
        CreateDepartmentAccountInput input, CancellationToken cancellationToken = default);
    Task<GovernanceResult> UpdateUserAsync(Guid actorId, string department, Guid userId,
        UpdateDepartmentUserInput input, CancellationToken cancellationToken = default);
    Task<GovernanceResult> SetUserStatusAsync(Guid actorId, string department, Guid userId,
        SetDepartmentUserStatusInput input, CancellationToken cancellationToken = default);
    Task<GovernanceResult> ResetUserPasswordAsync(Guid actorId, string department, Guid userId,
        string temporaryPassword, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<AccessProfileData>?> ListProfilesAsync(Guid actorId, string department,
        CancellationToken cancellationToken = default);
    Task<GovernanceResult> SaveProfileAsync(Guid actorId, string department, Guid? profileId,
        SaveAccessProfileInput input, CancellationToken cancellationToken = default);
    Task<GovernanceResult> DeactivateProfileAsync(Guid actorId, string department, Guid profileId,
        string expectedVersion, CancellationToken cancellationToken = default);
    Task<GovernanceResult> RequestAccessAsync(Guid actorId, string department, RequestUserAccessInput input,
        CancellationToken cancellationToken = default);
    Task<AccessRequestPage?> ListRequestsAsync(Guid actorId, string? department, string? status, int page, int limit,
        CancellationToken cancellationToken = default);
    Task<GovernanceResult> CancelRequestAsync(Guid actorId, Guid requestId, string expectedVersion,
        CancellationToken cancellationToken = default);
    Task<GovernanceResult> ValidateRequestAsync(Guid actorId, Guid requestId, DecideUserAccessInput input,
        CancellationToken cancellationToken = default);
    Task<GovernanceResult> RejectRequestAsync(Guid actorId, Guid requestId, DecideUserAccessInput input,
        CancellationToken cancellationToken = default);
    Task<IReadOnlyList<ClientAirlineData>?> ListClientsAsync(Guid actorId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<ClientUserData>?> ListClientUsersAsync(Guid actorId, Guid organizationId,
        CancellationToken cancellationToken = default);
    Task<GovernanceResult> CreateClientUserAsync(Guid actorId, Guid organizationId, CreateClientUserInput input,
        CancellationToken cancellationToken = default);
    Task<GovernanceResult> SetClientUserStatusAsync(Guid actorId, Guid organizationId, Guid userId,
        SetDepartmentUserStatusInput input, CancellationToken cancellationToken = default);
    Task<GovernanceResult> ResetClientUserPasswordAsync(Guid actorId, Guid organizationId, Guid userId,
        string temporaryPassword, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<LegacyRoleData>?> ListLegacyRolesAsync(Guid actorId, CancellationToken cancellationToken = default);
    Task<GovernanceResult> ConvertLegacyRoleAsync(Guid actorId, Guid roleId, CancellationToken cancellationToken = default);
}
