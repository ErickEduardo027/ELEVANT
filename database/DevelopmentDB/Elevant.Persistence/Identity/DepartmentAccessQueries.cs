using Elevant.Application.Identity;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

/// <summary>
/// Reads the effective department access of internal accounts from assignments,
/// active roles, template grants, explicit grants and legacy custom-role permissions.
/// </summary>
internal static class DepartmentAccessQueries
{
    public static async Task<DepartmentAccess?> ReadAsync(ElevantDbContext context, long accountId,
        CancellationToken cancellationToken)
    {
        var accesses = await ReadManyAsync(context, [accountId], cancellationToken);
        return accesses.GetValueOrDefault(accountId);
    }

    /// <summary>Active AVIAM staff accounts whose effective access includes <paramref name="permissionCode"/>.</summary>
    public static async Task<long[]> AccountsWithPermissionAsync(ElevantDbContext context, string permissionCode,
        CancellationToken cancellationToken)
    {
        var accounts = await ActiveInternalAccounts(context).ToArrayAsync(cancellationToken);
        var accesses = await ReadManyAsync(context, accounts, cancellationToken);
        return accesses.Where(pair => pair.Value.Has(permissionCode)).Select(pair => pair.Key).Order().ToArray();
    }

    public static IQueryable<long> ActiveInternalAccounts(ElevantDbContext context) =>
        (from user in context.Users.AsNoTracking()
         join membership in context.OrganizationMemberships.AsNoTracking() on user.Id equals membership.AccountId
         join organization in context.Organizations.AsNoTracking() on membership.OrganizationId equals organization.Id
         where user.Status == AccountLifecycleStatus.Active &&
             membership.Status == MembershipStatus.Active &&
             membership.Kind == MembershipKind.InternalStaff &&
             organization.Type == OrganizationType.AviamOperator &&
             organization.Status == OrganizationStatus.Active
         select user.Id).Distinct();

    public static async Task<IReadOnlyDictionary<long, DepartmentAccess>> ReadManyAsync(ElevantDbContext context,
        IReadOnlyCollection<long> accountIds, CancellationToken cancellationToken)
    {
        if (accountIds.Count == 0) return new Dictionary<long, DepartmentAccess>();
        var ids = accountIds.Distinct().ToArray();

        var assignments = await context.DepartmentAssignments.AsNoTracking()
            .Where(item => ids.Contains(item.AccountId))
            .Select(item => new { item.AccountId, item.Kind, item.Department, item.AccessProfileId })
            .ToDictionaryAsync(item => item.AccountId, cancellationToken);

        var roles = await (
            from assignment in context.Set<IdentityUserRole<long>>().AsNoTracking()
            join role in context.Roles.AsNoTracking() on assignment.RoleId equals role.Id
            where ids.Contains(assignment.UserId) && role.IsActive && role.NormalizedName != null
            select new { assignment.UserId, role.Id, Code = role.NormalizedName!, role.Portal })
            .ToArrayAsync(cancellationToken);
        roles = roles.Where(role => DepartmentAccessResolver.CountsForAccess(role.Code, role.Portal)).ToArray();

        var profileIds = assignments.Values.Where(item => item.AccessProfileId != null)
            .Select(item => item.AccessProfileId!.Value).Distinct().ToArray();
        var profiles = await context.AccessProfiles.AsNoTracking()
            .Where(profile => profileIds.Contains(profile.Id))
            .Select(profile => new { profile.Id, profile.IsActive })
            .ToDictionaryAsync(profile => profile.Id, profile => profile.IsActive, cancellationToken);
        var profileGrants = (await context.AccessProfileGrants.AsNoTracking()
                .Where(grant => profileIds.Contains(grant.AccessProfileId))
                .ToArrayAsync(cancellationToken))
            .ToLookup(grant => grant.AccessProfileId, grant => grant.PermissionCode);
        var accountGrants = (await context.AccountPermissionGrants.AsNoTracking()
                .Where(grant => ids.Contains(grant.AccountId))
                .ToArrayAsync(cancellationToken))
            .ToLookup(grant => grant.AccountId, grant => grant.PermissionCode);

        var customRoleIds = roles.Where(role => role.Code.StartsWith("CUSTOM_", StringComparison.Ordinal))
            .Select(role => role.Id).Distinct().ToArray();
        var legacyGrants = customRoleIds.Length == 0
            ? Array.Empty<(long RoleId, string Code)>().ToLookup(item => item.RoleId, item => item.Code)
            : (await (from grant in context.Set<RolePermissionGrant>().AsNoTracking()
                      join permission in context.Permissions.AsNoTracking() on grant.PermissionId equals permission.Id
                      where customRoleIds.Contains(grant.RoleId)
                      select new { grant.RoleId, permission.Code })
                    .ToArrayAsync(cancellationToken))
                .ToLookup(item => item.RoleId, item => item.Code);
        var rolesByAccount = roles.ToLookup(role => role.UserId);

        var result = new Dictionary<long, DepartmentAccess>();
        foreach (var id in ids)
        {
            DepartmentAssignmentFacts? facts = null;
            IEnumerable<string> fromProfile = [];
            if (assignments.TryGetValue(id, out var assignment))
            {
                var profileActive = assignment.AccessProfileId is { } profileId &&
                    profiles.GetValueOrDefault(profileId);
                facts = new DepartmentAssignmentFacts(assignment.Kind, assignment.Department,
                    assignment.AccessProfileId != null, profileActive);
                if (assignment.AccessProfileId is { } usedProfile) fromProfile = profileGrants[usedProfile];
            }

            var accountRoles = rolesByAccount[id].ToArray();
            var access = DepartmentAccessResolver.Resolve(
                facts,
                accountRoles.Select(role => role.Code).ToArray(),
                fromProfile,
                accountGrants[id],
                accountRoles.SelectMany(role => legacyGrants[role.Id]));
            if (access is not null) result[id] = access;
        }
        return result;
    }
}
