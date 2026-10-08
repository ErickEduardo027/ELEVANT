using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Identity;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

internal sealed partial class EfDepartmentGovernanceStore
{
    public async Task<IReadOnlyList<ClientAirlineData>?> ListClientsAsync(Guid actorId,
        CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !actor.IsSuper) return null;
        var airlines = await (from airline in context.Airlines.AsNoTracking()
                              join organization in context.Organizations.AsNoTracking()
                                  on airline.OrganizationId equals organization.Id
                              where organization.Status == OrganizationStatus.Active
                              orderby airline.Name
                              select new { organization.Id, organization.PublicId, airline.Name, airline.IataCode })
            .ToArrayAsync(cancellationToken);
        var organizationIds = airlines.Select(item => item.Id).ToArray();
        var users = await (from membership in context.OrganizationMemberships.AsNoTracking()
                           join user in context.Users.AsNoTracking() on membership.AccountId equals user.Id
                           where organizationIds.Contains(membership.OrganizationId) &&
                               membership.Kind == MembershipKind.AirlineClient
                           select new { membership.OrganizationId, user.Status, Membership = membership.Status })
            .ToArrayAsync(cancellationToken);
        var byOrganization = users.ToLookup(item => item.OrganizationId);
        return airlines.Select(airline => new ClientAirlineData(airline.PublicId, airline.Name, airline.IataCode,
            byOrganization[airline.Id].Count(),
            byOrganization[airline.Id].Count(item => item.Status == AccountLifecycleStatus.Active &&
                item.Membership == MembershipStatus.Active))).ToArray();
    }

    public async Task<IReadOnlyList<ClientUserData>?> ListClientUsersAsync(Guid actorId, Guid organizationId,
        CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !actor.IsSuper) return null;
        var organization = await AirlineOrganizationAsync(organizationId, cancellationToken);
        if (organization is null) return null;
        return await (from membership in context.OrganizationMemberships.AsNoTracking()
                      join user in context.Users.AsNoTracking() on membership.AccountId equals user.Id
                      join person in context.Persons.AsNoTracking() on user.PersonId equals person.Id
                      where membership.OrganizationId == organization.Value && membership.Kind == MembershipKind.AirlineClient
                      orderby person.LastName, person.FirstName
                      select new ClientUserData(user.PublicId, person.FirstName, person.LastName, user.Email ?? string.Empty,
                          user.Status.ToString(), user.MustChangePassword, user.LastLoginAt,
                          Convert.ToBase64String(user.RowVersion)))
            .ToArrayAsync(cancellationToken);
    }

    /// <summary>The super administrator adds portal users to an airline that already has its organization.</summary>
    public async Task<GovernanceResult> CreateClientUserAsync(Guid actorId, Guid organizationId,
        CreateClientUserInput input, CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !actor.IsSuper) return GovernanceResult.Failed(GovernanceFailure.Forbidden);
        var organization = await AirlineOrganizationAsync(organizationId, cancellationToken);
        if (organization is null) return GovernanceResult.Failed(GovernanceFailure.NotFound);
        if (input is null || !GovernanceSupport.ValidName(input.FirstName) || !GovernanceSupport.ValidName(input.LastName) ||
            !GovernanceSupport.ValidEmail(input.Email) || string.IsNullOrWhiteSpace(input.TemporaryPassword))
            return GovernanceResult.Failed(GovernanceFailure.Invalid);
        if (await EmailInUseAsync(input.Email, null, cancellationToken))
            return GovernanceResult.Failed(GovernanceFailure.Conflict);

        return await InSerializableTransactionAsync(async () =>
        {
            var now = timeProvider.GetUtcNow();
            var role = await context.Roles.SingleOrDefaultAsync(item =>
                item.NormalizedName == "AIRLINE_CLIENT" && item.IsActive, cancellationToken);
            if (role is null) return GovernanceResult.Failed(GovernanceFailure.Conflict);
            var email = input.Email.Trim();
            var person = new Person
            {
                PublicId = Guid.CreateVersion7(),
                FirstName = input.FirstName.Trim(),
                LastName = input.LastName.Trim(),
                PrimaryEmail = email,
                IdentificationType = "GOVERNANCE_ACCOUNT",
                IdentificationNumber = Guid.CreateVersion7().ToString("N"),
            };
            context.Persons.Add(person);
            await context.SaveChangesAsync(cancellationToken);
            var account = new ApplicationUser
            {
                PublicId = Guid.CreateVersion7(),
                PersonId = person.Id,
                UserName = email,
                Email = email,
                EmailConfirmed = true,
                LockoutEnabled = true,
                Status = AccountLifecycleStatus.Active,
                InvitationStatus = InvitationStatus.Accepted,
                MustChangePassword = true,
            };
            var created = await userManager.CreateAsync(account, input.TemporaryPassword);
            if (!created.Succeeded) return GovernanceResult.Failed(GovernanceFailure.Invalid);
            context.Set<IdentityUserRole<long>>().Add(new IdentityUserRole<long> { UserId = account.Id, RoleId = role.Id });
            context.OrganizationMemberships.Add(new OrganizationMembership
            {
                PublicId = Guid.CreateVersion7(),
                AccountId = account.Id,
                OrganizationId = organization.Value,
                Kind = MembershipKind.AirlineClient,
                Status = MembershipStatus.Active,
            });
            GovernanceSupport.AddAudit(context, actor.Id, "governance.client_user.created", "iam.accounts",
                account.PublicId, null, [], now, new AuditFieldChangeData("organization", null, organizationId.ToString()));
            await context.SaveChangesAsync(cancellationToken);
            return GovernanceResult.Success(account.PublicId);
        }, cancellationToken);
    }

    public async Task<GovernanceResult> SetClientUserStatusAsync(Guid actorId, Guid organizationId, Guid userId,
        SetDepartmentUserStatusInput input, CancellationToken cancellationToken = default)
    {
        var target = await ClientTargetAsync(actorId, organizationId, userId, cancellationToken);
        if (target.Failure is { } failure) return GovernanceResult.Failed(failure);
        if (input is null || string.IsNullOrWhiteSpace(input.ExpectedVersion))
            return GovernanceResult.Failed(GovernanceFailure.Invalid);
        return await InSerializableTransactionAsync(async () =>
        {
            var now = timeProvider.GetUtcNow();
            var user = await context.Users.SingleAsync(item => item.Id == target.AccountId, cancellationToken);
            if (GovernanceSupport.Version(user.RowVersion) != input.ExpectedVersion)
                return GovernanceResult.Failed(GovernanceFailure.Conflict);
            var before = user.Status;
            user.Status = input.IsActive ? AccountLifecycleStatus.Active : AccountLifecycleStatus.Disabled;
            await userManager.UpdateSecurityStampAsync(user);
            GovernanceSupport.AddAudit(context, target.ActorId, input.IsActive
                    ? "governance.client_user.reactivated" : "governance.client_user.deactivated",
                "iam.accounts", user.PublicId, null, [], now, new AuditFieldChangeData("user.status", before.ToString(), user.Status.ToString()));
            await context.SaveChangesAsync(cancellationToken);
            return GovernanceResult.Success(user.PublicId);
        }, cancellationToken);
    }

    public async Task<GovernanceResult> ResetClientUserPasswordAsync(Guid actorId, Guid organizationId, Guid userId,
        string temporaryPassword, CancellationToken cancellationToken = default)
    {
        var target = await ClientTargetAsync(actorId, organizationId, userId, cancellationToken);
        if (target.Failure is { } failure) return GovernanceResult.Failed(failure);
        if (string.IsNullOrWhiteSpace(temporaryPassword)) return GovernanceResult.Failed(GovernanceFailure.Invalid);
        var user = await context.Users.SingleAsync(item => item.Id == target.AccountId, cancellationToken);
        var token = await userManager.GeneratePasswordResetTokenAsync(user);
        var result = await userManager.ResetPasswordAsync(user, token, temporaryPassword);
        if (!result.Succeeded) return GovernanceResult.Failed(GovernanceFailure.Invalid);
        user.MustChangePassword = true;
        await userManager.UpdateSecurityStampAsync(user);
        GovernanceSupport.AddAudit(context, target.ActorId, "governance.client_user.password_reset", "iam.accounts",
            user.PublicId, null, [], timeProvider.GetUtcNow());
        await context.SaveChangesAsync(cancellationToken);
        return GovernanceResult.Success(user.PublicId);
    }

    private sealed record ClientTarget(long ActorId, long AccountId, GovernanceFailure? Failure);

    private async Task<ClientTarget> ClientTargetAsync(Guid actorId, Guid organizationId, Guid userId,
        CancellationToken cancellationToken)
    {
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !actor.IsSuper) return new(0, 0, GovernanceFailure.Forbidden);
        var organization = await AirlineOrganizationAsync(organizationId, cancellationToken);
        if (organization is null) return new(actor.Id, 0, GovernanceFailure.NotFound);
        var accountId = await (from membership in context.OrganizationMemberships.AsNoTracking()
                               join user in context.Users.AsNoTracking() on membership.AccountId equals user.Id
                               where user.PublicId == userId && membership.OrganizationId == organization.Value &&
                                   membership.Kind == MembershipKind.AirlineClient
                               select (long?)user.Id).FirstOrDefaultAsync(cancellationToken);
        return accountId is null ? new(actor.Id, 0, GovernanceFailure.NotFound) : new(actor.Id, accountId.Value, null);
    }

    private Task<long?> AirlineOrganizationAsync(Guid organizationId, CancellationToken cancellationToken) =>
        (from organization in context.Organizations.AsNoTracking()
         where organization.PublicId == organizationId && organization.Status == OrganizationStatus.Active &&
             context.Airlines.Any(airline => airline.OrganizationId == organization.Id)
         select (long?)organization.Id).SingleOrDefaultAsync(cancellationToken);

    public async Task<IReadOnlyList<LegacyRoleData>?> ListLegacyRolesAsync(Guid actorId,
        CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !actor.IsSuper) return null;
        var roles = await context.Roles.AsNoTracking()
            .Where(role => role.IsCustom && role.IsActive && role.NormalizedName!.StartsWith("CUSTOM_"))
            .OrderBy(role => role.Name).ToArrayAsync(cancellationToken);
        var roleIds = roles.Select(role => role.Id).ToArray();
        var permissions = (await (from grant in context.Set<RolePermissionGrant>().AsNoTracking()
                                  join permission in context.Permissions.AsNoTracking() on grant.PermissionId equals permission.Id
                                  where roleIds.Contains(grant.RoleId)
                                  select new { grant.RoleId, permission.Code }).ToArrayAsync(cancellationToken))
            .ToLookup(item => item.RoleId, item => item.Code);
        var users = await (from link in context.Set<IdentityUserRole<long>>().AsNoTracking()
                           join user in context.Users.AsNoTracking() on link.UserId equals user.Id
                           where roleIds.Contains(link.RoleId) && user.Status == AccountLifecycleStatus.Active
                           group link by link.RoleId into grouped
                           select new { grouped.Key, Count = grouped.Count() })
            .ToDictionaryAsync(item => item.Key, item => item.Count, cancellationToken);
        return roles.Select(role => new LegacyRoleData(role.PublicId, role.NormalizedName!, role.Name ?? role.NormalizedName!,
            DepartmentAccessResolver.MapLegacyCommercial(permissions[role.Id]).Order(StringComparer.Ordinal).ToArray(),
            users.GetValueOrDefault(role.Id))).ToArray();
    }

    /// <summary>
    /// Turns a legacy CUSTOM_* role into a Contracts template: its holders become
    /// Contracts members that follow the template, and the legacy role is retired.
    /// </summary>
    public async Task<GovernanceResult> ConvertLegacyRoleAsync(Guid actorId, Guid roleId,
        CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !actor.IsSuper) return GovernanceResult.Failed(GovernanceFailure.Forbidden);
        return await InSerializableTransactionAsync(async () =>
        {
            var now = timeProvider.GetUtcNow();
            var role = await context.Roles.SingleOrDefaultAsync(item => item.PublicId == roleId, cancellationToken);
            if (role is null) return GovernanceResult.Failed(GovernanceFailure.NotFound);
            if (!role.IsCustom || !role.IsActive || role.NormalizedName?.StartsWith("CUSTOM_", StringComparison.Ordinal) != true)
                return GovernanceResult.Failed(GovernanceFailure.Conflict);
            var codes = DepartmentAccessResolver.MapLegacyCommercial(await (
                    from grant in context.Set<RolePermissionGrant>()
                    join permission in context.Permissions on grant.PermissionId equals permission.Id
                    where grant.RoleId == role.Id
                    select permission.Code).ToArrayAsync(cancellationToken))
                .Distinct().Order(StringComparer.Ordinal).ToArray();
            if (codes.Length == 0) return GovernanceResult.Failed(GovernanceFailure.Conflict);
            var contractsRole = await context.Roles.SingleOrDefaultAsync(item =>
                item.NormalizedName == DepartmentAccessResolver.RoleCodeOf(Department.Contracts) && item.IsActive,
                cancellationToken);
            if (contractsRole is null) return GovernanceResult.Failed(GovernanceFailure.Conflict);
            var name = (role.Name ?? role.NormalizedName!).Trim();
            if (name.Length > 80) name = name[..80];
            if (await context.AccessProfiles.AnyAsync(item => item.Department == Department.Contracts && item.IsActive &&
                    item.Name == name, cancellationToken))
                return GovernanceResult.Failed(GovernanceFailure.Conflict);

            var profile = new AccessProfile
            {
                PublicId = Guid.CreateVersion7(), Department = Department.Contracts, Name = name,
                Description = role.Description, IsActive = true, CreatedByAccountId = actor.Id,
                CreatedAt = now, UpdatedAt = now,
            };
            context.AccessProfiles.Add(profile);
            await context.SaveChangesAsync(cancellationToken);
            foreach (var code in codes)
                context.AccessProfileGrants.Add(new AccessProfileGrant { AccessProfileId = profile.Id, PermissionCode = code });

            var links = await context.Set<IdentityUserRole<long>>().Where(link => link.RoleId == role.Id)
                .ToArrayAsync(cancellationToken);
            foreach (var link in links)
            {
                context.Set<IdentityUserRole<long>>().Remove(link);
                if (!await context.Set<IdentityUserRole<long>>().AnyAsync(item =>
                        item.UserId == link.UserId && item.RoleId == contractsRole.Id, cancellationToken))
                    context.Set<IdentityUserRole<long>>().Add(new IdentityUserRole<long>
                    { UserId = link.UserId, RoleId = contractsRole.Id });
                var assignment = await context.DepartmentAssignments.SingleOrDefaultAsync(item =>
                    item.AccountId == link.UserId, cancellationToken);
                if (assignment is null)
                    context.DepartmentAssignments.Add(new DepartmentAssignment
                    {
                        PublicId = Guid.CreateVersion7(), AccountId = link.UserId, Kind = DepartmentAssignmentKind.Member,
                        Department = Department.Contracts, AccessProfileId = profile.Id, CreatedAt = now, UpdatedAt = now,
                    });
                else if (assignment.Kind == DepartmentAssignmentKind.Member && assignment.Department == Department.Contracts)
                {
                    assignment.AccessProfileId = profile.Id;
                    assignment.UpdatedAt = now;
                }
            }
            role.IsActive = false;
            await context.SaveChangesAsync(cancellationToken);
            foreach (var user in await context.Users.Where(user => links.Select(link => link.UserId).Contains(user.Id))
                         .ToArrayAsync(cancellationToken))
                await userManager.UpdateSecurityStampAsync(user);
            GovernanceSupport.AddAudit(context, actor.Id, "governance.legacy_role.converted", "iam.access_profiles",
                profile.PublicId, null, [], now, new AuditFieldChangeData("role", role.NormalizedName, null),
                new AuditFieldChangeData("profile.permissions", null, string.Join(',', codes)),
                new AuditFieldChangeData("profile.members", null, links.Length.ToString(System.Globalization.CultureInfo.InvariantCulture)));
            await NotifyDepartmentAsync(Department.Contracts, "department_users", profile.PublicId, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return GovernanceResult.Success(profile.PublicId);
        }, cancellationToken);
    }
}
