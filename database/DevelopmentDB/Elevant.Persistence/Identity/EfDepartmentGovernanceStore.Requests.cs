using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Common;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Domain.Governance;
using Elevant.Infrastructure.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

internal sealed partial class EfDepartmentGovernanceStore
{
    /// <summary>
    /// A department administrator asks Human Resources to create an account. The client
    /// generated request id is the idempotency key: a replay by the same requester
    /// returns the original request instead of creating a second one.
    /// </summary>
    public async Task<GovernanceResult> RequestAccessAsync(Guid actorId, string department,
        RequestUserAccessInput input, CancellationToken cancellationToken = default)
    {
        if (!TryParse(department, out var parsed)) return GovernanceResult.Failed(GovernanceFailure.NotFound);
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !actor.Administers(parsed)) return GovernanceResult.Failed(GovernanceFailure.Forbidden);
        if (input?.EmployeeId is not null)
            return await RequestEmployeeAccessAsync(actor, parsed, input, cancellationToken);
        if (input is null || input.RequestId == Guid.Empty ||
            !Enum.TryParse<UserAccessRequestKind>(input.Kind, false, out var kind) ||
            !GovernanceSupport.ValidName(input.FirstName) || !GovernanceSupport.ValidName(input.LastName) ||
            !GovernanceSupport.ValidEmail(input.Email) || input.StationIds is not { Count: > 0 and <= 20 })
            return GovernanceResult.Failed(GovernanceFailure.Invalid, "invalid_access_request");

        var prior = await context.UserAccessRequests.AsNoTracking()
            .SingleOrDefaultAsync(item => item.PublicId == input.RequestId, cancellationToken);
        if (prior is not null)
            return prior.RequestedByAccountId == actor.Id && prior.Department == parsed &&
                string.Equals(prior.Email, input.Email!.Trim(), StringComparison.OrdinalIgnoreCase)
                    ? GovernanceResult.Success(prior.PublicId)
                    : GovernanceResult.Failed(GovernanceFailure.Conflict, "idempotency_conflict");

        var stations = await ResolveStationsAsync(actor, input.StationIds, cancellationToken);
        if (stations is null) return GovernanceResult.Failed(GovernanceFailure.Invalid);
        GrantSelection grants;
        long[] terminals = [];
        long? supervisorId = null;
        if (kind == UserAccessRequestKind.RampAgent)
        {
            var today = DateOnly.FromDateTime(timeProvider.GetUtcNow().UtcDateTime);
            if (parsed != Department.Operations || input.AccessProfileId is not null || input.PermissionCodes is { Count: > 0 } ||
                string.IsNullOrWhiteSpace(input.EmployeeNumber) || input.EmployeeNumber.Trim().Length is < 2 or > 32 ||
                string.IsNullOrWhiteSpace(input.Category) || input.Category.Trim().Length is < 2 or > 64 ||
                input.HireDate is not { } hireDate || hireDate == default || hireDate > today ||
                input.TerminalIds is { Count: > 40 })
                return GovernanceResult.Failed(GovernanceFailure.Invalid);
            if (input.TerminalIds is { Count: > 0 })
            {
                var requested = input.TerminalIds.Distinct().ToArray();
                terminals = await context.Terminals.AsNoTracking().Where(terminal =>
                        requested.Contains(terminal.PublicId) && terminal.IsActive && stations.Contains(terminal.StationId))
                    .Select(terminal => terminal.Id).ToArrayAsync(cancellationToken);
                if (terminals.Length != input.TerminalIds.Count) return GovernanceResult.Failed(GovernanceFailure.Invalid);
            }
            if (input.SupervisorRampAgentId is { } supervisor)
            {
                supervisorId = await context.RampAgents.AsNoTracking()
                    .Where(agent => agent.PublicId == supervisor && agent.IsActive)
                    .Select(agent => (long?)agent.Id).SingleOrDefaultAsync(cancellationToken);
                if (supervisorId is null) return GovernanceResult.Failed(GovernanceFailure.Invalid);
            }
            if (await context.RampAgents.AnyAsync(agent => agent.EmployeeNumber == input.EmployeeNumber.Trim(),
                    cancellationToken) ||
                await context.UserAccessRequests.AnyAsync(request => request.Status == UserAccessRequestStatus.Pending &&
                    request.EmployeeNumber == input.EmployeeNumber.Trim(), cancellationToken))
                return GovernanceResult.Failed(GovernanceFailure.Conflict);
            grants = new GrantSelection(null, []);
        }
        else
        {
            if (input.TerminalIds is { Count: > 0 } || input.EmployeeNumber is not null || input.Category is not null ||
                input.HireDate is not null || input.SupervisorRampAgentId is not null)
                return GovernanceResult.Failed(GovernanceFailure.Invalid);
            var resolved = await ResolveGrantsAsync(parsed, input.AccessProfileId, input.PermissionCodes, cancellationToken);
            if (resolved is null) return GovernanceResult.Failed(GovernanceFailure.Invalid);
            grants = resolved;
        }
        if (!await GovernanceSupport.ValidAvatarAsync(context, input.AvatarMediaUrl, null, cancellationToken))
            return GovernanceResult.Failed(GovernanceFailure.Invalid);
        if (await EmailInUseAsync(input.Email!, null, cancellationToken))
            return GovernanceResult.Failed(GovernanceFailure.Conflict);

        return await InSerializableTransactionAsync(async () =>
        {
            var now = timeProvider.GetUtcNow();
            var email = input.Email!.Trim();
            if (await context.UserAccessRequests.AnyAsync(request => request.Status == UserAccessRequestStatus.Pending &&
                    request.Email == email, cancellationToken))
                return GovernanceResult.Failed(GovernanceFailure.Conflict);
            var request = new UserAccessRequest
            {
                PublicId = input.RequestId,
                Department = parsed,
                Kind = kind,
                Status = UserAccessRequestStatus.Pending,
                RequestedByAccountId = actor.Id,
                RequestedAt = now,
                FirstName = input.FirstName!.Trim(),
                LastName = input.LastName!.Trim(),
                Email = email,
                AvatarMediaUrl = input.AvatarMediaUrl,
                AccessProfileId = grants.ProfileId,
                EmployeeNumber = input.EmployeeNumber?.Trim(),
                Category = input.Category?.Trim(),
                HireDate = input.HireDate,
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
                request.PublicId, null, stations.Select(station => (long?)station).ToArray(), now, parsed,
                new AuditFieldChangeData("request.department", null, KeyOf(parsed)), new AuditFieldChangeData("request.kind", null, kind.ToString()));
            await NotifyRequestAsync(request, now, cancellationToken);
            await DepartmentNotificationWriter.NotifyAsync(context, Department.HumanResources,
                "human_resources.access_requests.validate", "access_request", request.PublicId,
                $"{request.FirstName} {request.LastName}", now, cancellationToken, exceptAccountId: actor.Id);
            await context.SaveChangesAsync(cancellationToken);
            return GovernanceResult.Success(request.PublicId);
        }, cancellationToken);
    }

    public async Task<AccessRequestPage?> ListRequestsAsync(Guid actorId, string? department, string? status,
        int page, int limit, CancellationToken cancellationToken = default)
    {
        if (page < 1 || limit is < 1 or > 100) return null;
        Department? parsed = null;
        if (department is not null)
        {
            if (!TryParse(department, out var value)) return null;
            parsed = value;
        }
        UserAccessRequestStatus? parsedStatus = null;
        if (status is not null)
        {
            if (!Enum.TryParse<UserAccessRequestStatus>(status, false, out var value)) return null;
            parsedStatus = value;
        }
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null) return null;
        var seesAll = actor.IsSuper || actor.CanValidate;
        if (!seesAll && (actor.Access?.Department is not { } own || !actor.Administers(own) ||
                parsed is not null && parsed != own))
            return null;
        var visibleDepartment = seesAll ? parsed : actor.Access!.Department;

        var query = context.UserAccessRequests.AsNoTracking()
            .Where(request => visibleDepartment == null || request.Department == visibleDepartment)
            .Where(request => parsedStatus == null || request.Status == parsedStatus);
        var rows = await query
            .OrderBy(request => request.Status == UserAccessRequestStatus.Pending ? 0 : 1)
            .ThenByDescending(request => request.RequestedAt)
            .Skip((page - 1) * limit).Take(limit + 1)
            .ToArrayAsync(cancellationToken);
        var hasMore = rows.Length > limit;
        rows = rows.Take(limit).ToArray();
        return new AccessRequestPage(page, limit, hasMore, await MapRequestsAsync(rows, cancellationToken));
    }

    private async Task<IReadOnlyList<AccessRequestData>> MapRequestsAsync(IReadOnlyList<UserAccessRequest> rows,
        CancellationToken cancellationToken)
    {
        var ids = rows.Select(row => row.Id).ToArray();
        var accountIds = rows.Select(row => row.RequestedByAccountId)
            .Concat(rows.Where(row => row.DecidedByAccountId != null).Select(row => row.DecidedByAccountId!.Value))
            .Concat(rows.Where(row => row.CreatedAccountId != null).Select(row => row.CreatedAccountId!.Value))
            .Distinct().ToArray();
        var accounts = await (from user in context.Users.AsNoTracking()
                              join person in context.Persons.AsNoTracking() on user.PersonId equals person.Id
                              where accountIds.Contains(user.Id)
                              select new { user.Id, user.PublicId, Name = person.FirstName + " " + person.LastName })
            .ToDictionaryAsync(item => item.Id, cancellationToken);
        var profileIds = rows.Where(row => row.AccessProfileId != null).Select(row => row.AccessProfileId!.Value).ToArray();
        var profiles = await context.AccessProfiles.AsNoTracking().Where(profile => profileIds.Contains(profile.Id))
            .ToDictionaryAsync(profile => profile.Id, cancellationToken);
        var profileGrants = (await context.AccessProfileGrants.AsNoTracking()
            .Where(grant => profileIds.Contains(grant.AccessProfileId)).ToArrayAsync(cancellationToken))
            .ToLookup(grant => grant.AccessProfileId, grant => grant.PermissionCode);
        var grants = (await context.UserAccessRequestGrants.AsNoTracking()
            .Where(grant => ids.Contains(grant.UserAccessRequestId)).ToArrayAsync(cancellationToken))
            .ToLookup(grant => grant.UserAccessRequestId, grant => grant.PermissionCode);
        var stations = (await (from link in context.UserAccessRequestStations.AsNoTracking()
                               join station in context.Stations.AsNoTracking() on link.StationId equals station.Id
                               where ids.Contains(link.UserAccessRequestId)
                               orderby station.Code
                               select new { link.UserAccessRequestId, station.PublicId, station.Code })
                .ToArrayAsync(cancellationToken))
            .ToLookup(item => item.UserAccessRequestId, item => new GovernanceStationData(item.PublicId, item.Code));
        var terminals = (await (from link in context.UserAccessRequestTerminals.AsNoTracking()
                                join terminal in context.Terminals.AsNoTracking() on link.TerminalId equals terminal.Id
                                join station in context.Stations.AsNoTracking() on terminal.StationId equals station.Id
                                where ids.Contains(link.UserAccessRequestId)
                                orderby terminal.Code
                                select new { link.UserAccessRequestId, terminal.PublicId, terminal.Code, Station = station.PublicId })
                .ToArrayAsync(cancellationToken))
            .ToLookup(item => item.UserAccessRequestId,
                item => new GovernanceTerminalData(item.PublicId, item.Code, item.Station));
        var employeeIds = rows.Where(row => row.EmployeeId != null).Select(row => row.EmployeeId!.Value).ToArray();
        var employees = await context.Employees.AsNoTracking().Where(employee => employeeIds.Contains(employee.Id))
            .ToDictionaryAsync(employee => employee.Id, employee => employee.PublicId, cancellationToken);
        var supervisorIds = rows.Where(row => row.SupervisorRampAgentId != null)
            .Select(row => row.SupervisorRampAgentId!.Value).ToArray();
        var supervisors = await (from agent in context.RampAgents.AsNoTracking()
                                 join person in context.Persons.AsNoTracking() on agent.PersonId equals person.Id
                                 where supervisorIds.Contains(agent.Id)
                                 select new { agent.Id, agent.PublicId, Name = person.FirstName + " " + person.LastName })
            .ToDictionaryAsync(item => item.Id, cancellationToken);

        return rows.Select(row =>
        {
            var profile = row.AccessProfileId is { } profileId ? profiles[profileId] : null;
            var supervisor = row.SupervisorRampAgentId is { } supervisorId ? supervisors[supervisorId] : null;
            return new AccessRequestData(
                row.PublicId, KeyOf(row.Department), row.Kind.ToString(), row.Status.ToString(),
                accounts[row.RequestedByAccountId].Name, row.RequestedAt, row.FirstName, row.LastName, row.Email,
                row.AvatarMediaUrl, profile?.PublicId, profile?.Name,
                (profile is null ? grants[row.Id] : profileGrants[profile.Id]).Order(StringComparer.Ordinal).ToArray(),
                stations[row.Id].ToArray(), terminals[row.Id].ToArray(), row.EmployeeNumber, row.Category, row.HireDate,
                supervisor?.PublicId, supervisor?.Name, row.DecisionReason, row.DecidedAt,
                row.DecidedByAccountId is { } decidedBy ? accounts[decidedBy].Name : null,
                row.CreatedAccountId is { } created ? accounts[created].PublicId : null,
                GovernanceSupport.Version(row.RowVersion),
                row.EmployeeId is { } employeeId ? employees[employeeId] : null);
        }).ToArray();
    }

    public async Task<GovernanceResult> CancelRequestAsync(Guid actorId, Guid requestId, string expectedVersion,
        CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null) return GovernanceResult.Failed(GovernanceFailure.Forbidden);
        if (string.IsNullOrWhiteSpace(expectedVersion)) return GovernanceResult.Failed(GovernanceFailure.Invalid);
        return await InSerializableTransactionAsync(async () =>
        {
            var request = await context.UserAccessRequests.SingleOrDefaultAsync(item => item.PublicId == requestId,
                cancellationToken);
            if (request is null) return GovernanceResult.Failed(GovernanceFailure.NotFound, "not_found");
            if (!actor.IsSuper && (request.RequestedByAccountId != actor.Id || !actor.Administers(request.Department)))
                return GovernanceResult.Failed(GovernanceFailure.Forbidden);
            if (request.Status != UserAccessRequestStatus.Pending)
                return GovernanceResult.Failed(GovernanceFailure.Conflict, "access_request_closed");
            if (GovernanceSupport.Version(request.RowVersion) != expectedVersion)
                return GovernanceResult.Failed(GovernanceFailure.Conflict, "version_conflict");
            var now = timeProvider.GetUtcNow();
            request.Status = UserAccessRequestStatus.Cancelled;
            request.DecidedAt = now;
            request.DecidedByAccountId = actor.Id;
            request.UpdatedAt = now;
            GovernanceSupport.AddAudit(context, actor.Id, "governance.access_request.cancelled",
                "iam.user_access_requests", request.PublicId, null, [], now, request.Department,
                new AuditFieldChangeData("request.status", nameof(UserAccessRequestStatus.Pending), request.Status.ToString()));
            await NotifyRequestAsync(request, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return GovernanceResult.Success(request.PublicId);
        }, cancellationToken);
    }

    public async Task<GovernanceResult> RejectRequestAsync(Guid actorId, Guid requestId, DecideUserAccessInput input,
        CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !(actor.IsSuper || actor.CanValidate))
            return GovernanceResult.Failed(GovernanceFailure.Forbidden);
        if (input is null || string.IsNullOrWhiteSpace(input.ExpectedVersion))
            return GovernanceResult.Failed(GovernanceFailure.Invalid, "expected_version_required");
        if (string.IsNullOrWhiteSpace(input.Reason) || input.Reason.Trim().Length is < 3 or > 500)
            return GovernanceResult.Failed(GovernanceFailure.Invalid, "reason_required");
        return await InSerializableTransactionAsync(async () =>
        {
            var request = await context.UserAccessRequests.SingleOrDefaultAsync(item => item.PublicId == requestId,
                cancellationToken);
            if (request is null) return GovernanceResult.Failed(GovernanceFailure.NotFound, "not_found");
            if (!actor.IsSuper && request.RequestedByAccountId == actor.Id)
                return GovernanceResult.Failed(GovernanceFailure.Forbidden);
            if (request.Status != UserAccessRequestStatus.Pending)
                return GovernanceResult.Failed(GovernanceFailure.Conflict, "access_request_closed");
            if (GovernanceSupport.Version(request.RowVersion) != input.ExpectedVersion)
                return GovernanceResult.Failed(GovernanceFailure.Conflict, "version_conflict");
            var now = timeProvider.GetUtcNow();
            request.Status = UserAccessRequestStatus.Rejected;
            request.DecisionReason = input.Reason.Trim();
            request.DecidedAt = now;
            request.DecidedByAccountId = actor.Id;
            request.UpdatedAt = now;
            GovernanceSupport.AddAudit(context, actor.Id, "governance.access_request.rejected",
                "iam.user_access_requests", request.PublicId, request.DecisionReason, [], now, request.Department,
                new AuditFieldChangeData("request.status", nameof(UserAccessRequestStatus.Pending), request.Status.ToString()));
            await NotifyRequestAsync(request, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return GovernanceResult.Success(request.PublicId);
        }, cancellationToken);
    }

    /// <summary>
    /// Human Resources validates a request by choosing the temporary password. Web
    /// requests become department members; ramp-agent requests also create the
    /// operational profile with its stations and terminals. Repeating the validation
    /// by the same validator returns the account it already created.
    /// </summary>
    public async Task<GovernanceResult> ValidateRequestAsync(Guid actorId, Guid requestId, DecideUserAccessInput input,
        CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !(actor.IsSuper || actor.CanValidate))
            return GovernanceResult.Failed(GovernanceFailure.Forbidden);
        if (input is null || string.IsNullOrWhiteSpace(input.ExpectedVersion))
            return GovernanceResult.Failed(GovernanceFailure.Invalid, "expected_version_required");
        if (string.IsNullOrWhiteSpace(input.TemporaryPassword))
            return GovernanceResult.Failed(GovernanceFailure.Invalid, "password_policy");

        var replay = await context.UserAccessRequests.AsNoTracking()
            .SingleOrDefaultAsync(item => item.PublicId == requestId, cancellationToken);
        if (replay is null) return GovernanceResult.Failed(GovernanceFailure.NotFound, "not_found");
        if (replay.Status == UserAccessRequestStatus.Validated && replay.DecidedByAccountId == actor.Id)
            return GovernanceResult.Success(await context.Users.Where(user => user.Id == replay.CreatedAccountId)
                .Select(user => user.PublicId).SingleAsync(cancellationToken));
        if (!actor.IsSuper && replay.RequestedByAccountId == actor.Id)
            return GovernanceResult.Failed(GovernanceFailure.Forbidden);

        var outcome = await InSerializableTransactionAsync(async () =>
        {
            var request = await context.UserAccessRequests.SingleAsync(item => item.PublicId == requestId,
                cancellationToken);
            if (request.Status != UserAccessRequestStatus.Pending)
                return GovernanceResult.Failed(GovernanceFailure.Conflict, "access_request_closed");
            if (GovernanceSupport.Version(request.RowVersion) != input.ExpectedVersion)
                return GovernanceResult.Failed(GovernanceFailure.Conflict, "version_conflict");
            // 2-N33: a request stands while whoever asked for it still administers the department; the requests
            // of an administrator that was transferred, terminated or demoted are not validated.
            if (!await RequesterStillAdministersAsync(request, cancellationToken))
                return GovernanceResult.Failed(GovernanceFailure.Conflict, "requester_no_longer_administrator");
            var now = timeProvider.GetUtcNow();
            var today = BusinessCalendar.Today(now);
            // 2-N17: a photo the media cleanup removed before this change is left out; the account is still issued.
            var avatar = await ExistingAvatarAsync(request.AvatarMediaUrl, cancellationToken);
            long[] stations;
            ApplicationUser? account;
            if (request.EmployeeId is not null)
            {
                var (issued, employeeStations, failure) = await ValidateEmployeeRequestAsync(request,
                    input.TemporaryPassword!, now, cancellationToken);
                if (failure is not null) return failure;
                account = issued;
                stations = employeeStations;
            }
            else
            {
            if (await EmailInUseAsync(request.Email, null, cancellationToken))
                return GovernanceResult.Failed(GovernanceFailure.Conflict, "email_in_use");
            stations = await context.UserAccessRequestStations.Where(item => item.UserAccessRequestId == request.Id)
                .Join(context.Stations.Where(station => station.IsActive), item => item.StationId, station => station.Id,
                    (item, station) => station.Id)
                .ToArrayAsync(cancellationToken);
            if (stations.Length == 0) return GovernanceResult.Failed(GovernanceFailure.Conflict, "stations_invalid");

            if (request.Kind == UserAccessRequestKind.RampAgent)
            {
                if (await context.RampAgents.AnyAsync(agent => agent.EmployeeNumber == request.EmployeeNumber,
                        cancellationToken))
                    return GovernanceResult.Failed(GovernanceFailure.Conflict, "employee_number_in_use");
                var person = new Person
                {
                    PublicId = Guid.CreateVersion7(), CreatedAt = now, UpdatedAt = now,
                    FirstName = request.FirstName, LastName = request.LastName, PrimaryEmail = request.Email,
                    AvatarMediaUrl = avatar,
                    IdentificationType = "RAMP_EMPLOYEE",
                    IdentificationNumber = Guid.CreateVersion7().ToString("N"),
                };
                context.Persons.Add(person);
                await context.SaveChangesAsync(cancellationToken);
                var agent = new RampAgent
                {
                    PublicId = Guid.CreateVersion7(), CreatedAt = now, UpdatedAt = now, PersonId = person.Id,
                    EmployeeNumber = request.EmployeeNumber!, Category = request.Category!,
                    HireDate = request.HireDate!.Value, SupervisorAgentId = request.SupervisorRampAgentId, IsActive = true,
                };
                context.RampAgents.Add(agent);
                await context.SaveChangesAsync(cancellationToken);
                foreach (var station in stations)
                    context.Set<RampAgentStationScope>().Add(new RampAgentStationScope
                    { RampAgentId = agent.Id, StationId = station, ValidFrom = today });
                var terminals = await context.UserAccessRequestTerminals
                    .Where(item => item.UserAccessRequestId == request.Id)
                    .Join(context.Terminals.Where(terminal => terminal.IsActive && stations.Contains(terminal.StationId)),
                        item => item.TerminalId, terminal => terminal.Id, (item, terminal) => terminal.Id)
                    .ToArrayAsync(cancellationToken);
                foreach (var terminal in terminals)
                    context.Set<RampAgentTerminalScope>().Add(new RampAgentTerminalScope
                    { RampAgentId = agent.Id, TerminalId = terminal, ValidFrom = today });
                account = await CreateAccountAsync(person.Id, request.Email, input.TemporaryPassword!, "RAMP_AGENT",
                    Department.Operations, DepartmentAssignmentKind.Member, stations, new GrantSelection(null, []), now,
                    cancellationToken);
            }
            else
            {
                GrantSelection grants;
                if (request.AccessProfileId is { } profileId)
                {
                    if (!await context.AccessProfiles.AnyAsync(profile => profile.Id == profileId && profile.IsActive,
                            cancellationToken))
                        return GovernanceResult.Failed(GovernanceFailure.Conflict, "profile_inactive");
                    grants = new GrantSelection(profileId, []);
                }
                else
                {
                    var codes = await context.UserAccessRequestGrants.Where(item => item.UserAccessRequestId == request.Id)
                        .Select(item => item.PermissionCode).ToArrayAsync(cancellationToken);
                    if (codes.Length == 0 || codes.Any(code => !DepartmentPermissionCatalog.Belongs(code, request.Department)))
                        return GovernanceResult.Failed(GovernanceFailure.Conflict, "permissions_invalid");
                    grants = new GrantSelection(null, codes);
                }
                account = await CreateBackOfficeAccountAsync(request.Department, DepartmentAssignmentKind.Member,
                    request.FirstName, request.LastName, request.Email, avatar, input.TemporaryPassword!,
                    stations, grants, now, cancellationToken);
            }
            }
            if (account is null) return GovernanceResult.Failed(GovernanceFailure.Invalid, "password_policy");

            request.Status = UserAccessRequestStatus.Validated;
            request.DecidedAt = now;
            request.DecidedByAccountId = actor.Id;
            request.CreatedAccountId = account.Id;
            request.UpdatedAt = now;
            GovernanceSupport.AddAudit(context, actor.Id, "governance.access_request.validated",
                "iam.user_access_requests", request.PublicId, null, stations.Select(station => (long?)station).ToArray(), now,
                request.Department, new AuditFieldChangeData("request.status", nameof(UserAccessRequestStatus.Pending), request.Status.ToString()));
            GovernanceSupport.AddAudit(context, actor.Id, "governance.department_user.created", "iam.accounts",
                account.PublicId, null, stations.Select(station => (long?)station).ToArray(), now,
                request.Department, new AuditFieldChangeData("department", null, KeyOf(request.Department)), new AuditFieldChangeData("kind", null, request.Kind.ToString()));
            await NotifyRequestAsync(request, now, cancellationToken);
            await NotifyDepartmentAsync(request.Department, "department_users", account.PublicId, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return GovernanceResult.Success(account.PublicId);
        }, cancellationToken);

        if (outcome.Failure is GovernanceFailure.Conflict)
        {
            var persisted = await context.UserAccessRequests.AsNoTracking()
                .SingleAsync(item => item.PublicId == requestId, cancellationToken);
            if (persisted.Status == UserAccessRequestStatus.Validated && persisted.DecidedByAccountId == actor.Id)
                return GovernanceResult.Success(await context.Users.Where(user => user.Id == persisted.CreatedAccountId)
                    .Select(user => user.PublicId).SingleAsync(cancellationToken));
        }
        return outcome;
    }

    /// <summary>The requester is still an active administrator of the request's department (2-N33).</summary>
    private async Task<bool> RequesterStillAdministersAsync(UserAccessRequest request, CancellationToken cancellationToken)
    {
        if (!await context.Users.AnyAsync(user => user.Id == request.RequestedByAccountId &&
                user.Status == AccountLifecycleStatus.Active, cancellationToken))
            return false;
        var access = await DepartmentAccessQueries.ReadAsync(context, request.RequestedByAccountId, cancellationToken);
        return access?.Administers(request.Department) == true;
    }

    /// <summary>
    /// The avatar URL while its media still exists: the cleanup keeps the photo of a pending request (2-N17), but a
    /// request older than that rule may have lost it. Null otherwise.
    /// </summary>
    private async Task<string?> ExistingAvatarAsync(string? url, CancellationToken cancellationToken)
    {
        const string prefix = "/api/v1/media/";
        if (url is null || !url.StartsWith(prefix, StringComparison.Ordinal) || !Guid.TryParse(url[prefix.Length..], out var id))
            return null;
        return await context.MediaAssets.AnyAsync(asset => asset.PublicId == id && asset.Purpose == "avatar",
            cancellationToken) ? url : null;
    }

    /// <summary>Requester, department administrators, validators and the super administrator re-read the request.</summary>
    private async Task NotifyRequestAsync(UserAccessRequest request, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        await NotifyDepartmentAsync(request.Department, "access_requests", request.PublicId, now, cancellationToken,
            includeValidators: true, alsoNotify: request.RequestedByAccountId);
    }
}
