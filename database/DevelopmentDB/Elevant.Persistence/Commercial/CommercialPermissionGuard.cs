using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

internal sealed class CommercialPermissionGuard(
    ElevantDbContext context, IActorContextResolver actors)
{
    public async Task<bool> IsSuperAdministratorAsync(Guid accountId,
        CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        return actor?.Roles.Any(role => role.Portal == PortalKind.BackOffice &&
            role.Code == "SUPERADMIN") == true;
    }

    public async Task<bool> HasAsync(Guid accountId, string permissionCode,
        CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        if (actor is null) return false;
        if (actor.Roles.Any(role => role.Portal == PortalKind.BackOffice &&
            role.Code == "SUPERADMIN")) return true;
        var roleIds = actor.Roles.Where(role => role.Portal == PortalKind.BackOffice)
            .Select(role => role.RoleId).ToArray();
        if (roleIds.Length == 0) return false;
        return await (from role in context.Roles.AsNoTracking()
            join grant in context.Set<RolePermissionGrant>().AsNoTracking()
                on role.Id equals grant.RoleId
            join permission in context.Permissions.AsNoTracking()
                on grant.PermissionId equals permission.Id
            where roleIds.Contains(role.PublicId) && role.IsActive &&
                permission.Code == permissionCode
            select grant.RoleId).AnyAsync(cancellationToken);
    }
}
