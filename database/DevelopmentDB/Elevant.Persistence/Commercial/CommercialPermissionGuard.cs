using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Enumerations;

namespace Elevant.Persistence.Commercial;

/// <summary>
/// Department-permission checks for the commercial (Contracts) surface. The effective
/// access comes from the actor resolver: super administrator, department administrator,
/// or the member's template/explicit grants.
/// </summary>
internal sealed class CommercialPermissionGuard(IActorContextResolver actors)
{
    public async Task<bool> IsSuperAdministratorAsync(Guid accountId,
        CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        return actor?.EffectiveAccess?.IsSuperAdministrator == true;
    }

    public async Task<bool> HasAsync(Guid accountId, string permissionCode,
        CancellationToken cancellationToken = default) =>
        await HasAnyAsync(accountId, [permissionCode], cancellationToken);

    public async Task<bool> HasAnyAsync(Guid accountId, IReadOnlyList<string> permissionCodes,
        CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        if (actor is null || !actor.Memberships.Any(membership =>
                membership.Kind == MembershipKind.InternalStaff &&
                membership.OrganizationType == OrganizationType.AviamOperator))
            return false;
        return permissionCodes.Any(actor.HasPermission);
    }
}
