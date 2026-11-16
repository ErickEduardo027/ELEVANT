namespace Elevant.Application.Abstractions.Identity;

public sealed record GovernanceRoleData(Guid Id, string Code, string Name,
    string? Description, string Portal, bool IsCustom, bool IsActive,
    IReadOnlyList<string> Permissions, int ActiveUsers);
public sealed record GovernanceUserData(Guid Id, string Name, string Email,
    string Status, Guid RoleId, string RoleName, string Portal,
    string Organization, bool MustChangePassword, Guid? RampAgentId = null,
    string? AvatarMediaUrl = null);
public sealed record GovernanceRampProfileData(Guid Id, string Name,
    string EmployeeNumber, IReadOnlyList<string> Stations, Guid? AccountId,
    string? AvatarMediaUrl = null, string? FirstName = null, string? LastName = null,
    string? Version = null);
public sealed record AuditFieldChangeData(string Field, string? Before, string? After);
public sealed record GovernanceAuditData(DateTimeOffset At, string Action,
    string EntityType, Guid? EntityId, string? Reason,
    string Actor, IReadOnlyList<AuditFieldChangeData> Changes);
public sealed record GovernanceAuditPage(int Page, int Limit, bool HasMore,
    IReadOnlyList<GovernanceAuditData> Entries);
public sealed record GovernanceSnapshot(
    IReadOnlyList<GovernanceRoleData> Roles,
    IReadOnlyList<GovernanceUserData> Users,
    IReadOnlyList<string> PermissionCodes,
    IReadOnlyList<GovernanceAuditData> RecentAudit,
    IReadOnlyList<GovernanceRampProfileData> RampProfiles);
public sealed record SaveGovernanceRoleInput(string Name, string? Description,
    IReadOnlyList<string> PermissionCodes, bool IsActive);
public sealed record CreateGovernanceUserInput(string FirstName, string LastName,
    string Email, Guid RoleId, string TemporaryPassword, Guid? RampAgentId = null,
    string? AvatarMediaUrl = null, Guid? AccessRequestId = null,
    string? AccessRequestVersion = null, string? ExpectedRampProfileVersion = null,
    IReadOnlyList<string>? ExpectedStationCodes = null);
public sealed record UpdateGovernanceUserInput(string FirstName, string LastName,
    string Email, Guid RoleId, bool IsActive, Guid? RampAgentId = null,
    string? AvatarMediaUrl = null);
public enum GovernanceFailure { Forbidden, NotFound, Invalid, Conflict, Protected }
/// <summary>Outcome of a governance command; <paramref name="Code"/> names the rule a failure broke, for the client.</summary>
public sealed record GovernanceResult(Guid? Id, GovernanceFailure? Failure, string? Code = null)
{
    public bool IsSuccess => Id is not null;
    public static GovernanceResult Success(Guid id) => new(id, null);
    public static GovernanceResult Failed(GovernanceFailure failure, string? code = null) => new(null, failure, code);
}
public interface IGovernanceStore
{
    Task<IReadOnlyList<string>?> GetMyPermissionsAsync(Guid actorId,
        CancellationToken cancellationToken = default);
    Task<GovernanceSnapshot?> GetAsync(Guid actorId,
        CancellationToken cancellationToken = default);
    Task<GovernanceAuditPage?> GetAuditAsync(Guid actorId, int page, int limit,
        CancellationToken cancellationToken = default);
    Task<GovernanceResult> CreateRoleAsync(Guid actorId, SaveGovernanceRoleInput input,
        CancellationToken cancellationToken = default);
    Task<GovernanceResult> UpdateRoleAsync(Guid actorId, Guid roleId,
        SaveGovernanceRoleInput input, CancellationToken cancellationToken = default);
    Task<GovernanceResult> DeleteRoleAsync(Guid actorId, Guid roleId,
        CancellationToken cancellationToken = default);
    Task<GovernanceResult> CreateUserAsync(Guid actorId, CreateGovernanceUserInput input,
        CancellationToken cancellationToken = default);
    Task<GovernanceResult> UpdateUserAsync(Guid actorId, Guid userId,
        UpdateGovernanceUserInput input, CancellationToken cancellationToken = default);
    Task<GovernanceResult> DeleteUserAsync(Guid actorId, Guid userId,
        CancellationToken cancellationToken = default);
    Task<GovernanceResult> ResetPasswordAsync(Guid actorId, Guid userId,
        string temporaryPassword, CancellationToken cancellationToken = default);
}
