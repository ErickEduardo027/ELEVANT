using System.Net.Mail;
using System.Data;
using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Audit;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

internal sealed class EfGovernanceStore(
    ElevantDbContext context,
    IActorContextResolver actors,
    UserManager<ApplicationUser> userManager)
    : IGovernanceStore
{
    public async Task<IReadOnlyList<string>?> GetMyPermissionsAsync(Guid actorId,
        CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor is null || !actor.Roles.Any(role => role.Portal == PortalKind.BackOffice) ||
            !actor.Memberships.Any(membership => membership.Kind == MembershipKind.InternalStaff &&
                membership.OrganizationType == OrganizationType.AviamOperator)) return null;
        var roleIds = actor.Roles.Where(role => role.Portal == PortalKind.BackOffice)
            .Select(role => role.RoleId).ToArray();
        return await (from role in context.Roles.AsNoTracking()
            join grant in context.Set<RolePermissionGrant>().AsNoTracking() on role.Id equals grant.RoleId
            join permission in context.Permissions.AsNoTracking() on grant.PermissionId equals permission.Id
            where roleIds.Contains(role.PublicId) && role.IsActive
            select permission.Code).Distinct().OrderBy(code => code).ToArrayAsync(cancellationToken);
    }

    public async Task<GovernanceSnapshot?> GetAsync(Guid actorId,
        CancellationToken cancellationToken = default)
    {
        if (!await IsSuperAdminAsync(actorId, cancellationToken)) return null;
        var roles = await context.Roles.AsNoTracking().OrderBy(role => role.Name)
            .ToArrayAsync(cancellationToken);
        var grants = await (from grant in context.Set<RolePermissionGrant>().AsNoTracking()
            join permission in context.Permissions.AsNoTracking()
                on grant.PermissionId equals permission.Id
            select new { grant.RoleId, permission.Code }).ToArrayAsync(cancellationToken);
        var assignments = await context.Set<IdentityUserRole<long>>().AsNoTracking()
            .ToArrayAsync(cancellationToken);
        var users = await (from account in context.Users.AsNoTracking()
            join person in context.Persons.AsNoTracking()
                on account.PersonId equals person.Id
            orderby person.FirstName, person.LastName
            select new { account, person }).ToArrayAsync(cancellationToken);
        var memberships = await (from membership in context.OrganizationMemberships.AsNoTracking()
            join organization in context.Organizations.AsNoTracking()
                on membership.OrganizationId equals organization.Id
            where membership.Status == MembershipStatus.Active
            select new { membership.AccountId, organization.DisplayName })
            .ToArrayAsync(cancellationToken);
        var rampAgents = await (from agent in context.RampAgents.AsNoTracking()
            join person in context.Persons.AsNoTracking() on agent.PersonId equals person.Id
            where agent.IsActive
            orderby person.FirstName, person.LastName
            select new { agent.Id, agent.PublicId, agent.EmployeeNumber,
                agent.PersonId, person.FirstName, person.LastName }).ToArrayAsync(cancellationToken);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var agentScopes = await (from scope in context.Set<RampAgentStationScope>().AsNoTracking()
            join station in context.Stations.AsNoTracking() on scope.StationId equals station.Id
            where scope.ValidFrom <= today && (scope.ValidTo == null || scope.ValidTo >= today)
                && station.IsActive
            select new { scope.RampAgentId, station.Code }).ToArrayAsync(cancellationToken);
        var roleData = roles.Select(role => new GovernanceRoleData(
            role.PublicId, role.NormalizedName ?? "", role.Name ?? "",
            role.Description, role.Portal.ToString(), role.IsCustom, role.IsActive,
            grants.Where(grant => grant.RoleId == role.Id).Select(grant => grant.Code)
                .OrderBy(code => code).ToArray(),
            assignments.Count(link => link.RoleId == role.Id &&
                users.Any(item => item.account.Id == link.UserId &&
                    item.account.Status == AccountLifecycleStatus.Active)))).ToArray();
        var userData = users.Select(item =>
        {
            var assignment = assignments.FirstOrDefault(link => link.UserId == item.account.Id);
            var role = roles.FirstOrDefault(candidate => candidate.Id == assignment?.RoleId);
            return new GovernanceUserData(item.account.PublicId,
                $"{item.person.FirstName} {item.person.LastName}".Trim(),
                item.account.Email ?? "", item.account.Status.ToString(),
                role?.PublicId ?? Guid.Empty, role?.Name ?? "Sin rol",
                role?.Portal.ToString() ?? "", memberships.FirstOrDefault(membership =>
                    membership.AccountId == item.account.Id)?.DisplayName ?? "",
                item.account.MustChangePassword,
                rampAgents.FirstOrDefault(agent => agent.PersonId == item.account.PersonId)?.PublicId);
        }).ToArray();
        var permissionCodes = await context.Permissions.AsNoTracking()
            .OrderBy(permission => permission.Code).Select(permission => permission.Code)
            .ToArrayAsync(cancellationToken);
        var audit = (await GetAuditAsync(actorId, 1, 50, cancellationToken))!.Entries;
        var rampProfiles = rampAgents.Select(agent => new GovernanceRampProfileData(
            agent.PublicId, $"{agent.FirstName} {agent.LastName}".Trim(), agent.EmployeeNumber,
            agentScopes.Where(scope => scope.RampAgentId == agent.Id)
                .Select(scope => scope.Code).Distinct().OrderBy(code => code).ToArray(),
            users.FirstOrDefault(item => item.account.PersonId == agent.PersonId)?.account.PublicId))
            .ToArray();
        return new GovernanceSnapshot(roleData, userData, permissionCodes, audit, rampProfiles);
    }

    public async Task<GovernanceAuditPage?> GetAuditAsync(Guid actorId, int page, int limit,
        CancellationToken cancellationToken = default)
    {
        if (!await IsSuperAdminAsync(actorId, cancellationToken)) return null;
        page = Math.Clamp(page, 1, 10000);
        limit = Math.Clamp(limit, 1, 100);
        var rows = await context.AuditEntries.AsNoTracking()
            .Where(entry => entry.Action.StartsWith("governance.") ||
                entry.Action.StartsWith("commercial.") || entry.Action.StartsWith("hr."))
            .OrderByDescending(entry => entry.OccurredAt).ThenByDescending(entry => entry.Id)
            .Skip((page - 1) * limit).Take(limit + 1).ToArrayAsync(cancellationToken);
        var actorIds = rows.Where(row => row.ActorAccountId.HasValue)
            .Select(row => row.ActorAccountId!.Value).Distinct().ToArray();
        var names = await (from user in context.Users.AsNoTracking()
            join person in context.Persons.AsNoTracking() on user.PersonId equals person.Id
            where actorIds.Contains(user.Id)
            select new { user.Id, person.FirstName, person.LastName })
            .ToDictionaryAsync(item => item.Id,
                item => $"{item.FirstName} {item.LastName}".Trim(), cancellationToken);
        return new GovernanceAuditPage(page, limit, rows.Length > limit,
            rows.Take(limit).Select(row => new GovernanceAuditData(row.OccurredAt,
                row.Action, row.EntityType, row.EntityPublicId, row.Reason,
                row.ActorAccountId is long id && names.TryGetValue(id, out var name)
                    ? name : row.ActorDisplay ?? "Sistema",
                SafeAuditChanges.Parse(row.MetadataJson))).ToArray());
    }

    public async Task<GovernanceResult> CreateRoleAsync(Guid actorId,
        SaveGovernanceRoleInput input, CancellationToken cancellationToken = default)
    {
        if (!await IsSuperAdminAsync(actorId, cancellationToken))
            return GovernanceResult.Failed(GovernanceFailure.Forbidden);
        var permissions = await ResolvePermissionsAsync(input, cancellationToken);
        if (permissions is null) return GovernanceResult.Failed(GovernanceFailure.Invalid);
        if (await context.Roles.AnyAsync(role => role.Name == input.Name.Trim(), cancellationToken))
            return GovernanceResult.Failed(GovernanceFailure.Conflict);
        var role = new ApplicationRole
        {
            PublicId = Guid.CreateVersion7(),
            Name = input.Name.Trim(),
            NormalizedName = $"CUSTOM_{Guid.NewGuid().ToString("N")[..12].ToUpperInvariant()}",
            Description = input.Description?.Trim(), Portal = PortalKind.BackOffice,
            UserType = "custom", IsCustom = true, IsActive = input.IsActive,
            ConcurrencyStamp = Guid.NewGuid().ToString("D"),
        };
        var strategy = context.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
            context.Roles.Add(role);
            await context.SaveChangesAsync(cancellationToken);
            foreach (var permission in permissions)
                context.Set<RolePermissionGrant>().Add(new RolePermissionGrant
                { RoleId = role.Id, PermissionId = permission.Id });
            await AuditAsync(actorId, "governance.role.created", "iam.roles",
                role.PublicId, null, cancellationToken,
                new("role.name", null, role.Name),
                new("role.active", null, role.IsActive.ToString()),
                new("role.permissions", null, string.Join(", ", permissions.Select(item => item.Code).Order())));
            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return GovernanceResult.Success(role.PublicId);
        });
    }

    public async Task<GovernanceResult> UpdateRoleAsync(Guid actorId, Guid roleId,
        SaveGovernanceRoleInput input, CancellationToken cancellationToken = default)
    {
        if (!await IsSuperAdminAsync(actorId, cancellationToken))
            return GovernanceResult.Failed(GovernanceFailure.Forbidden);
        var role = await context.Roles.SingleOrDefaultAsync(item => item.PublicId == roleId,
            cancellationToken);
        if (role is null) return GovernanceResult.Failed(GovernanceFailure.NotFound);
        if (!role.IsCustom) return GovernanceResult.Failed(GovernanceFailure.Protected);
        var permissions = await ResolvePermissionsAsync(input, cancellationToken);
        if (permissions is null) return GovernanceResult.Failed(GovernanceFailure.Invalid);
        if (await context.Roles.AnyAsync(item => item.Id != role.Id &&
            item.Name == input.Name.Trim(), cancellationToken))
            return GovernanceResult.Failed(GovernanceFailure.Conflict);
        if (!input.IsActive && await ActiveRoleUserCountAsync(role.Id, cancellationToken) > 0)
            return GovernanceResult.Failed(GovernanceFailure.Conflict);
        var previousName = role.Name;
        var previousActive = role.IsActive;
        var previousPermissions = await (from grant in context.Set<RolePermissionGrant>()
            join permission in context.Permissions on grant.PermissionId equals permission.Id
            where grant.RoleId == role.Id select permission.Code)
            .OrderBy(code => code).ToArrayAsync(cancellationToken);
        role.Name = input.Name.Trim();
        role.Description = input.Description?.Trim();
        role.IsActive = input.IsActive;
        role.ConcurrencyStamp = Guid.NewGuid().ToString("D");
        var existing = await context.Set<RolePermissionGrant>()
            .Where(grant => grant.RoleId == role.Id).ToArrayAsync(cancellationToken);
        context.Set<RolePermissionGrant>().RemoveRange(existing);
        foreach (var permission in permissions)
            context.Set<RolePermissionGrant>().Add(new RolePermissionGrant
            { RoleId = role.Id, PermissionId = permission.Id });
        await AuditAsync(actorId, "governance.role.updated", "iam.roles",
            role.PublicId, null, cancellationToken,
            new("role.name", previousName, role.Name),
            new("role.active", previousActive.ToString(), role.IsActive.ToString()),
            new("role.permissions", string.Join(", ", previousPermissions),
                string.Join(", ", permissions.Select(item => item.Code).Order())));
        await context.SaveChangesAsync(cancellationToken);
        await RevokeRoleSessionsAsync(role.Id, cancellationToken);
        return GovernanceResult.Success(role.PublicId);
    }

    public async Task<GovernanceResult> DeleteRoleAsync(Guid actorId, Guid roleId,
        CancellationToken cancellationToken = default)
    {
        if (!await IsSuperAdminAsync(actorId, cancellationToken))
            return GovernanceResult.Failed(GovernanceFailure.Forbidden);
        var role = await context.Roles.SingleOrDefaultAsync(item => item.PublicId == roleId,
            cancellationToken);
        if (role is null) return GovernanceResult.Failed(GovernanceFailure.NotFound);
        if (!role.IsCustom) return GovernanceResult.Failed(GovernanceFailure.Protected);
        if (await ActiveRoleUserCountAsync(role.Id, cancellationToken) > 0)
            return GovernanceResult.Failed(GovernanceFailure.Conflict);
        role.IsActive = false;
        role.ConcurrencyStamp = Guid.NewGuid().ToString("D");
        await AuditAsync(actorId, "governance.role.deactivated", "iam.roles",
            role.PublicId, null, cancellationToken,
            new AuditFieldChangeData("role.active", true.ToString(), false.ToString()));
        await context.SaveChangesAsync(cancellationToken);
        return GovernanceResult.Success(role.PublicId);
    }

    public Task<GovernanceResult> CreateUserAsync(Guid actorId,
        CreateGovernanceUserInput input, CancellationToken cancellationToken = default) =>
        CreateUserCoreAsync(actorId, input, cancellationToken);

    public Task<GovernanceResult> UpdateUserAsync(Guid actorId, Guid userId,
        UpdateGovernanceUserInput input, CancellationToken cancellationToken = default) =>
        UpdateUserCoreAsync(actorId, userId, input, cancellationToken);

    public Task<GovernanceResult> DeleteUserAsync(Guid actorId, Guid userId,
        CancellationToken cancellationToken = default) =>
        DeleteUserCoreAsync(actorId, userId, cancellationToken);

    public Task<GovernanceResult> ResetPasswordAsync(Guid actorId, Guid userId,
        string temporaryPassword, CancellationToken cancellationToken = default) =>
        ResetPasswordCoreAsync(actorId, userId, temporaryPassword, cancellationToken);

    private async Task<GovernanceResult> CreateUserCoreAsync(Guid actorId,
        CreateGovernanceUserInput input, CancellationToken cancellationToken)
    {
        if (!await IsSuperAdminAsync(actorId, cancellationToken))
            return GovernanceResult.Failed(GovernanceFailure.Forbidden);
        if (input is null || !ValidName(input.FirstName) || !ValidName(input.LastName) ||
            !ValidEmail(input.Email) || string.IsNullOrWhiteSpace(input.TemporaryPassword))
            return GovernanceResult.Failed(GovernanceFailure.Invalid);
        var role = await context.Roles.SingleOrDefaultAsync(item =>
            item.PublicId == input.RoleId && item.IsActive &&
            (item.Portal == PortalKind.BackOffice ||
                item.Portal == PortalKind.RampMobileApp && item.NormalizedName == "RAMP_AGENT"), cancellationToken);
        if (role is null) return GovernanceResult.Failed(GovernanceFailure.Invalid);
        var isRamp = role.Portal == PortalKind.RampMobileApp;
        if (isRamp != input.RampAgentId.HasValue)
            return GovernanceResult.Failed(GovernanceFailure.Invalid);
        var rampProfile = isRamp ? await context.RampAgents.SingleOrDefaultAsync(agent =>
            agent.PublicId == input.RampAgentId && agent.IsActive, cancellationToken) : null;
        if (isRamp && (rampProfile is null ||
            await context.Users.AnyAsync(user => user.PersonId == rampProfile.PersonId, cancellationToken) ||
            !await context.Set<RampAgentStationScope>().AnyAsync(scope =>
                scope.RampAgentId == rampProfile.Id && scope.ValidFrom <= DateOnly.FromDateTime(DateTime.UtcNow) &&
                (scope.ValidTo == null || scope.ValidTo >= DateOnly.FromDateTime(DateTime.UtcNow)), cancellationToken)))
            return GovernanceResult.Failed(GovernanceFailure.Conflict);
        var email = input.Email.Trim();
        var normalizedEmail = email.ToUpperInvariant();
        if (await context.Users.AnyAsync(item => item.NormalizedEmail == normalizedEmail,
            cancellationToken) || await context.Persons.AnyAsync(item =>
            item.PrimaryEmail == email && (!isRamp || item.Id != rampProfile!.PersonId), cancellationToken))
            return GovernanceResult.Failed(GovernanceFailure.Conflict);
        var organization = await context.Organizations.SingleAsync(item =>
            item.Code == "AVIAM" && item.Status == OrganizationStatus.Active,
            cancellationToken);
        var strategy = context.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync(
                IsolationLevel.Serializable, cancellationToken);
            var person = isRamp
                ? await context.Persons.SingleAsync(item => item.Id == rampProfile!.PersonId, cancellationToken)
                : new Person
                {
                    PublicId = Guid.CreateVersion7(), FirstName = input.FirstName.Trim(),
                    LastName = input.LastName.Trim(), PrimaryEmail = email,
                    IdentificationType = "GOVERNANCE_ACCOUNT",
                    IdentificationNumber = Guid.CreateVersion7().ToString("N"),
                };
            if (!isRamp) context.Persons.Add(person);
            else if (!string.Equals(person.FirstName, input.FirstName.Trim(), StringComparison.Ordinal) ||
                !string.Equals(person.LastName, input.LastName.Trim(), StringComparison.Ordinal))
                return GovernanceResult.Failed(GovernanceFailure.Invalid);
            await context.SaveChangesAsync(cancellationToken);
            var user = new ApplicationUser
            {
                PublicId = Guid.CreateVersion7(), PersonId = person.Id,
                UserName = email, Email = email, EmailConfirmed = true,
                LockoutEnabled = true, Status = AccountLifecycleStatus.Active,
                InvitationStatus = InvitationStatus.Accepted,
                MustChangePassword = true,
            };
            var result = await userManager.CreateAsync(user, input.TemporaryPassword);
            if (!result.Succeeded) return GovernanceResult.Failed(GovernanceFailure.Invalid);
            context.Set<IdentityUserRole<long>>().Add(new IdentityUserRole<long>
            { UserId = user.Id, RoleId = role.Id });
            context.OrganizationMemberships.Add(new OrganizationMembership
            {
                PublicId = Guid.CreateVersion7(), AccountId = user.Id,
                OrganizationId = organization.Id, Kind = MembershipKind.InternalStaff,
                Status = MembershipStatus.Active,
            });
            if (isRamp)
            {
                var today = DateOnly.FromDateTime(DateTime.UtcNow);
                var stationIds = await context.Set<RampAgentStationScope>()
                    .Where(scope => scope.RampAgentId == rampProfile!.Id && scope.ValidFrom <= today &&
                        (scope.ValidTo == null || scope.ValidTo >= today))
                    .Select(scope => scope.StationId).Distinct().ToArrayAsync(cancellationToken);
                foreach (var stationId in stationIds)
                    context.AccountStationScopes.Add(new AccountStationScope
                    { AccountId = user.Id, StationId = stationId, GrantedAt = DateTimeOffset.UtcNow });
            }
            await AuditAsync(actorId, "governance.user.created", "iam.accounts",
                user.PublicId, null, cancellationToken,
                new("user.role", null, role.NormalizedName),
                new("user.status", null, user.Status.ToString()));
            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return GovernanceResult.Success(user.PublicId);
        });
    }

    private async Task<GovernanceResult> UpdateUserCoreAsync(Guid actorId,
        Guid userId, UpdateGovernanceUserInput input, CancellationToken cancellationToken)
    {
        if (!await IsSuperAdminAsync(actorId, cancellationToken))
            return GovernanceResult.Failed(GovernanceFailure.Forbidden);
        if (input is null || !ValidName(input.FirstName) || !ValidName(input.LastName) ||
            !ValidEmail(input.Email))
            return GovernanceResult.Failed(GovernanceFailure.Invalid);
        var user = await context.Users.SingleOrDefaultAsync(item => item.PublicId == userId,
            cancellationToken);
        if (user is null) return GovernanceResult.Failed(GovernanceFailure.NotFound);
        if (userId == actorId && !input.IsActive)
            return GovernanceResult.Failed(GovernanceFailure.Protected);
        var role = await context.Roles.SingleOrDefaultAsync(item =>
            item.PublicId == input.RoleId && item.IsActive, cancellationToken);
        if (role is null) return GovernanceResult.Failed(GovernanceFailure.Invalid);
        var rampProfile = await context.RampAgents.AsNoTracking()
            .SingleOrDefaultAsync(item => item.PersonId == user.PersonId, cancellationToken);
        if (role.Portal == PortalKind.RampMobileApp &&
                (role.NormalizedName != "RAMP_AGENT" || rampProfile is null ||
                    !rampProfile.IsActive || input.RampAgentId != rampProfile.PublicId) ||
            role.Portal == PortalKind.BackOffice && input.RampAgentId.HasValue ||
            role.Portal == PortalKind.AirlinePortal)
            return GovernanceResult.Failed(GovernanceFailure.Invalid);
        var membership = await context.OrganizationMemberships.SingleOrDefaultAsync(item =>
            item.AccountId == user.Id && item.Status == MembershipStatus.Active,
            cancellationToken);
        if (membership is null ||
            membership.Kind == MembershipKind.InternalStaff && role.Portal != PortalKind.BackOffice &&
                role.Portal != PortalKind.RampMobileApp ||
            membership.Kind == MembershipKind.AirlineClient && role.Portal != PortalKind.AirlinePortal)
            return GovernanceResult.Failed(GovernanceFailure.Protected);
        var assignments = await context.Set<IdentityUserRole<long>>()
            .Where(item => item.UserId == user.Id).ToArrayAsync(cancellationToken);
        var previousRole = await context.Roles.AsNoTracking()
            .Where(item => assignments.Select(link => link.RoleId).Contains(item.Id))
            .Select(item => item.NormalizedName).FirstOrDefaultAsync(cancellationToken);
        var previousStatus = user.Status.ToString();
        var currentSuperAdmin = await context.Roles.AnyAsync(item =>
            assignments.Select(link => link.RoleId).Contains(item.Id) &&
            item.NormalizedName == "SUPERADMIN", cancellationToken);
        if (currentSuperAdmin && (role.NormalizedName != "SUPERADMIN" || !input.IsActive) &&
            await ActiveRoleUserCountAsync(await context.Roles.Where(item =>
                item.NormalizedName == "SUPERADMIN").Select(item => item.Id)
                .SingleAsync(cancellationToken), cancellationToken) <= 1)
            return GovernanceResult.Failed(GovernanceFailure.Protected);
        if (userId == actorId && role.NormalizedName != "SUPERADMIN")
            return GovernanceResult.Failed(GovernanceFailure.Protected);
        var email = input.Email.Trim();
        var normalizedEmail = email.ToUpperInvariant();
        if (await context.Users.AnyAsync(item => item.Id != user.Id &&
            item.NormalizedEmail == normalizedEmail, cancellationToken) ||
            await context.Persons.AnyAsync(item => item.Id != user.PersonId &&
                item.PrimaryEmail == email, cancellationToken))
            return GovernanceResult.Failed(GovernanceFailure.Conflict);
        var person = await context.Persons.SingleAsync(item => item.Id == user.PersonId,
            cancellationToken);
        var strategy = context.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync(
                IsolationLevel.Serializable, cancellationToken);
            person.FirstName = input.FirstName.Trim();
            person.LastName = input.LastName.Trim();
            person.PrimaryEmail = email;
            user.Email = email;
            user.UserName = email;
            user.NormalizedEmail = normalizedEmail;
            user.NormalizedUserName = normalizedEmail;
            user.Status = input.IsActive ? AccountLifecycleStatus.Active : AccountLifecycleStatus.Disabled;
            user.UpdatedAt = DateTimeOffset.UtcNow;
            context.Set<IdentityUserRole<long>>().RemoveRange(assignments);
            context.Set<IdentityUserRole<long>>().Add(new IdentityUserRole<long>
            { UserId = user.Id, RoleId = role.Id });
            await userManager.UpdateSecurityStampAsync(user);
            await AuditAsync(actorId, "governance.user.updated", "iam.accounts",
                user.PublicId, null, cancellationToken,
                new("user.role", previousRole, role.NormalizedName),
                new("user.status", previousStatus, user.Status.ToString()));
            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return GovernanceResult.Success(user.PublicId);
        });
    }

    private async Task<GovernanceResult> DeleteUserCoreAsync(Guid actorId, Guid userId,
        CancellationToken cancellationToken)
    {
        if (!await IsSuperAdminAsync(actorId, cancellationToken))
            return GovernanceResult.Failed(GovernanceFailure.Forbidden);
        if (actorId == userId) return GovernanceResult.Failed(GovernanceFailure.Protected);
        var user = await context.Users.SingleOrDefaultAsync(item => item.PublicId == userId,
            cancellationToken);
        if (user is null) return GovernanceResult.Failed(GovernanceFailure.NotFound);
        var superAdminRoleId = await context.Roles.Where(item =>
            item.NormalizedName == "SUPERADMIN").Select(item => item.Id)
            .SingleAsync(cancellationToken);
        if (await context.Set<IdentityUserRole<long>>().AnyAsync(link =>
            link.UserId == user.Id && link.RoleId == superAdminRoleId,
            cancellationToken) &&
            await ActiveRoleUserCountAsync(superAdminRoleId, cancellationToken) <= 1)
            return GovernanceResult.Failed(GovernanceFailure.Protected);
        var previousStatus = user.Status.ToString();
        user.Status = AccountLifecycleStatus.Disabled;
        user.UpdatedAt = DateTimeOffset.UtcNow;
        await userManager.UpdateSecurityStampAsync(user);
        await AuditAsync(actorId, "governance.user.deactivated", "iam.accounts",
            user.PublicId, null, cancellationToken,
            new AuditFieldChangeData("user.status", previousStatus, user.Status.ToString()));
        await context.SaveChangesAsync(cancellationToken);
        return GovernanceResult.Success(user.PublicId);
    }

    private async Task<GovernanceResult> ResetPasswordCoreAsync(Guid actorId,
        Guid userId, string temporaryPassword, CancellationToken cancellationToken)
    {
        if (!await IsSuperAdminAsync(actorId, cancellationToken))
            return GovernanceResult.Failed(GovernanceFailure.Forbidden);
        if (string.IsNullOrWhiteSpace(temporaryPassword))
            return GovernanceResult.Failed(GovernanceFailure.Invalid);
        var user = await context.Users.SingleOrDefaultAsync(item => item.PublicId == userId,
            cancellationToken);
        if (user is null) return GovernanceResult.Failed(GovernanceFailure.NotFound);
        var token = await userManager.GeneratePasswordResetTokenAsync(user);
        var result = await userManager.ResetPasswordAsync(user, token, temporaryPassword);
        if (!result.Succeeded) return GovernanceResult.Failed(GovernanceFailure.Invalid);
        user.MustChangePassword = true;
        user.UpdatedAt = DateTimeOffset.UtcNow;
        await userManager.UpdateSecurityStampAsync(user);
        await AuditAsync(actorId, "governance.user.password_reset", "iam.accounts",
            user.PublicId, null, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
        return GovernanceResult.Success(user.PublicId);
    }

    private async Task<bool> IsSuperAdminAsync(Guid actorId, CancellationToken cancellationToken)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        return actor?.Roles.Any(role => role.Portal == PortalKind.BackOffice &&
            role.Code == "SUPERADMIN") == true;
    }

    private async Task<PermissionDefinition[]?> ResolvePermissionsAsync(
        SaveGovernanceRoleInput? input, CancellationToken cancellationToken)
    {
        if (input is null || string.IsNullOrWhiteSpace(input.Name) ||
            input.Name.Trim().Length is < 3 or > 120 ||
            input.Description?.Length > 500 ||
            input.PermissionCodes is null or { Count: < 1 or > 30 } ||
            input.PermissionCodes.Distinct(StringComparer.Ordinal).Count() != input.PermissionCodes.Count ||
            input.PermissionCodes.Any(code =>
                (code.EndsWith(".write", StringComparison.Ordinal) ||
                 code.EndsWith(".create", StringComparison.Ordinal) ||
                 code.EndsWith(".edit", StringComparison.Ordinal) ||
                 code.EndsWith(".full", StringComparison.Ordinal)) &&
                !input.PermissionCodes.Contains(code[..code.LastIndexOf('.')] + ".read",
                    StringComparer.Ordinal)) ||
            input.PermissionCodes.Any(code => !code.StartsWith("commercial.", StringComparison.Ordinal)))
            return null;
        var selected = await context.Permissions.Where(permission =>
            input.PermissionCodes.Contains(permission.Code)).ToArrayAsync(cancellationToken);
        return selected.Length == input.PermissionCodes.Count ? selected : null;
    }

    private Task<int> ActiveRoleUserCountAsync(long roleId, CancellationToken cancellationToken) =>
        (from assignment in context.Set<IdentityUserRole<long>>()
         join user in context.Users on assignment.UserId equals user.Id
         where assignment.RoleId == roleId && user.Status == AccountLifecycleStatus.Active
         select user.Id).CountAsync(cancellationToken);

    private async Task RevokeRoleSessionsAsync(long roleId, CancellationToken cancellationToken)
    {
        var userIds = await context.Set<IdentityUserRole<long>>()
            .Where(link => link.RoleId == roleId).Select(link => link.UserId)
            .ToArrayAsync(cancellationToken);
        foreach (var user in await context.Users.Where(item => userIds.Contains(item.Id))
            .ToArrayAsync(cancellationToken))
            await userManager.UpdateSecurityStampAsync(user);
    }

    private async Task AuditAsync(Guid actorId, string action, string entityType,
        Guid entityId, string? reason, CancellationToken cancellationToken,
        params AuditFieldChangeData[] changes)
    {
        var actorDatabaseId = await context.Users.Where(user => user.PublicId == actorId)
            .Select(user => user.Id).SingleAsync(cancellationToken);
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = DateTimeOffset.UtcNow,
            ActorType = AuditActorType.Account, ActorAccountId = actorDatabaseId,
            Action = action, EntityType = entityType, EntityPublicId = entityId,
            Source = AuditSource.Api, CorrelationId = Guid.CreateVersion7(),
            Reason = reason,
            MetadataJson = SafeAuditChanges.Serialize(changes),
        });
    }

    private static bool ValidName(string? value) =>
        !string.IsNullOrWhiteSpace(value) && value.Trim().Length is >= 2 and <= 100;
    private static bool ValidEmail(string? value) =>
        !string.IsNullOrWhiteSpace(value) && value.Trim().Length <= 256 &&
        MailAddress.TryCreate(value.Trim(), out var address) &&
        string.Equals(address.Address, value.Trim(), StringComparison.OrdinalIgnoreCase);
}
