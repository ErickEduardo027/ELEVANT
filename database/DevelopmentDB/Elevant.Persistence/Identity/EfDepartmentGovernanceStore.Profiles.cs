using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Governance;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

internal sealed partial class EfDepartmentGovernanceStore
{
    public async Task<IReadOnlyList<AccessProfileData>?> ListProfilesAsync(Guid actorId, string department,
        CancellationToken cancellationToken = default)
    {
        if (!TryParse(department, out var parsed)) return null;
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !actor.Administers(parsed)) return null;
        var profiles = await context.AccessProfiles.AsNoTracking().Where(profile => profile.Department == parsed)
            .OrderByDescending(profile => profile.IsActive).ThenBy(profile => profile.Name)
            .ToArrayAsync(cancellationToken);
        var ids = profiles.Select(profile => profile.Id).ToArray();
        var grants = (await context.AccessProfileGrants.AsNoTracking().Where(grant => ids.Contains(grant.AccessProfileId))
            .ToArrayAsync(cancellationToken)).ToLookup(grant => grant.AccessProfileId, grant => grant.PermissionCode);
        var members = await context.DepartmentAssignments.AsNoTracking()
            .Where(assignment => assignment.AccessProfileId != null && ids.Contains(assignment.AccessProfileId.Value))
            .GroupBy(assignment => assignment.AccessProfileId!.Value)
            .Select(group => new { group.Key, Count = group.Count() })
            .ToDictionaryAsync(item => item.Key, item => item.Count, cancellationToken);
        return profiles.Select(profile => new AccessProfileData(profile.PublicId, KeyOf(profile.Department), profile.Name,
            profile.Description, profile.IsActive, grants[profile.Id].Order(StringComparer.Ordinal).ToArray(),
            members.GetValueOrDefault(profile.Id), GovernanceSupport.Version(profile.RowVersion))).ToArray();
    }

    public async Task<GovernanceResult> SaveProfileAsync(Guid actorId, string department, Guid? profileId,
        SaveAccessProfileInput input, CancellationToken cancellationToken = default)
    {
        if (!TryParse(department, out var parsed)) return GovernanceResult.Failed(GovernanceFailure.NotFound);
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !actor.Administers(parsed)) return GovernanceResult.Failed(GovernanceFailure.Forbidden);
        if (input is null || string.IsNullOrWhiteSpace(input.Name) || input.Name.Trim().Length is < 3 or > 80 ||
            input.Description?.Length > 400 || input.PermissionCodes is not { Count: > 0 and <= 120 } ||
            input.PermissionCodes.Any(code => !DepartmentPermissionCatalog.Belongs(code, parsed)) ||
            profileId is not null && string.IsNullOrWhiteSpace(input.ExpectedVersion))
            return GovernanceResult.Failed(GovernanceFailure.Invalid);
        var codes = DepartmentPermissionCatalog.Normalize(input.PermissionCodes);
        var name = input.Name.Trim();

        return await InSerializableTransactionAsync(async () =>
        {
            var now = timeProvider.GetUtcNow();
            AccessProfile? profile = null;
            if (profileId is { } id)
            {
                profile = await context.AccessProfiles.SingleOrDefaultAsync(item =>
                    item.PublicId == id && item.Department == parsed, cancellationToken);
                if (profile is null) return GovernanceResult.Failed(GovernanceFailure.NotFound);
                if (GovernanceSupport.Version(profile.RowVersion) != input.ExpectedVersion)
                    return GovernanceResult.Failed(GovernanceFailure.Conflict);
            }
            if (await context.AccessProfiles.AnyAsync(item => item.Department == parsed && item.IsActive &&
                    item.Name == name && (profile == null || item.Id != profile.Id), cancellationToken))
                return GovernanceResult.Failed(GovernanceFailure.Conflict);
            var before = profile is null ? null : string.Join(',', await context.AccessProfileGrants
                .Where(grant => grant.AccessProfileId == profile.Id).Select(grant => grant.PermissionCode)
                .OrderBy(code => code).ToArrayAsync(cancellationToken));
            if (profile is null)
            {
                profile = new AccessProfile
                {
                    PublicId = Guid.CreateVersion7(), Department = parsed, CreatedByAccountId = actor.Id,
                    CreatedAt = now, IsActive = true,
                };
                context.AccessProfiles.Add(profile);
            }
            profile.Name = name;
            profile.Description = string.IsNullOrWhiteSpace(input.Description) ? null : input.Description.Trim();
            profile.UpdatedAt = now;
            await context.SaveChangesAsync(cancellationToken);
            var existing = await context.AccessProfileGrants.Where(grant => grant.AccessProfileId == profile.Id)
                .ToArrayAsync(cancellationToken);
            context.AccessProfileGrants.RemoveRange(existing);
            foreach (var code in codes)
                context.AccessProfileGrants.Add(new AccessProfileGrant { AccessProfileId = profile.Id, PermissionCode = code });
            if (before is not null) await RevokeProfileMembersAsync(profile.Id, cancellationToken);
            GovernanceSupport.AddAudit(context, actor.Id, before is null
                    ? "governance.access_profile.created" : "governance.access_profile.updated",
                "iam.access_profiles", profile.PublicId, null, [], now,
                new AuditFieldChangeData("profile.name", null, name), new AuditFieldChangeData("profile.permissions", before, string.Join(',', codes)));
            await NotifyDepartmentAsync(parsed, "department_users", profile.PublicId, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return GovernanceResult.Success(profile.PublicId);
        }, cancellationToken);
    }

    /// <summary>
    /// A retired template stops granting anything: its members keep their account but
    /// lose the template's permissions until an administrator assigns new ones.
    /// </summary>
    public async Task<GovernanceResult> DeactivateProfileAsync(Guid actorId, string department, Guid profileId,
        string expectedVersion, CancellationToken cancellationToken = default)
    {
        if (!TryParse(department, out var parsed)) return GovernanceResult.Failed(GovernanceFailure.NotFound);
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !actor.Administers(parsed)) return GovernanceResult.Failed(GovernanceFailure.Forbidden);
        if (string.IsNullOrWhiteSpace(expectedVersion)) return GovernanceResult.Failed(GovernanceFailure.Invalid);
        return await InSerializableTransactionAsync(async () =>
        {
            var now = timeProvider.GetUtcNow();
            var profile = await context.AccessProfiles.SingleOrDefaultAsync(item =>
                item.PublicId == profileId && item.Department == parsed, cancellationToken);
            if (profile is null) return GovernanceResult.Failed(GovernanceFailure.NotFound);
            if (GovernanceSupport.Version(profile.RowVersion) != expectedVersion || !profile.IsActive)
                return GovernanceResult.Failed(GovernanceFailure.Conflict);
            if (await context.UserAccessRequests.AnyAsync(request => request.AccessProfileId == profile.Id &&
                    request.Status == Domain.Enumerations.UserAccessRequestStatus.Pending, cancellationToken))
                return GovernanceResult.Failed(GovernanceFailure.Conflict);
            profile.IsActive = false;
            profile.UpdatedAt = now;
            await RevokeProfileMembersAsync(profile.Id, cancellationToken);
            GovernanceSupport.AddAudit(context, actor.Id, "governance.access_profile.deactivated",
                "iam.access_profiles", profile.PublicId, null, [], now, new AuditFieldChangeData("profile.active", "true", "false"));
            await NotifyDepartmentAsync(parsed, "department_users", profile.PublicId, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return GovernanceResult.Success(profile.PublicId);
        }, cancellationToken);
    }

    /// <summary>Members re-authenticate so their sessions carry the template's new permissions.</summary>
    private async Task RevokeProfileMembersAsync(long profileId, CancellationToken cancellationToken)
    {
        var accountIds = await context.DepartmentAssignments.Where(item => item.AccessProfileId == profileId)
            .Select(item => item.AccountId).ToArrayAsync(cancellationToken);
        var users = await context.Users.Where(user => accountIds.Contains(user.Id)).ToArrayAsync(cancellationToken);
        foreach (var user in users) await userManager.UpdateSecurityStampAsync(user);
    }
}
