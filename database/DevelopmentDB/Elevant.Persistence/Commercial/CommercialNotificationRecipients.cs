using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

internal static class CommercialNotificationRecipients
{
    public static Task<long[]> WithPermissionAsync(ElevantDbContext context,
        string permissionCode, CancellationToken cancellationToken) =>
        (from assignment in context.Set<IdentityUserRole<long>>().AsNoTracking()
         join role in context.Roles.AsNoTracking() on assignment.RoleId equals role.Id
         join grant in context.Set<RolePermissionGrant>().AsNoTracking() on role.Id equals grant.RoleId
         join permission in context.Permissions.AsNoTracking() on grant.PermissionId equals permission.Id
         join user in context.Users.AsNoTracking() on assignment.UserId equals user.Id
         join membership in context.OrganizationMemberships.AsNoTracking() on user.Id equals membership.AccountId
         join organization in context.Organizations.AsNoTracking() on membership.OrganizationId equals organization.Id
         where role.IsActive && role.Portal == PortalKind.BackOffice &&
             permission.Code == permissionCode &&
             user.Status == AccountLifecycleStatus.Active &&
             membership.Status == MembershipStatus.Active &&
             membership.Kind == MembershipKind.InternalStaff &&
             organization.Code == "AVIAM" && organization.Status == OrganizationStatus.Active
         select user.Id).Distinct().ToArrayAsync(cancellationToken);
}
