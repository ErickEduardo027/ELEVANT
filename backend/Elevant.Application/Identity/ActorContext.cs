using Elevant.Domain.Enumerations;

namespace Elevant.Application.Identity;

/// <summary>
/// Server-authoritative identity and scope used for authorization and exposed session context.
/// </summary>
public sealed record ActorContext(
    Guid AccountId,
    string Email,
    string DisplayName,
    IReadOnlyList<ActorRole> Roles,
    IReadOnlyList<ActorMembership> Memberships,
    IReadOnlyList<ActorStationScope> StationScopes,
    DepartmentAccess? Access = null)
{
    /// <summary>
    /// Effective department access. Actors resolved from the database always carry it;
    /// actors built without it (tests, legacy callers) derive it from their role codes.
    /// </summary>
    public DepartmentAccess? EffectiveAccess =>
        Access ?? DepartmentAccessResolver.FromRoles(Roles
            .Where(role => DepartmentAccessResolver.CountsForAccess(role.Code, role.Portal))
            .Select(role => role.Code));

    public bool HasPermission(string permissionCode) => EffectiveAccess?.Has(permissionCode) ?? false;
}

/// <summary>A currently assigned application role.</summary>
public sealed record ActorRole(
    Guid RoleId,
    string Code,
    string Name,
    PortalKind Portal,
    string UserType);

/// <summary>An active organization membership contributing to an actor's tenant scope.</summary>
public sealed record ActorMembership(
    Guid MembershipId,
    Guid OrganizationId,
    string OrganizationCode,
    string OrganizationName,
    OrganizationType OrganizationType,
    MembershipKind Kind);

/// <summary>An active station scope granted to an actor.</summary>
public sealed record ActorStationScope(Guid StationId, string StationCode);
