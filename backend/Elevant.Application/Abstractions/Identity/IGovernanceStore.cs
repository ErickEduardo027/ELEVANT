namespace Elevant.Application.Abstractions.Identity;

public sealed record GovernanceRoleData(Guid Id, string Code, string Name,
    string? Description, string Portal, bool IsCustom, bool IsActive,
    IReadOnlyList<string> Permissions, int ActiveUsers);
public sealed record GovernanceUserData(Guid Id, string Name, string Email,
    string Status, Guid RoleId, string RoleName, string Portal,
    string Organization, bool MustChangePassword);
public sealed record GovernanceAuditData(DateTimeOffset At, string Action,
    string EntityType, Guid? EntityId, string? Reason);
public sealed record GovernanceSnapshot(
    IReadOnlyList<GovernanceRoleData> Roles,
    IReadOnlyList<GovernanceUserData> Users,
    IReadOnlyList<string> PermissionCodes,
    IReadOnlyList<GovernanceAuditData> RecentAudit);
public sealed record SaveGovernanceRoleInput(string Name, string? Description,
    IReadOnlyList<string> PermissionCodes, bool IsActive);
public sealed record CreateGovernanceUserInput(string FirstName, string LastName,
    string Email, Guid RoleId, string TemporaryPassword);
public sealed record UpdateGovernanceUserInput(string FirstName, string LastName,
    string Email, Guid RoleId, bool IsActive);
public enum GovernanceFailure { Forbidden, NotFound, Invalid, Conflict, Protected }
public sealed record GovernanceResult(Guid? Id, GovernanceFailure? Failure)
{
    public bool IsSuccess => Id is not null;
    public static GovernanceResult Success(Guid id) => new(id, null);
    public static GovernanceResult Failed(GovernanceFailure failure) => new(null, failure);
}
public interface IGovernanceStore
{
    Task<IReadOnlyList<string>?> GetMyPermissionsAsync(Guid actorId,
        CancellationToken cancellationToken = default);
    Task<GovernanceSnapshot?> GetAsync(Guid actorId,
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
