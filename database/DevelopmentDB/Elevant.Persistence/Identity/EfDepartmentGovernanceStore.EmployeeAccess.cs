using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Identity;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

/// <summary>
/// Access for employees (ADR-0017): a department asks for an employee of its own, Human Resources
/// validates it and the account is issued to the employee's person. An employee keeps one account for
/// life; a transfer or a new request reuses it.
/// </summary>
internal sealed partial class EfDepartmentGovernanceStore
{
    private sealed record Candidate(Employee Employee, Person Person, JobPosition Position, long[] Stations,
        ApplicationUser? Account);

    private async Task<Candidate?> CandidateAsync(long? employeeId, Guid? employeePublicId, bool tracked,
        CancellationToken cancellationToken)
    {
        var employees = tracked ? context.Employees : context.Employees.AsNoTracking();
        var employee = await employees.SingleOrDefaultAsync(item =>
            (employeeId != null && item.Id == employeeId) || (employeePublicId != null && item.PublicId == employeePublicId),
            cancellationToken);
        if (employee is null) return null;
        var person = await (tracked ? context.Persons : context.Persons.AsNoTracking())
            .SingleAsync(item => item.Id == employee.PersonId, cancellationToken);
        var position = await context.JobPositions.AsNoTracking().SingleAsync(item => item.Id == employee.JobPositionId,
            cancellationToken);
        var stations = await context.EmployeeStations.AsNoTracking()
            .Where(item => item.EmployeeId == employee.Id && item.ValidTo == null)
            .Join(context.Stations.Where(station => station.IsActive), item => item.StationId, station => station.Id,
                (item, station) => station.Id)
            .ToArrayAsync(cancellationToken);
        var account = await (tracked ? context.Users : context.Users.AsNoTracking())
            .SingleOrDefaultAsync(user => user.PersonId == person.Id, cancellationToken);
        return new Candidate(employee, person, position, stations, account);
    }

    /// <summary>The address belongs to someone other than the employee's own person or account.</summary>
    private async Task<bool> EmailTakenByOthersAsync(string email, long personId, CancellationToken cancellationToken)
    {
        var normalized = email.ToUpperInvariant();
        return await context.Persons.AnyAsync(person => person.Id != personId && person.PrimaryEmail == email,
                   cancellationToken) ||
               await context.Users.AnyAsync(user => user.PersonId != personId && user.NormalizedEmail == normalized,
                   cancellationToken);
    }

    private async Task<GovernanceResult> RequestEmployeeAccessAsync(Actor actor, Department department,
        RequestUserAccessInput input, CancellationToken cancellationToken)
    {
        if (input.RequestId == Guid.Empty || input.StationIds is not { Count: > 0 and <= 20 } ||
            input.TerminalIds is { Count: > 40 })
            return GovernanceResult.Failed(GovernanceFailure.Invalid);
        var prior = await context.UserAccessRequests.AsNoTracking()
            .SingleOrDefaultAsync(item => item.PublicId == input.RequestId, cancellationToken);
        if (prior is not null)
            return prior.RequestedByAccountId == actor.Id && prior.Department == department &&
                   prior.EmployeeId is { } priorEmployee &&
                   await context.Employees.AnyAsync(item => item.Id == priorEmployee && item.PublicId == input.EmployeeId,
                       cancellationToken)
                ? GovernanceResult.Success(prior.PublicId)
                : GovernanceResult.Failed(GovernanceFailure.Conflict);

        var candidate = await CandidateAsync(null, input.EmployeeId, tracked: false, cancellationToken);
        if (candidate is null || candidate.Employee.Department != department)
            return GovernanceResult.Failed(GovernanceFailure.NotFound, "employee_not_found");
        if (candidate.Employee.Status != EmployeeStatus.Active)
            return GovernanceResult.Failed(GovernanceFailure.Conflict, "employee_terminated");
        if (candidate.Account?.Status == AccountLifecycleStatus.Active)
            return GovernanceResult.Failed(GovernanceFailure.Conflict, "employee_has_account");
        if (candidate.Person.PrimaryEmail is not { } email)
            return GovernanceResult.Failed(GovernanceFailure.Conflict, "employee_without_email");
        if (await EmailTakenByOthersAsync(email, candidate.Person.Id, cancellationToken))
            return GovernanceResult.Failed(GovernanceFailure.Conflict, "email_in_use");
        var stations = await ResolveStationsAsync(actor, input.StationIds, cancellationToken);
        if (stations is null) return GovernanceResult.Failed(GovernanceFailure.Invalid, "stations_invalid");
        if (stations.Except(candidate.Stations).Any())
            return GovernanceResult.Failed(GovernanceFailure.Invalid, "stations_outside_employee");

        var kind = candidate.Position.IsRampPosition ? UserAccessRequestKind.RampAgent : UserAccessRequestKind.BackOfficeUser;
        GrantSelection grants;
        long[] terminals = [];
        long? supervisorId = null;
        if (kind == UserAccessRequestKind.RampAgent)
        {
            if (input.AccessProfileId is not null || input.PermissionCodes is { Count: > 0 })
                return GovernanceResult.Failed(GovernanceFailure.Invalid, "ramp_agents_have_no_profile");
            if (input.TerminalIds is { Count: > 0 })
            {
                var requested = input.TerminalIds.Distinct().ToArray();
                terminals = await context.Terminals.AsNoTracking().Where(terminal =>
                        requested.Contains(terminal.PublicId) && terminal.IsActive && stations.Contains(terminal.StationId))
                    .Select(terminal => terminal.Id).ToArrayAsync(cancellationToken);
                if (terminals.Length != requested.Length)
                    return GovernanceResult.Failed(GovernanceFailure.Invalid, "terminals_invalid");
            }
            if (input.SupervisorRampAgentId is { } supervisor)
            {
                supervisorId = await context.RampAgents.AsNoTracking()
                    .Where(agent => agent.PublicId == supervisor && agent.IsActive && agent.PersonId != candidate.Person.Id)
                    .Select(agent => (long?)agent.Id).SingleOrDefaultAsync(cancellationToken);
                if (supervisorId is null) return GovernanceResult.Failed(GovernanceFailure.Invalid, "supervisor_invalid");
            }
            grants = new GrantSelection(null, []);
        }
        else
        {
            if (input.TerminalIds is { Count: > 0 } || input.SupervisorRampAgentId is not null)
                return GovernanceResult.Failed(GovernanceFailure.Invalid);
            var resolved = await ResolveGrantsAsync(department, input.AccessProfileId, input.PermissionCodes, cancellationToken);
            if (resolved is null) return GovernanceResult.Failed(GovernanceFailure.Invalid, "permissions_invalid");
            grants = resolved;
        }
        if (!await GovernanceSupport.ValidAvatarAsync(context, input.AvatarMediaUrl, null, cancellationToken))
            return GovernanceResult.Failed(GovernanceFailure.Invalid);

        return await InSerializableTransactionAsync(async () =>
        {
            if (await context.UserAccessRequests.AnyAsync(request => request.Status == UserAccessRequestStatus.Pending &&
                    (request.EmployeeId == candidate.Employee.Id || request.Email == email), cancellationToken))
                return GovernanceResult.Failed(GovernanceFailure.Conflict, "request_pending");
            var now = timeProvider.GetUtcNow();
            var request = new UserAccessRequest
            {
                PublicId = input.RequestId,
                Department = department,
                Kind = kind,
                Status = UserAccessRequestStatus.Pending,
                RequestedByAccountId = actor.Id,
                RequestedAt = now,
                EmployeeId = candidate.Employee.Id,
                FirstName = candidate.Person.FirstName,
                LastName = candidate.Person.LastName,
                Email = email,
                AvatarMediaUrl = input.AvatarMediaUrl,
                AccessProfileId = grants.ProfileId,
                EmployeeNumber = candidate.Employee.EmployeeNumber,
                Category = candidate.Position.Name,
                HireDate = candidate.Employee.HireDate,
                SupervisorRampAgentId = supervisorId,
                CreatedAt = now,
                UpdatedAt = now,
            };
            context.UserAccessRequests.Add(request);
            await context.SaveChangesAsync(cancellationToken);
            foreach (var code in grants.Codes)
                context.UserAccessRequestGrants.Add(new UserAccessRequestGrant { UserAccessRequestId = request.Id, PermissionCode = code });
            foreach (var station in stations)
                context.UserAccessRequestStations.Add(new UserAccessRequestStation { UserAccessRequestId = request.Id, StationId = station });
            foreach (var terminal in terminals)
                context.UserAccessRequestTerminals.Add(new UserAccessRequestTerminal { UserAccessRequestId = request.Id, TerminalId = terminal });
            GovernanceSupport.AddAudit(context, actor.Id, "governance.access_request.requested", "iam.user_access_requests",
                request.PublicId, null, stations.Select(station => (long?)station).ToArray(), now, department,
                new AuditFieldChangeData("request.department", null, KeyOf(department)),
                new AuditFieldChangeData("request.kind", null, kind.ToString()),
                new AuditFieldChangeData("request.employee", null, candidate.Employee.EmployeeNumber));
            await NotifyRequestAsync(request, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return GovernanceResult.Success(request.PublicId);
        }, cancellationToken);
    }

    /// <summary>
    /// Issues or re-issues the employee's account: a new one the first time, otherwise the same account
    /// re-provisioned for the current department (role, assignment, grants and stations).
    /// </summary>
    private async Task<(ApplicationUser? Account, string? Failure)> ProvisionEmployeeAccountAsync(Candidate candidate,
        string temporaryPassword, Department department, DepartmentAssignmentKind kind, long[] stations,
        GrantSelection grants, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var email = candidate.Person.PrimaryEmail!;
        var ramp = candidate.Position.IsRampPosition;
        var roleCode = ramp ? "RAMP_AGENT" : DepartmentAccessResolver.RoleCodeOf(department);
        if (ramp)
            await EnsureRampAgentAsync(candidate.Person.Id, candidate.Employee, candidate.Position, stations, now,
                cancellationToken);
        if (candidate.Account is null)
        {
            var created = await CreateAccountAsync(candidate.Person.Id, email, temporaryPassword, roleCode, department,
                kind, stations, grants, now, cancellationToken);
            return created is null ? (null, "password_policy") : (created, null);
        }

        var user = candidate.Account;
        if (user.Status == AccountLifecycleStatus.Active) return (null, "employee_has_account");
        var role = await context.Roles.SingleOrDefaultAsync(item => item.NormalizedName == roleCode && item.IsActive,
            cancellationToken);
        if (role is null) return (null, "role_missing");
        // Same password policy as a new account; the surrounding transaction rolls back on failure.
        var removed = await userManager.RemovePasswordAsync(user);
        if (!removed.Succeeded) return (null, "password_policy");
        var added = await userManager.AddPasswordAsync(user, temporaryPassword);
        if (!added.Succeeded) return (null, "password_policy");
        if (!string.Equals(user.Email, email, StringComparison.OrdinalIgnoreCase))
        {
            user.Email = email;
            user.UserName = email;
            user.NormalizedEmail = email.ToUpperInvariant();
            user.NormalizedUserName = email.ToUpperInvariant();
        }
        var links = await context.Set<IdentityUserRole<long>>().Where(link => link.UserId == user.Id).ToArrayAsync(cancellationToken);
        context.Set<IdentityUserRole<long>>().RemoveRange(links);
        context.Set<IdentityUserRole<long>>().Add(new IdentityUserRole<long> { UserId = user.Id, RoleId = role.Id });
        var organization = await context.Organizations.SingleAsync(item =>
            item.Code == "AVIAM" && item.Status == OrganizationStatus.Active, cancellationToken);
        var membership = await context.OrganizationMemberships.SingleOrDefaultAsync(item =>
            item.AccountId == user.Id && item.OrganizationId == organization.Id, cancellationToken);
        if (membership is null)
            context.OrganizationMemberships.Add(new OrganizationMembership
            {
                PublicId = Guid.CreateVersion7(), AccountId = user.Id, OrganizationId = organization.Id,
                Kind = MembershipKind.InternalStaff, Status = MembershipStatus.Active,
            });
        else membership.Status = MembershipStatus.Active;
        var assignment = await EnsureAssignmentAsync(user.Id, department, kind, now, cancellationToken);
        assignment.Kind = kind;
        assignment.Department = department;
        assignment.AccessProfileId = kind == DepartmentAssignmentKind.Member ? grants.ProfileId : null;
        assignment.UpdatedAt = now;
        context.AccountPermissionGrants.RemoveRange(await context.AccountPermissionGrants
            .Where(grant => grant.AccountId == user.Id).ToArrayAsync(cancellationToken));
        if (kind == DepartmentAssignmentKind.Member && grants.ProfileId is null)
            foreach (var code in grants.Codes)
                context.AccountPermissionGrants.Add(new AccountPermissionGrant { AccountId = user.Id, PermissionCode = code });
        await SyncStationsAsync(user.Id, stations, ramp ? candidate.Person.Id : null, now, cancellationToken);
        user.Status = AccountLifecycleStatus.Active;
        user.MustChangePassword = true;
        await userManager.UpdateSecurityStampAsync(user);
        await context.SaveChangesAsync(cancellationToken);
        return (user, null);
    }

    /// <summary>Validation of a request made for an employee; runs inside the caller's transaction.</summary>
    private async Task<(ApplicationUser? Account, long[] Stations, GovernanceResult? Failure)> ValidateEmployeeRequestAsync(
        UserAccessRequest request, string temporaryPassword, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var candidate = await CandidateAsync(request.EmployeeId, null, tracked: true, cancellationToken);
        if (candidate is null || candidate.Employee.Status != EmployeeStatus.Active ||
            candidate.Employee.Department != request.Department)
            return (null, [], GovernanceResult.Failed(GovernanceFailure.Conflict, "employee_changed"));
        if (candidate.Person.PrimaryEmail is not { } email || await EmailTakenByOthersAsync(email, candidate.Person.Id,
                cancellationToken))
            return (null, [], GovernanceResult.Failed(GovernanceFailure.Conflict, "email_in_use"));
        var requested = await context.UserAccessRequestStations.Where(item => item.UserAccessRequestId == request.Id)
            .Select(item => item.StationId).ToArrayAsync(cancellationToken);
        var stations = requested.Intersect(candidate.Stations).ToArray();
        if (stations.Length == 0)
            return (null, [], GovernanceResult.Failed(GovernanceFailure.Conflict, "stations_outside_employee"));

        GrantSelection grants;
        if (request.Kind == UserAccessRequestKind.RampAgent)
            grants = new GrantSelection(null, []);
        else if (request.AccessProfileId is { } profileId)
        {
            if (!await context.AccessProfiles.AnyAsync(profile => profile.Id == profileId && profile.IsActive,
                    cancellationToken))
                return (null, [], GovernanceResult.Failed(GovernanceFailure.Conflict, "profile_inactive"));
            grants = new GrantSelection(profileId, []);
        }
        else
        {
            var codes = await context.UserAccessRequestGrants.Where(item => item.UserAccessRequestId == request.Id)
                .Select(item => item.PermissionCode).ToArrayAsync(cancellationToken);
            if (codes.Length == 0) return (null, [], GovernanceResult.Failed(GovernanceFailure.Conflict));
            grants = new GrantSelection(null, codes);
        }
        var (account, failure) = await ProvisionEmployeeAccountAsync(candidate, temporaryPassword, request.Department,
            DepartmentAssignmentKind.Member, stations, grants, now, cancellationToken);
        if (account is null)
            return (null, [], GovernanceResult.Failed(failure == "password_policy"
                ? GovernanceFailure.Invalid : GovernanceFailure.Conflict, failure));
        if (request.Kind == UserAccessRequestKind.RampAgent)
        {
            var agent = await context.RampAgents.SingleAsync(item => item.PersonId == candidate.Person.Id, cancellationToken);
            agent.SupervisorAgentId = request.SupervisorRampAgentId;
            var today = DateOnly.FromDateTime(now.UtcDateTime);
            var wanted = await context.UserAccessRequestTerminals.Where(item => item.UserAccessRequestId == request.Id)
                .Join(context.Terminals.Where(terminal => terminal.IsActive && stations.Contains(terminal.StationId)),
                    item => item.TerminalId, terminal => terminal.Id, (item, terminal) => terminal.Id)
                .ToArrayAsync(cancellationToken);
            var current = await context.Set<RampAgentTerminalScope>()
                .Where(scope => scope.RampAgentId == agent.Id && scope.ValidTo == null).ToArrayAsync(cancellationToken);
            foreach (var scope in current.Where(scope => !wanted.Contains(scope.TerminalId))) scope.ValidTo = today;
            foreach (var terminal in wanted.Except(current.Select(scope => scope.TerminalId)))
                context.Set<RampAgentTerminalScope>().Add(new RampAgentTerminalScope
                { RampAgentId = agent.Id, TerminalId = terminal, ValidFrom = today });
        }
        return (account, stations, null);
    }

    /// <summary>The super administrator names a department administrator from an existing employee.</summary>
    private async Task<GovernanceResult> CreateAdministratorFromEmployeeAsync(Actor actor, Department department,
        CreateDepartmentAccountInput input, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(input.TemporaryPassword) || input.StationIds is not { Count: > 0 and <= 20 })
            return GovernanceResult.Failed(GovernanceFailure.Invalid);
        var stations = await ResolveStationsAsync(actor, input.StationIds, cancellationToken);
        if (stations is null) return GovernanceResult.Failed(GovernanceFailure.Invalid, "stations_invalid");

        return await InSerializableTransactionAsync(async () =>
        {
            var candidate = await CandidateAsync(null, input.EmployeeId, tracked: true, cancellationToken);
            if (candidate is null || candidate.Employee.Department != department)
                return GovernanceResult.Failed(GovernanceFailure.NotFound, "employee_not_found");
            if (candidate.Employee.Status != EmployeeStatus.Active)
                return GovernanceResult.Failed(GovernanceFailure.Conflict, "employee_terminated");
            if (candidate.Position.IsRampPosition)
                return GovernanceResult.Failed(GovernanceFailure.Invalid, "administrators_use_back_office");
            if (candidate.Person.PrimaryEmail is not { } email)
                return GovernanceResult.Failed(GovernanceFailure.Conflict, "employee_without_email");
            if (await EmailTakenByOthersAsync(email, candidate.Person.Id, cancellationToken))
                return GovernanceResult.Failed(GovernanceFailure.Conflict, "email_in_use");
            if (stations.Except(candidate.Stations).Any())
                return GovernanceResult.Failed(GovernanceFailure.Invalid, "stations_outside_employee");
            var now = timeProvider.GetUtcNow();
            var (account, failure) = await ProvisionEmployeeAccountAsync(candidate, input.TemporaryPassword, department,
                DepartmentAssignmentKind.Administrator, stations, new GrantSelection(null, []), now, cancellationToken);
            if (account is null)
                return GovernanceResult.Failed(failure == "password_policy"
                    ? GovernanceFailure.Invalid : GovernanceFailure.Conflict, failure);
            GovernanceSupport.AddAudit(context, actor.Id, "governance.department_user.administrator_created", "iam.accounts",
                account.PublicId, null, stations.Select(station => (long?)station).ToArray(), now, department,
                new AuditFieldChangeData("department", null, KeyOf(department)),
                new AuditFieldChangeData("employee", null, candidate.Employee.EmployeeNumber));
            await NotifyDepartmentAsync(department, "department_users", account.PublicId, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return GovernanceResult.Success(account.PublicId);
        }, cancellationToken);
    }
}
