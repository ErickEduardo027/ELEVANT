using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Domain.Governance;
using Elevant.Infrastructure.Identity;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

/// <summary>Job positions, personnel requisitions and access candidates (ADR-0017).</summary>
internal sealed partial class EfDepartmentGovernanceStore
{
    private const string PositionsRead = "human_resources.positions.read";
    private const string PositionsManage = "human_resources.positions.manage";
    private const string RequisitionsRead = "human_resources.requisitions.read";
    private const string RequisitionsAttend = "human_resources.requisitions.attend";

    private async Task<IReadOnlyList<JobPositionData>> PositionsAsync(Department? department, bool activeOnly,
        CancellationToken cancellationToken)
    {
        var rows = await (from position in context.JobPositions.AsNoTracking()
                          where (department == null || position.Department == department) && (!activeOnly || position.IsActive)
                          orderby position.Department, position.Name
                          select new
                          {
                              Position = position,
                              Profile = context.AccessProfiles.Where(profile => profile.Id == position.SuggestedAccessProfileId)
                                  .Select(profile => new { profile.PublicId, profile.Name }).FirstOrDefault(),
                              Employees = context.Employees.Count(employee =>
                                  employee.JobPositionId == position.Id && employee.Status == EmployeeStatus.Active),
                          }).ToArrayAsync(cancellationToken);
        return rows.Select(row => new JobPositionData(row.Position.PublicId, KeyOf(row.Position.Department),
            row.Position.Name, row.Position.Description, row.Position.IsRampPosition, row.Position.IsActive,
            row.Profile?.PublicId, row.Profile?.Name, row.Employees, GovernanceSupport.Version(row.Position.RowVersion)))
            .ToArray();
    }

    /// <summary>Human Resources reads every position; a department administrator reads its own.</summary>
    public async Task<IReadOnlyList<JobPositionData>?> ListPositionsAsync(Guid actorId, string? department,
        CancellationToken cancellationToken = default)
    {
        Department? parsed = null;
        if (department is not null)
        {
            if (!TryParse(department, out var value)) return null;
            parsed = value;
        }
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null) return null;
        if (!actor.Can(PositionsRead) && !(parsed is { } own && actor.Administers(own))) return null;
        return await PositionsAsync(parsed, activeOnly: false, cancellationToken);
    }

    public async Task<GovernanceResult> SavePositionAsync(Guid actorId, Guid? positionId, SaveJobPositionInput input,
        CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !actor.Can(PositionsManage)) return GovernanceResult.Failed(GovernanceFailure.Forbidden);
        if (input is null || !TryParse(input.Department, out var department) ||
            input.Name?.Trim().Length is not (>= 3 and <= 120) || input.Description?.Trim().Length > 500 ||
            positionId is not null && string.IsNullOrWhiteSpace(input.ExpectedVersion))
            return GovernanceResult.Failed(GovernanceFailure.Invalid);
        if (input.IsRampPosition && department != Department.Operations)
            return GovernanceResult.Failed(GovernanceFailure.Invalid, "ramp_position_outside_operations");
        var name = input.Name!.Trim();
        var description = string.IsNullOrWhiteSpace(input.Description) ? null : input.Description.Trim();

        return await InSerializableTransactionAsync(async () =>
        {
            if (await context.JobPositions.AnyAsync(position => position.Department == department && position.Name == name &&
                    position.PublicId != positionId, cancellationToken))
                return GovernanceResult.Failed(GovernanceFailure.Conflict, "position_name_in_use");
            var now = timeProvider.GetUtcNow();
            JobPosition position;
            if (positionId is { } id)
            {
                var found = await context.JobPositions.SingleOrDefaultAsync(item => item.PublicId == id, cancellationToken);
                if (found is null) return GovernanceResult.Failed(GovernanceFailure.NotFound);
                position = found;
                if (GovernanceSupport.Version(position.RowVersion) != input.ExpectedVersion)
                    return GovernanceResult.Failed(GovernanceFailure.Conflict);
                if (position.Department != department)
                    return GovernanceResult.Failed(GovernanceFailure.Invalid, "position_department_fixed");
                // A position with people stays what it is; ramp duties hang on the flag.
                if (position.IsRampPosition != input.IsRampPosition && await context.Employees.AnyAsync(employee =>
                        employee.JobPositionId == position.Id && employee.Status == EmployeeStatus.Active, cancellationToken))
                    return GovernanceResult.Failed(GovernanceFailure.Conflict, "position_in_use");
                GovernanceSupport.AddAudit(context, actor.Id, "hr.position.updated", "hr.job_positions", position.PublicId,
                    null, [], now, department,
                    new AuditFieldChangeData("position.name", position.Name, name),
                    new AuditFieldChangeData("position.active", position.IsActive.ToString(), input.IsActive.ToString()));
                position.Name = name;
                position.Description = description;
                position.IsRampPosition = input.IsRampPosition;
                position.IsActive = input.IsActive;
                position.UpdatedAt = now;
            }
            else
            {
                position = new JobPosition
                {
                    PublicId = Guid.CreateVersion7(), CreatedAt = now, UpdatedAt = now, Department = department, Name = name,
                    Description = description, IsRampPosition = input.IsRampPosition, IsActive = input.IsActive,
                    CreatedByAccountId = actor.Id,
                };
                context.JobPositions.Add(position);
                GovernanceSupport.AddAudit(context, actor.Id, "hr.position.created", "hr.job_positions", position.PublicId,
                    null, [], now, department, new AuditFieldChangeData("position.name", null, name));
            }
            await NotifyPositionsAsync(department, position.PublicId, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return GovernanceResult.Success(position.PublicId);
        }, cancellationToken);
    }

    /// <summary>The department picks which of its access profiles a position starts with.</summary>
    public async Task<GovernanceResult> SetSuggestedProfileAsync(Guid actorId, string department, Guid positionId,
        SetSuggestedProfileInput input, CancellationToken cancellationToken = default)
    {
        if (!TryParse(department, out var parsed)) return GovernanceResult.Failed(GovernanceFailure.NotFound);
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !actor.Administers(parsed)) return GovernanceResult.Failed(GovernanceFailure.Forbidden);
        if (input is null || string.IsNullOrWhiteSpace(input.ExpectedVersion))
            return GovernanceResult.Failed(GovernanceFailure.Invalid);
        long? profileId = null;
        if (input.AccessProfileId is { } profilePublicId)
        {
            profileId = await context.AccessProfiles.AsNoTracking().Where(profile =>
                    profile.PublicId == profilePublicId && profile.Department == parsed && profile.IsActive)
                .Select(profile => (long?)profile.Id).SingleOrDefaultAsync(cancellationToken);
            if (profileId is null) return GovernanceResult.Failed(GovernanceFailure.Invalid, "profile_invalid");
        }

        return await InSerializableTransactionAsync(async () =>
        {
            var position = await context.JobPositions.SingleOrDefaultAsync(item =>
                item.PublicId == positionId && item.Department == parsed, cancellationToken);
            if (position is null) return GovernanceResult.Failed(GovernanceFailure.NotFound);
            if (GovernanceSupport.Version(position.RowVersion) != input.ExpectedVersion)
                return GovernanceResult.Failed(GovernanceFailure.Conflict);
            if (position.IsRampPosition && profileId is not null)
                return GovernanceResult.Failed(GovernanceFailure.Invalid, "ramp_position_has_no_profile");
            var now = timeProvider.GetUtcNow();
            position.SuggestedAccessProfileId = profileId;
            position.UpdatedAt = now;
            GovernanceSupport.AddAudit(context, actor.Id, "governance.position.suggested_profile_set", "hr.job_positions",
                position.PublicId, null, [], now, parsed,
                new AuditFieldChangeData("position.suggested_profile", null, input.AccessProfileId?.ToString()));
            await NotifyPositionsAsync(parsed, position.PublicId, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return GovernanceResult.Success(position.PublicId);
        }, cancellationToken);
    }

    private async Task NotifyPositionsAsync(Department department, Guid positionId, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var accounts = await DepartmentAccessQueries.ActiveInternalAccounts(context).ToArrayAsync(cancellationToken);
        var accesses = await DepartmentAccessQueries.ReadManyAsync(context, accounts, cancellationToken);
        foreach (var (accountId, access) in accesses)
            if (access.Has(PositionsRead) || access.Administers(department))
                AccountChangeOutboxWriter.Add(context, accountId, null, "positions", positionId, now);
    }

    private async Task<IReadOnlyList<RequisitionData>> RequisitionsAsync(Department? department,
        IReadOnlyList<RequisitionStatus>? statuses, CancellationToken cancellationToken)
    {
        var rows = await context.PersonnelRequisitions.AsNoTracking()
            .Where(item => department == null || item.Department == department)
            .Where(item => statuses == null || statuses.Contains(item.Status))
            .OrderBy(item => item.Status == RequisitionStatus.Open ? 0 : item.Status == RequisitionStatus.InProgress ? 1 : 2)
            .ThenByDescending(item => item.RequestedAt)
            .Take(200)
            .ToArrayAsync(cancellationToken);
        var ids = rows.Select(row => row.Id).ToArray();
        var positionIds = rows.Select(row => row.JobPositionId).Distinct().ToArray();
        var positions = await context.JobPositions.AsNoTracking().Where(position => positionIds.Contains(position.Id))
            .ToDictionaryAsync(position => position.Id, cancellationToken);
        var stationIds = rows.Where(row => row.StationId != null).Select(row => row.StationId!.Value).Distinct().ToArray();
        var stations = await context.Stations.AsNoTracking().Where(station => stationIds.Contains(station.Id))
            .ToDictionaryAsync(station => station.Id, cancellationToken);
        var accountIds = rows.Select(row => row.RequestedByAccountId)
            .Concat(rows.Where(row => row.AttendedByAccountId != null).Select(row => row.AttendedByAccountId!.Value))
            .Concat(rows.Where(row => row.ClosedByAccountId != null).Select(row => row.ClosedByAccountId!.Value))
            .Distinct().ToArray();
        var names = await (from user in context.Users.AsNoTracking()
                           join person in context.Persons.AsNoTracking() on user.PersonId equals person.Id
                           where accountIds.Contains(user.Id)
                           select new { user.Id, Name = person.FirstName + " " + person.LastName })
            .ToDictionaryAsync(item => item.Id, item => item.Name, cancellationToken);
        var hires = (await (from employee in context.Employees.AsNoTracking()
                            join person in context.Persons.AsNoTracking() on employee.PersonId equals person.Id
                            where employee.RequisitionId != null && ids.Contains(employee.RequisitionId.Value)
                            select new { employee.RequisitionId, employee.PublicId, employee.EmployeeNumber,
                                Name = person.FirstName + " " + person.LastName }).ToArrayAsync(cancellationToken))
            .ToLookup(item => item.RequisitionId!.Value,
                item => new RequisitionEmployeeData(item.PublicId, item.Name, item.EmployeeNumber));
        return rows.Select(row =>
        {
            var position = positions[row.JobPositionId];
            var station = row.StationId is { } stationId ? stations[stationId] : null;
            var employees = hires[row.Id].ToArray();
            return new RequisitionData(row.PublicId, KeyOf(row.Department),
                new JobPositionRefData(position.PublicId, position.Name, position.IsRampPosition), row.Quantity,
                employees.Length, row.Reason, station is null ? null : new GovernanceStationData(station.PublicId, station.Code),
                row.DesiredStartOn, row.Status.ToString(), names[row.RequestedByAccountId], row.RequestedAt,
                row.AttendedByAccountId is { } attended ? names[attended] : null,
                row.ClosedByAccountId is { } closed ? names[closed] : null, row.ClosedAt, row.ClosureReason, employees,
                GovernanceSupport.Version(row.RowVersion));
        }).ToArray();
    }

    /// <summary>Human Resources reads every requisition; a department administrator reads its own.</summary>
    public async Task<IReadOnlyList<RequisitionData>?> ListRequisitionsAsync(Guid actorId, string? department,
        string? status, CancellationToken cancellationToken = default)
    {
        Department? parsed = null;
        if (department is not null)
        {
            if (!TryParse(department, out var value)) return null;
            parsed = value;
        }
        RequisitionStatus[]? statuses = null;
        if (status is not null)
        {
            if (!Enum.TryParse<RequisitionStatus>(status, false, out var value)) return null;
            statuses = [value];
        }
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null) return null;
        if (!actor.Can(RequisitionsRead) && !(parsed is { } own && actor.Administers(own))) return null;
        return await RequisitionsAsync(parsed, statuses, cancellationToken);
    }

    public async Task<GovernanceResult> CreateRequisitionAsync(Guid actorId, string department,
        CreateRequisitionInput input, CancellationToken cancellationToken = default)
    {
        if (!TryParse(department, out var parsed)) return GovernanceResult.Failed(GovernanceFailure.NotFound);
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !actor.Administers(parsed)) return GovernanceResult.Failed(GovernanceFailure.Forbidden);
        var today = DateOnly.FromDateTime(timeProvider.GetUtcNow().UtcDateTime);
        if (input is null || input.RequestId == Guid.Empty || input.Quantity is < 1 or > 50 ||
            input.Reason?.Trim().Length is not (>= 3 and <= 1000) || input.DesiredStartOn < today)
            return GovernanceResult.Failed(GovernanceFailure.Invalid);
        var prior = await context.PersonnelRequisitions.AsNoTracking()
            .SingleOrDefaultAsync(item => item.PublicId == input.RequestId, cancellationToken);
        if (prior is not null)
            return prior.RequestedByAccountId == actor.Id && prior.Department == parsed
                ? GovernanceResult.Success(prior.PublicId)
                : GovernanceResult.Failed(GovernanceFailure.Conflict);
        var position = await context.JobPositions.AsNoTracking().SingleOrDefaultAsync(item =>
            item.PublicId == input.PositionId && item.Department == parsed && item.IsActive, cancellationToken);
        if (position is null) return GovernanceResult.Failed(GovernanceFailure.Invalid, "position_invalid");
        long? stationId = null;
        if (input.StationId is { } stationPublicId)
        {
            var stations = await ResolveStationsAsync(actor, [stationPublicId], cancellationToken);
            if (stations is null) return GovernanceResult.Failed(GovernanceFailure.Invalid, "stations_invalid");
            stationId = stations[0];
        }

        return await InSerializableTransactionAsync(async () =>
        {
            var now = timeProvider.GetUtcNow();
            var requisition = new PersonnelRequisition
            {
                PublicId = input.RequestId, CreatedAt = now, UpdatedAt = now, Department = parsed,
                JobPositionId = position.Id, Quantity = input.Quantity, Reason = input.Reason!.Trim(),
                StationId = stationId, DesiredStartOn = input.DesiredStartOn, Status = RequisitionStatus.Open,
                RequestedByAccountId = actor.Id, RequestedAt = now,
            };
            context.PersonnelRequisitions.Add(requisition);
            GovernanceSupport.AddAudit(context, actor.Id, "hr.requisition.created", "hr.personnel_requisitions",
                requisition.PublicId, requisition.Reason, stationId is null ? [] : [stationId], now, parsed,
                new AuditFieldChangeData("requisition.position", null, position.Name),
                new AuditFieldChangeData("requisition.quantity", null, input.Quantity.ToString(System.Globalization.CultureInfo.InvariantCulture)));
            await NotifyRequisitionsAsync(parsed, requisition.PublicId, requisition.RequestedByAccountId, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return GovernanceResult.Success(requisition.PublicId);
        }, cancellationToken);
    }

    /// <summary>
    /// Human Resources attends, fulfils or rejects a requisition; only the requesting department
    /// (or the super administrator) cancels it. Closing it needs a reason when it is not fulfilled.
    /// </summary>
    public async Task<GovernanceResult> ChangeRequisitionStatusAsync(Guid actorId, Guid requisitionId,
        ChangeRequisitionStatusInput input, CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null) return GovernanceResult.Failed(GovernanceFailure.Forbidden);
        if (input is null || string.IsNullOrWhiteSpace(input.ExpectedVersion) ||
            !Enum.TryParse<RequisitionStatus>(input.Status, false, out var target))
            return GovernanceResult.Failed(GovernanceFailure.Invalid);
        var reason = string.IsNullOrWhiteSpace(input.Reason) ? null : input.Reason.Trim();
        if (RequisitionTransitions.RequiresReason(target) && reason?.Length is not (>= 3 and <= 500) || reason?.Length > 500)
            return GovernanceResult.Failed(GovernanceFailure.Invalid, "reason_required");

        return await InSerializableTransactionAsync(async () =>
        {
            var requisition = await context.PersonnelRequisitions.SingleOrDefaultAsync(item =>
                item.PublicId == requisitionId, cancellationToken);
            if (requisition is null) return GovernanceResult.Failed(GovernanceFailure.NotFound);
            var allowed = target == RequisitionStatus.Cancelled
                ? actor.IsSuper || actor.Administers(requisition.Department)
                : actor.Can(RequisitionsAttend);
            if (!allowed) return GovernanceResult.Failed(GovernanceFailure.Forbidden);
            if (GovernanceSupport.Version(requisition.RowVersion) != input.ExpectedVersion ||
                !RequisitionTransitions.CanMove(requisition.Status, target))
                return GovernanceResult.Failed(GovernanceFailure.Conflict);
            var now = timeProvider.GetUtcNow();
            var before = requisition.Status;
            requisition.Status = target;
            requisition.UpdatedAt = now;
            if (target == RequisitionStatus.InProgress) requisition.AttendedByAccountId = actor.Id;
            if (RequisitionTransitions.IsClosed(target))
            {
                requisition.ClosedAt = now;
                requisition.ClosedByAccountId = actor.Id;
                requisition.ClosureReason = reason;
                if (target == RequisitionStatus.Fulfilled) requisition.AttendedByAccountId ??= actor.Id;
            }
            GovernanceSupport.AddAudit(context, actor.Id, "hr.requisition.status_changed", "hr.personnel_requisitions",
                requisition.PublicId, reason, requisition.StationId is { } station ? [station] : [], now, requisition.Department,
                new AuditFieldChangeData("requisition.status", before.ToString(), target.ToString()));
            await NotifyRequisitionsAsync(requisition.Department, requisition.PublicId, requisition.RequestedByAccountId,
                now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return GovernanceResult.Success(requisition.PublicId);
        }, cancellationToken);
    }

    private async Task NotifyRequisitionsAsync(Department department, Guid requisitionId, long requester,
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        var accounts = await DepartmentAccessQueries.ActiveInternalAccounts(context).ToArrayAsync(cancellationToken);
        var accesses = await DepartmentAccessQueries.ReadManyAsync(context, accounts, cancellationToken);
        var notified = new HashSet<long>();
        foreach (var (accountId, access) in accesses)
            if ((access.Has(RequisitionsRead) || access.Administers(department)) && notified.Add(accountId))
                AccountChangeOutboxWriter.Add(context, accountId, null, "requisitions", requisitionId, now);
        if (notified.Add(requester))
            AccountChangeOutboxWriter.Add(context, requester, null, "requisitions", requisitionId, now);
    }

    /// <summary>
    /// Active employees of the department that can be given access: no active account and no
    /// pending request. Identification numbers never leave Human Resources.
    /// </summary>
    public async Task<IReadOnlyList<AccessCandidateData>?> ListAccessCandidatesAsync(Guid actorId, string department,
        string? search, CancellationToken cancellationToken = default)
    {
        if (!TryParse(department, out var parsed)) return null;
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !actor.Administers(parsed)) return null;
        var term = search?.Trim();
        var rows = await (
            from employee in context.Employees.AsNoTracking()
            join person in context.Persons.AsNoTracking() on employee.PersonId equals person.Id
            join position in context.JobPositions.AsNoTracking() on employee.JobPositionId equals position.Id
            where employee.Department == parsed && employee.Status == EmployeeStatus.Active &&
                  !context.Users.Any(user => user.PersonId == person.Id && user.Status == AccountLifecycleStatus.Active) &&
                  !context.UserAccessRequests.Any(request => request.EmployeeId == employee.Id &&
                      request.Status == UserAccessRequestStatus.Pending) &&
                  (string.IsNullOrEmpty(term) || (person.FirstName + " " + person.LastName).Contains(term) ||
                      employee.EmployeeNumber.Contains(term))
            orderby person.LastName, person.FirstName
            select new
            {
                employee.Id, employee.PublicId, person.FirstName, person.LastName, employee.EmployeeNumber,
                Position = position, person.PrimaryEmail,
                AccountStatus = context.Users.Where(user => user.PersonId == person.Id)
                    .Select(user => (AccountLifecycleStatus?)user.Status).FirstOrDefault(),
                SuggestedProfile = context.AccessProfiles.Where(profile =>
                        profile.Id == position.SuggestedAccessProfileId && profile.IsActive)
                    .Select(profile => (Guid?)profile.PublicId).FirstOrDefault(),
            }).Take(200).ToArrayAsync(cancellationToken);
        var ids = rows.Select(row => row.Id).ToArray();
        var stations = (await (from link in context.EmployeeStations.AsNoTracking()
                               join station in context.Stations.AsNoTracking() on link.StationId equals station.Id
                               where ids.Contains(link.EmployeeId) && link.ValidTo == null && station.IsActive
                               orderby station.Code
                               select new { link.EmployeeId, station.PublicId, station.Code }).ToArrayAsync(cancellationToken))
            .ToLookup(item => item.EmployeeId, item => new GovernanceStationData(item.PublicId, item.Code));
        return rows.Select(row => new AccessCandidateData(row.PublicId, row.FirstName, row.LastName, row.EmployeeNumber,
            new JobPositionRefData(row.Position.PublicId, row.Position.Name, row.Position.IsRampPosition),
            row.SuggestedProfile, stations[row.Id].Where(station => actor.IsSuper || actor.StationIds.Contains(station.Id)).ToArray(),
            row.PrimaryEmail, row.AccountStatus?.ToString())).ToArray();
    }
}
