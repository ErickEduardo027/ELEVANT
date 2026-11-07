using System.Data;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Common;
using Elevant.Application.Identity;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Domain.Governance;
using Elevant.Infrastructure.Identity;
using Elevant.Persistence.Realtime;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

internal sealed partial class EfDepartmentGovernanceStore
{
    public Task<GovernanceResult> CreateAdministratorAsync(Guid actorId, string department,
        CreateDepartmentAccountInput input, CancellationToken cancellationToken = default) =>
        CreateDirectAsync(actorId, department, input, DepartmentAssignmentKind.Administrator, cancellationToken);

    public Task<GovernanceResult> CreateMemberAsync(Guid actorId, string department,
        CreateDepartmentAccountInput input, CancellationToken cancellationToken = default) =>
        CreateDirectAsync(actorId, department, input, DepartmentAssignmentKind.Member, cancellationToken);

    /// <summary>The super administrator creates accounts directly, active at once and without validation.</summary>
    private async Task<GovernanceResult> CreateDirectAsync(Guid actorId, string department,
        CreateDepartmentAccountInput input, DepartmentAssignmentKind kind, CancellationToken cancellationToken)
    {
        if (!TryParse(department, out var parsed)) return GovernanceResult.Failed(GovernanceFailure.NotFound);
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !actor.IsSuper) return GovernanceResult.Failed(GovernanceFailure.Forbidden);
        if (input?.EmployeeId is not null)
            return kind == DepartmentAssignmentKind.Administrator
                ? await CreateAdministratorFromEmployeeAsync(actor, parsed, input, cancellationToken)
                : GovernanceResult.Failed(GovernanceFailure.Invalid, "members_are_requested");
        if (input is null || !GovernanceSupport.ValidName(input.FirstName) || !GovernanceSupport.ValidName(input.LastName) ||
            !GovernanceSupport.ValidEmail(input.Email) || string.IsNullOrWhiteSpace(input.TemporaryPassword) ||
            input.StationIds is not { Count: > 0 and <= 20 })
            return GovernanceResult.Failed(GovernanceFailure.Invalid);
        var stations = await ResolveStationsAsync(actor, input.StationIds, cancellationToken);
        if (stations is null) return GovernanceResult.Failed(GovernanceFailure.Invalid);
        var grants = kind == DepartmentAssignmentKind.Member
            ? await ResolveGrantsAsync(parsed, input.AccessProfileId, input.PermissionCodes, cancellationToken)
            : new GrantSelection(null, []);
        if (grants is null) return GovernanceResult.Failed(GovernanceFailure.Invalid);
        if (!await GovernanceSupport.ValidAvatarAsync(context, input.AvatarMediaUrl, null, cancellationToken))
            return GovernanceResult.Failed(GovernanceFailure.Invalid);
        if (await EmailInUseAsync(input.Email!, null, cancellationToken))
            return GovernanceResult.Failed(GovernanceFailure.Conflict);

        return await InSerializableTransactionAsync(async () =>
        {
            var now = timeProvider.GetUtcNow();
            var account = await CreateBackOfficeAccountAsync(parsed, kind, input.FirstName!, input.LastName!,
                input.Email!, input.AvatarMediaUrl, input.TemporaryPassword, stations, grants, now, cancellationToken);
            if (account is null) return GovernanceResult.Failed(GovernanceFailure.Invalid);
            GovernanceSupport.AddAudit(context, actor.Id, kind == DepartmentAssignmentKind.Administrator
                    ? "governance.department_user.administrator_created" : "governance.department_user.created",
                "iam.accounts", account.PublicId, null, stations.Select(station => (long?)station).ToArray(), now, parsed,
                new AuditFieldChangeData("department", null, KeyOf(parsed)), new AuditFieldChangeData("kind", null, kind.ToString()));
            await NotifyDepartmentAsync(parsed, "department_users", account.PublicId, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return GovernanceResult.Success(account.PublicId);
        }, cancellationToken);
    }

    public async Task<GovernanceResult> UpdateUserAsync(Guid actorId, string department, Guid userId,
        UpdateDepartmentUserInput input, CancellationToken cancellationToken = default)
    {
        var target = await AuthorizeTargetAsync(actorId, department, userId, cancellationToken);
        if (target.Failure is { } failure) return GovernanceResult.Failed(failure);
        var (actor, parsed, row) = (target.Actor!, target.Department, target.Row!);
        if (input is null || !GovernanceSupport.ValidName(input.FirstName) || !GovernanceSupport.ValidName(input.LastName) ||
            !GovernanceSupport.ValidEmail(input.Email) || input.StationIds is not { Count: > 0 and <= 20 } ||
            string.IsNullOrWhiteSpace(input.ExpectedVersion))
            return GovernanceResult.Failed(GovernanceFailure.Invalid);
        var stations = await ResolveStationsAsync(actor, input.StationIds, cancellationToken);
        if (stations is null) return GovernanceResult.Failed(GovernanceFailure.Invalid);
        var isMember = row.Access.Kind == DepartmentAssignmentKind.Member && !row.IsRampAgent;
        var grants = isMember
            ? await ResolveGrantsAsync(parsed, input.AccessProfileId, input.PermissionCodes, cancellationToken)
            : new GrantSelection(null, []);
        if (grants is null) return GovernanceResult.Failed(GovernanceFailure.Invalid);
        var currentAvatar = row.Avatar;
        if (!await GovernanceSupport.ValidAvatarAsync(context, input.AvatarMediaUrl, currentAvatar, cancellationToken))
            return GovernanceResult.Failed(GovernanceFailure.Invalid);
        if (await EmailInUseAsync(input.Email, row.Id, cancellationToken))
            return GovernanceResult.Failed(GovernanceFailure.Conflict);

        return await InSerializableTransactionAsync(async () =>
        {
            var now = timeProvider.GetUtcNow();
            var user = await context.Users.SingleAsync(item => item.Id == row.Id, cancellationToken);
            if (GovernanceSupport.Version(user.RowVersion) != input.ExpectedVersion)
                return GovernanceResult.Failed(GovernanceFailure.Conflict);
            var person = await context.Persons.SingleAsync(item => item.Id == user.PersonId, cancellationToken);
            var email = input.Email.Trim();
            // Name and address of an employee are Human Resources data; the department edits access only.
            if (await context.Employees.AnyAsync(employee => employee.PersonId == person.Id, cancellationToken) &&
                (person.FirstName != input.FirstName.Trim() || person.LastName != input.LastName.Trim() ||
                 !string.Equals(user.Email, email, StringComparison.OrdinalIgnoreCase)))
                return GovernanceResult.Failed(GovernanceFailure.Conflict, "employee_record_managed_by_hr");
            var changes = new List<AuditFieldChangeData>();
            if (person.FirstName != input.FirstName.Trim() || person.LastName != input.LastName.Trim())
                changes.Add(new AuditFieldChangeData("user.name", $"{person.FirstName} {person.LastName}",
                    $"{input.FirstName.Trim()} {input.LastName.Trim()}"));
            person.FirstName = input.FirstName.Trim();
            person.LastName = input.LastName.Trim();
            if (input.AvatarMediaUrl is not null) person.AvatarMediaUrl = input.AvatarMediaUrl;
            if (!string.Equals(user.Email, email, StringComparison.OrdinalIgnoreCase))
            {
                changes.Add(new AuditFieldChangeData("user.email", user.Email, email));
                person.PrimaryEmail = email;
                user.Email = email;
                user.UserName = email;
                user.NormalizedEmail = email.ToUpperInvariant();
                user.NormalizedUserName = email.ToUpperInvariant();
            }
            await SyncStationsAsync(user.Id, stations, row.IsRampAgent ? person.Id : null, now, cancellationToken);
            if (isMember)
            {
                var assignment = await EnsureAssignmentAsync(user.Id, parsed, DepartmentAssignmentKind.Member, now,
                    cancellationToken);
                assignment.AccessProfileId = grants.ProfileId;
                assignment.UpdatedAt = now;
                var existing = await context.AccountPermissionGrants.Where(grant => grant.AccountId == user.Id)
                    .ToArrayAsync(cancellationToken);
                context.AccountPermissionGrants.RemoveRange(existing);
                foreach (var code in grants.ProfileId is null ? grants.Codes : [])
                    context.AccountPermissionGrants.Add(new AccountPermissionGrant { AccountId = user.Id, PermissionCode = code });
                changes.Add(new AuditFieldChangeData("user.permissions", string.Join(',', row.Access.Permissions.Order(StringComparer.Ordinal)),
                    grants.ProfileId is null ? string.Join(',', grants.Codes) : "template"));
            }
            await userManager.UpdateSecurityStampAsync(user);
            GovernanceSupport.AddAudit(context, actor.Id, "governance.department_user.updated", "iam.accounts",
                user.PublicId, null, stations.Select(station => (long?)station).ToArray(), now, parsed, [.. changes]);
            await NotifyDepartmentAsync(parsed, "department_users", user.PublicId, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return GovernanceResult.Success(user.PublicId);
        }, cancellationToken);
    }

    public async Task<GovernanceResult> SetUserStatusAsync(Guid actorId, string department, Guid userId,
        SetDepartmentUserStatusInput input, CancellationToken cancellationToken = default)
    {
        var target = await AuthorizeTargetAsync(actorId, department, userId, cancellationToken);
        if (target.Failure is { } failure) return GovernanceResult.Failed(failure);
        if (input is null || string.IsNullOrWhiteSpace(input.ExpectedVersion))
            return GovernanceResult.Failed(GovernanceFailure.Invalid);
        return await InSerializableTransactionAsync(async () =>
        {
            var now = timeProvider.GetUtcNow();
            var user = await context.Users.SingleAsync(item => item.Id == target.Row!.Id, cancellationToken);
            if (GovernanceSupport.Version(user.RowVersion) != input.ExpectedVersion)
                return GovernanceResult.Failed(GovernanceFailure.Conflict);
            if (input.IsActive && await IsTerminatedAccountAsync(user.Id, cancellationToken))
                return GovernanceResult.Failed(GovernanceFailure.Conflict, "employee_terminated");
            var before = user.Status;
            user.Status = input.IsActive ? AccountLifecycleStatus.Active : AccountLifecycleStatus.Disabled;
            await userManager.UpdateSecurityStampAsync(user);
            GovernanceSupport.AddAudit(context, target.Actor!.Id, input.IsActive
                    ? "governance.department_user.reactivated" : "governance.department_user.deactivated",
                "iam.accounts", user.PublicId, null, [], now, target.Department,
                new AuditFieldChangeData("user.status", before.ToString(), user.Status.ToString()));
            await NotifyDepartmentAsync(target.Department, "department_users", user.PublicId, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return GovernanceResult.Success(user.PublicId);
        }, cancellationToken);
    }

    public async Task<GovernanceResult> ResetUserPasswordAsync(Guid actorId, string department, Guid userId,
        string temporaryPassword, CancellationToken cancellationToken = default)
    {
        var target = await AuthorizeTargetAsync(actorId, department, userId, cancellationToken);
        if (target.Failure is { } failure) return GovernanceResult.Failed(failure);
        if (string.IsNullOrWhiteSpace(temporaryPassword)) return GovernanceResult.Failed(GovernanceFailure.Invalid);
        var user = await context.Users.SingleAsync(item => item.Id == target.Row!.Id, cancellationToken);
        var token = await userManager.GeneratePasswordResetTokenAsync(user);
        var result = await userManager.ResetPasswordAsync(user, token, temporaryPassword);
        if (!result.Succeeded) return GovernanceResult.Failed(GovernanceFailure.Invalid);
        user.MustChangePassword = true;
        await userManager.UpdateSecurityStampAsync(user);
        var now = timeProvider.GetUtcNow();
        GovernanceSupport.AddAudit(context, target.Actor!.Id, "governance.department_user.password_reset",
            "iam.accounts", user.PublicId, null, [], now, target.Department);
        await context.SaveChangesAsync(cancellationToken);
        return GovernanceResult.Success(user.PublicId);
    }

    private sealed record TargetAuthorization(Actor? Actor, Department Department, UserRow? Row,
        GovernanceFailure? Failure);

    /// <summary>
    /// The super administrator manages every account of a department; a department
    /// administrator manages only its members. Nobody manages their own account here.
    /// </summary>
    private async Task<TargetAuthorization> AuthorizeTargetAsync(Guid actorId, string department, Guid userId,
        CancellationToken cancellationToken)
    {
        if (!TryParse(department, out var parsed))
            return new(null, default, null, GovernanceFailure.NotFound);
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !actor.Administers(parsed))
            return new(actor, parsed, null, GovernanceFailure.Forbidden);
        var row = (await DepartmentUsersAsync(parsed, cancellationToken)).SingleOrDefault(user => user.PublicId == userId);
        if (row is null) return new(actor, parsed, null, GovernanceFailure.NotFound);
        if (row.Id == actor.Id) return new(actor, parsed, row, GovernanceFailure.Protected);
        if (row.Access.Kind == DepartmentAssignmentKind.Administrator && !actor.IsSuper)
            return new(actor, parsed, row, GovernanceFailure.Forbidden);
        return new(actor, parsed, row, null);
    }

    private sealed record GrantSelection(long? ProfileId, IReadOnlyList<string> Codes);

    /// <summary>A member follows an active template of the department or an explicit, non-empty grant set.</summary>
    private async Task<GrantSelection?> ResolveGrantsAsync(Department department, Guid? profileId,
        IReadOnlyList<string>? codes, CancellationToken cancellationToken)
    {
        if (profileId is { } publicId)
        {
            var profile = await context.AccessProfiles.AsNoTracking().SingleOrDefaultAsync(item =>
                item.PublicId == publicId && item.Department == department && item.IsActive, cancellationToken);
            return profile is null ? null : new GrantSelection(profile.Id, []);
        }
        if (codes is not { Count: > 0 and <= 120 } ||
            codes.Any(code => !DepartmentPermissionCatalog.Belongs(code, department)))
            return null;
        return new GrantSelection(null, DepartmentPermissionCatalog.Normalize(codes));
    }

    /// <summary>Active stations the actor may grant: any for the super administrator, otherwise its own.</summary>
    private async Task<long[]?> ResolveStationsAsync(Actor actor, IReadOnlyList<Guid> stationIds,
        CancellationToken cancellationToken)
    {
        var distinct = stationIds.Distinct().ToArray();
        if (distinct.Length != stationIds.Count || (!actor.IsSuper && distinct.Any(id => !actor.StationIds.Contains(id))))
            return null;
        var stations = await context.Stations.AsNoTracking()
            .Where(station => distinct.Contains(station.PublicId) && station.IsActive)
            .Select(station => station.Id).ToArrayAsync(cancellationToken);
        return stations.Length == distinct.Length ? stations : null;
    }

    private async Task<bool> EmailInUseAsync(string email, long? exceptAccountId, CancellationToken cancellationToken)
    {
        var trimmed = email.Trim();
        var normalized = trimmed.ToUpperInvariant();
        var exceptPerson = exceptAccountId is null ? (long?)null : await context.Users
            .Where(user => user.Id == exceptAccountId).Select(user => (long?)user.PersonId).SingleAsync(cancellationToken);
        return await context.Users.AnyAsync(user => user.NormalizedEmail == normalized && user.Id != exceptAccountId,
                   cancellationToken) ||
               await context.Persons.AnyAsync(person => person.PrimaryEmail == trimmed && person.Id != exceptPerson,
                   cancellationToken);
    }

    /// <summary>Creates an AVIAM Web account of a department with its role, membership, stations and grants.</summary>
    private async Task<ApplicationUser?> CreateBackOfficeAccountAsync(Department department, DepartmentAssignmentKind kind,
        string firstName, string lastName, string email, string? avatarUrl, string temporaryPassword, long[] stations,
        GrantSelection grants, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var person = new Person
        {
            PublicId = Guid.CreateVersion7(),
            FirstName = firstName.Trim(),
            LastName = lastName.Trim(),
            PrimaryEmail = email.Trim(),
            AvatarMediaUrl = avatarUrl,
            IdentificationType = "GOVERNANCE_ACCOUNT",
            IdentificationNumber = Guid.CreateVersion7().ToString("N"),
        };
        context.Persons.Add(person);
        await context.SaveChangesAsync(cancellationToken);
        var roleCode = DepartmentAccessResolver.RoleCodeOf(department);
        return await CreateAccountAsync(person.Id, email, temporaryPassword, roleCode, department, kind, stations,
            grants, now, cancellationToken);
    }

    private async Task<ApplicationUser?> CreateAccountAsync(long personId, string email, string temporaryPassword,
        string roleCode, Department department, DepartmentAssignmentKind kind, long[] stations, GrantSelection grants,
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        var role = await context.Roles.SingleOrDefaultAsync(item => item.NormalizedName == roleCode && item.IsActive,
            cancellationToken);
        if (role is null) return null;
        var organization = await context.Organizations.SingleAsync(item =>
            item.Code == "AVIAM" && item.Status == OrganizationStatus.Active, cancellationToken);
        var user = new ApplicationUser
        {
            PublicId = Guid.CreateVersion7(),
            PersonId = personId,
            UserName = email.Trim(),
            Email = email.Trim(),
            EmailConfirmed = true,
            LockoutEnabled = true,
            Status = AccountLifecycleStatus.Active,
            InvitationStatus = InvitationStatus.Accepted,
            MustChangePassword = true,
        };
        var result = await userManager.CreateAsync(user, temporaryPassword);
        if (!result.Succeeded) return null;
        context.Set<IdentityUserRole<long>>().Add(new IdentityUserRole<long> { UserId = user.Id, RoleId = role.Id });
        context.OrganizationMemberships.Add(new OrganizationMembership
        {
            PublicId = Guid.CreateVersion7(),
            AccountId = user.Id,
            OrganizationId = organization.Id,
            Kind = MembershipKind.InternalStaff,
            Status = MembershipStatus.Active,
        });
        foreach (var stationId in stations)
            context.AccountStationScopes.Add(new AccountStationScope { AccountId = user.Id, StationId = stationId, GrantedAt = now });
        context.DepartmentAssignments.Add(new DepartmentAssignment
        {
            PublicId = Guid.CreateVersion7(),
            AccountId = user.Id,
            Kind = kind,
            Department = department,
            AccessProfileId = kind == DepartmentAssignmentKind.Member ? grants.ProfileId : null,
            CreatedAt = now,
            UpdatedAt = now,
        });
        if (kind == DepartmentAssignmentKind.Member && grants.ProfileId is null)
            foreach (var code in grants.Codes)
                context.AccountPermissionGrants.Add(new AccountPermissionGrant { AccountId = user.Id, PermissionCode = code });
        await context.SaveChangesAsync(cancellationToken);
        return user;
    }

    /// <summary>Legacy accounts get their explicit assignment the first time they are edited.</summary>
    private async Task<DepartmentAssignment> EnsureAssignmentAsync(long accountId, Department department,
        DepartmentAssignmentKind kind, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var assignment = await context.DepartmentAssignments.SingleOrDefaultAsync(item => item.AccountId == accountId,
            cancellationToken);
        if (assignment is not null) return assignment;
        assignment = new DepartmentAssignment
        {
            PublicId = Guid.CreateVersion7(), AccountId = accountId, Kind = kind, Department = department,
            CreatedAt = now, UpdatedAt = now,
        };
        context.DepartmentAssignments.Add(assignment);
        return assignment;
    }

    /// <summary>
    /// Replaces the account's station scopes. For ramp agents the operational profile
    /// follows: removed stations end their agent scope and terminals, new ones start today.
    /// </summary>
    private async Task SyncStationsAsync(long accountId, long[] stations, long? rampPersonId, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var current = await context.AccountStationScopes
            .Where(scope => scope.AccountId == accountId && scope.RevokedAt == null).ToArrayAsync(cancellationToken);
        foreach (var scope in current.Where(scope => !stations.Contains(scope.StationId)))
            scope.RevokedAt = now;
        foreach (var stationId in stations.Except(current.Select(scope => scope.StationId)))
            context.AccountStationScopes.Add(new AccountStationScope { AccountId = accountId, StationId = stationId, GrantedAt = now });
        if (rampPersonId is null) return;

        var agent = await context.RampAgents.SingleOrDefaultAsync(item => item.PersonId == rampPersonId, cancellationToken);
        if (agent is null) return;
        var today = BusinessCalendar.Today(now);
        var agentScopes = await context.Set<RampAgentStationScope>()
            .Where(scope => scope.RampAgentId == agent.Id && scope.ValidTo == null).ToArrayAsync(cancellationToken);
        var removed = agentScopes.Where(scope => !stations.Contains(scope.StationId)).ToArray();
        foreach (var scope in removed) scope.ValidTo = today;
        foreach (var stationId in stations.Except(agentScopes.Select(scope => scope.StationId)))
            context.Set<RampAgentStationScope>().Add(new RampAgentStationScope
            { RampAgentId = agent.Id, StationId = stationId, ValidFrom = today });
        var removedStations = removed.Select(scope => scope.StationId).ToArray();
        if (removedStations.Length == 0) return;
        var terminals = await (from scope in context.Set<RampAgentTerminalScope>()
                               join terminal in context.Terminals on scope.TerminalId equals terminal.Id
                               where scope.RampAgentId == agent.Id && scope.ValidTo == null &&
                                   removedStations.Contains(terminal.StationId)
                               select scope).ToArrayAsync(cancellationToken);
        foreach (var scope in terminals) scope.ValidTo = today;
    }

    /// <summary>Hints the department administrators and the super administrator; data is re-read through REST.</summary>
    private async Task NotifyDepartmentAsync(Department department, string resource, Guid resourceId,
        DateTimeOffset now, CancellationToken cancellationToken, bool includeValidators = false,
        long? alsoNotify = null)
    {
        var accounts = await DepartmentAccessQueries.ActiveInternalAccounts(context).ToArrayAsync(cancellationToken);
        var accesses = await DepartmentAccessQueries.ReadManyAsync(context, accounts, cancellationToken);
        foreach (var (accountId, access) in accesses)
        {
            if (access.Administers(department) || includeValidators && access.Has(ValidateRequestsPermission))
                AccountChangeOutboxWriter.Add(context, accountId, null, resource, resourceId, now);
        }
        if (alsoNotify is { } extra && !(accesses.TryGetValue(extra, out var extraAccess) &&
                (extraAccess.Administers(department) || includeValidators && extraAccess.Has(ValidateRequestsPermission))))
            AccountChangeOutboxWriter.Add(context, extra, null, resource, resourceId, now);
    }

    private async Task<GovernanceResult> InSerializableTransactionAsync(Func<Task<GovernanceResult>> work,
        CancellationToken cancellationToken)
    {
        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(
                    IsolationLevel.Serializable, cancellationToken);
                var result = await work();
                if (result.IsSuccess) await transaction.CommitAsync(cancellationToken);
                else await transaction.RollbackAsync(cancellationToken);
                return result;
            });
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return GovernanceResult.Failed(GovernanceFailure.Conflict);
        }
        catch (DbUpdateException)
        {
            context.ChangeTracker.Clear();
            return GovernanceResult.Failed(GovernanceFailure.Conflict);
        }
    }
}
