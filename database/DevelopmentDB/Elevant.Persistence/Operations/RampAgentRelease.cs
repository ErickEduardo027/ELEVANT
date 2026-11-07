using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Common;
using Elevant.Application.Identity;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Audit;
using Elevant.Persistence.Integration;
using Elevant.Persistence.Realtime;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>
/// The one path that takes work off a ramp agent (2-N06, 2-N08), inside the transaction of the command that
/// causes it: a termination, a transfer out of the ramp, a move to an office position, a deactivated ramp profile
/// (<see cref="EndRampDutyAsync"/>) or an approved absence (<see cref="ReleaseAbsenceAsync"/>). It releases the
/// agent's open coverages (as the agent or as the mentor), the assignments of the operations the agent has not
/// started (an assigned operation left without agents goes back to Planned) and removes the shifts that have not
/// started, each one audited. OCC hears it on the planning board (<c>occ_planning</c>) and with an
/// <see cref="ReleasedKind"/> notice per operation; the agent's tablet with <c>assignment_released</c>.
/// An operation in progress or returned for correction keeps the agent: nothing changes and the command fails
/// with <see cref="OperationInProgressCode"/>. The caller saves and commits.
/// Phase 3 (block B) takes the same path for one operation: OCC's release of an agent and the stand reassignment
/// (<see cref="ReleaseOperationAsync"/>), the handover and the reassignment to the agent who covers the new stand
/// (<see cref="ReplaceAgentAsync"/>), and the approval, which frees the agent and the stand by status without closing
/// the assignment of record (<see cref="ReleaseOnApprovalAsync"/>).
/// </summary>
internal static class RampAgentRelease
{
    /// <summary>Problem Details code when an operation in progress or returned keeps the agent.</summary>
    public const string OperationInProgressCode = "agent_has_operation_in_progress";

    /// <summary>Operational notice to OCC for each operation that lost the agent (ADMIN_OCC only, never the tablet).</summary>
    public const string ReleasedKind = "agent_released";

    /// <summary>Why the agent stops working the released hours; the audit trail says it.</summary>
    public enum Cause { Termination, Transfer, OfficePosition, ProfileDeactivated, Absence }

    /// <summary>What was released; <paramref name="Blocked"/> means nothing was.</summary>
    public sealed record Outcome(bool Blocked, int Coverages, int Operations, int Shifts);

    private sealed record Days(DateOnly From, DateOnly To);

    private sealed record OperationRow(OperationAgentAssignment Assignment, GroundOperation Operation, long StationId,
        DateOnly OperationDate, long AirlineId);

    private sealed record ShiftRow(ShiftAssignment Shift, DateTimeOffset Start, DateTimeOffset End);

    /// <summary>
    /// The end of the agent's ramp duty: everything from now on is released, the agent becomes inactive and,
    /// unless the caller manages them (<paramref name="closeScopes"/> false), the station and terminal scopes end
    /// today in each station's calendar (2-N31). This is the single place every way out of the ramp goes
    /// through, so whatever else ends with the duty (the agent's tablets, 2-N02) joins here.
    /// </summary>
    public static async Task<Outcome> EndRampDutyAsync(ElevantDbContext context, long rampAgentId, long actorAccountId,
        Cause cause, DateTimeOffset now, CancellationToken cancellationToken, bool closeScopes = true)
    {
        var outcome = await ReleaseAsync(context, rampAgentId, null, actorAccountId, cause, now, cancellationToken);
        if (outcome.Blocked) return outcome;
        var agent = await context.RampAgents.SingleAsync(item => item.Id == rampAgentId, cancellationToken);
        agent.IsActive = false;
        agent.UpdatedAt = now;
        // 2-N02: the tablets the agent holds are free for the next agent; an inactive agent never binds again.
        foreach (var account in await context.Users.Where(user => user.PersonId == agent.PersonId).Select(user => user.Id)
                     .ToArrayAsync(cancellationToken))
            await MobileDeviceBindings.CloseForAccountAsync(context, account, actorAccountId, Label(cause), now,
                cancellationToken);
        if (!closeScopes) return outcome;
        var stationScopes = await context.Set<RampAgentStationScope>()
            .Where(scope => scope.RampAgentId == rampAgentId && scope.ValidTo == null).ToArrayAsync(cancellationToken);
        var terminalScopes = await (from scope in context.Set<RampAgentTerminalScope>()
                                    join terminal in context.Terminals on scope.TerminalId equals terminal.Id
                                    where scope.RampAgentId == rampAgentId && scope.ValidTo == null
                                    select new { Scope = scope, terminal.StationId }).ToArrayAsync(cancellationToken);
        var zones = await ZonesAsync(context, stationScopes.Select(scope => scope.StationId)
            .Concat(terminalScopes.Select(row => row.StationId)), cancellationToken);
        foreach (var scope in stationScopes)
            scope.ValidTo = Closing(scope.ValidFrom, BusinessCalendar.Today(now, zones.GetValueOrDefault(scope.StationId)));
        foreach (var row in terminalScopes)
            row.Scope.ValidTo = Closing(row.Scope.ValidFrom, BusinessCalendar.Today(now, zones.GetValueOrDefault(row.StationId)));
        return outcome;
    }

    /// <summary>
    /// An approved day off or restriction from <paramref name="startsOn"/> to <paramref name="endsOn"/>: what the
    /// agent had in those days is released (<see cref="RampAgentReleaseRules.AbsenceWindow"/>), and the agent stays
    /// active.
    /// </summary>
    public static Task<Outcome> ReleaseAbsenceAsync(ElevantDbContext context, long rampAgentId, DateOnly startsOn,
        DateOnly endsOn, long actorAccountId, DateTimeOffset now, CancellationToken cancellationToken) =>
        ReleaseAsync(context, rampAgentId, new Days(startsOn, endsOn), actorAccountId, Cause.Absence, now,
            cancellationToken);

    private static async Task<Outcome> ReleaseAsync(ElevantDbContext context, long agentId, Days? days,
        long actorAccountId, Cause cause, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var shiftsFrom = (days?.From ?? BusinessCalendar.Today(now)).AddDays(-1);
        var shiftQuery = context.ShiftAssignments.Where(shift => shift.RampAgentId == agentId && shift.WorkDate >= shiftsFrom);
        if (days is not null) shiftQuery = shiftQuery.Where(shift => shift.WorkDate <= days.To);
        var shifts = await shiftQuery.ToArrayAsync(cancellationToken);

        // Absences look one day around their dates (night shifts); the instants decide below.
        DateOnly? firstDate = days?.From.AddDays(-1);
        DateOnly? lastDate = days?.To.AddDays(1);
        var operations = (await (
                from assignment in context.OperationAgentAssignments
                join operation in context.GroundOperations on assignment.GroundOperationId equals operation.Id
                join turnaround in context.Turnarounds on operation.TurnaroundId equals turnaround.Id
                where assignment.RampAgentId == agentId && assignment.ReleasedAt == null &&
                      (operation.CurrentStatus == GroundOperationStatus.Planned ||
                       operation.CurrentStatus == GroundOperationStatus.Assigned ||
                       operation.CurrentStatus == GroundOperationStatus.InProgress ||
                       operation.CurrentStatus == GroundOperationStatus.Returned) &&
                      (firstDate == null || turnaround.OperationDate >= firstDate.Value) &&
                      (lastDate == null || turnaround.OperationDate <= lastDate.Value)
                select new { Assignment = assignment, Operation = operation, turnaround.StationId, turnaround.OperationDate,
                    turnaround.AirlineId })
            .ToArrayAsync(cancellationToken))
            .Select(row => new OperationRow(row.Assignment, row.Operation, row.StationId, row.OperationDate, row.AirlineId))
            .ToArray();

        var coverages = await context.Set<PositionCoverage>()
            .Where(coverage => coverage.ReleasedAt == null && coverage.EndsAt > now &&
                (coverage.RampAgentId == agentId || coverage.MentorRampAgentId == agentId))
            .ToArrayAsync(cancellationToken);

        var zones = await ZonesAsync(context, shifts.Select(shift => shift.StationId)
            .Concat(operations.Select(row => row.StationId)).Concat(coverages.Select(coverage => coverage.StationId)),
            cancellationToken);
        var shiftRows = shifts.Select(shift =>
        {
            var (start, end) = RampAgentReleaseRules.ShiftWindow(shift.WorkDate, shift.StartsAtLocal, shift.EndsAtLocal,
                zones.GetValueOrDefault(shift.StationId));
            return new ShiftRow(shift, start, end);
        }).ToArray();
        var windows = new Dictionary<long, (DateTimeOffset From, DateTimeOffset Until)>();
        (DateTimeOffset From, DateTimeOffset Until) Window(long stationId)
        {
            if (days is null) return (now, DateTimeOffset.MaxValue);
            if (windows.TryGetValue(stationId, out var known)) return known;
            DateTimeOffset? NightEnd(DateOnly workDate) => shiftRows
                .Where(row => row.Shift.StationId == stationId && row.Shift.WorkDate == workDate &&
                    row.Shift.EndsAtLocal <= row.Shift.StartsAtLocal)
                .Select(row => (DateTimeOffset?)row.End).Max();
            return windows[stationId] = RampAgentReleaseRules.AbsenceWindow(days.From, days.To,
                zones.GetValueOrDefault(stationId), NightEnd(days.From.AddDays(-1)), NightEnd(days.To));
        }
        bool OperationInScope(OperationRow row)
        {
            if (days is null) return true;
            // Without a planned start the operation's day decides; the day after the absence belongs to it when
            // the agent's night shift of the last day crosses midnight at that station.
            if (row.Operation.PlannedStartAt is not { } start)
                return (row.OperationDate >= days.From && row.OperationDate <= days.To) ||
                    (row.OperationDate == days.To.AddDays(1) && shiftRows.Any(shift =>
                        shift.Shift.StationId == row.StationId && shift.Shift.WorkDate == days.To &&
                        shift.Shift.EndsAtLocal <= shift.Shift.StartsAtLocal));
            var (from, until) = Window(row.StationId);
            return from <= start && start < until;
        }

        var inScope = operations.Where(OperationInScope).ToArray();
        if (inScope.Any(row => row.Operation.CurrentStatus is GroundOperationStatus.InProgress or GroundOperationStatus.Returned))
            return new Outcome(true, 0, 0, 0);

        var releasedCoverages = coverages.Where(coverage =>
        {
            var (from, until) = Window(coverage.StationId);
            return coverage.StartsAt < until && coverage.EndsAt > from;
        }).ToArray();
        var removedShifts = shiftRows.Where(row => row.Start > now &&
            (days is null || (row.Shift.WorkDate >= days.From && row.Shift.WorkDate <= days.To))).ToArray();
        if (inScope.Length == 0 && releasedCoverages.Length == 0 && removedShifts.Length == 0)
            return new Outcome(false, 0, 0, 0);

        var correlation = Guid.CreateVersion7();
        var reason = Label(cause);
        var agentPublicId = await context.RampAgents.Where(agent => agent.Id == agentId).Select(agent => agent.PublicId)
            .SingleAsync(cancellationToken);
        var stations = new HashSet<long>();
        var scheduleAgents = new HashSet<long> { agentId };

        foreach (var coverage in releasedCoverages)
        {
            coverage.ReleasedAt = now < coverage.CreatedAt ? coverage.CreatedAt : now;
            coverage.ReleasedByAccountId = actorAccountId;
            coverage.UpdatedAt = now;
            Audit(context, actorAccountId, "hr.agent_release.coverage_released", nameof(PositionCoverage), coverage.PublicId,
                coverage.StationId, reason, correlation, now, new AuditFieldChangeData("coverage.status", "Open", "Released"));
            stations.Add(coverage.StationId);
            scheduleAgents.Add(coverage.RampAgentId);
            if (coverage.MentorRampAgentId is { } mentor) scheduleAgents.Add(mentor);
        }

        var releasedOperations = inScope.GroupBy(row => row.Operation.Id).ToArray();
        foreach (var group in releasedOperations)
            await ReleaseOperationAsync(context, group.First().Operation, group.Select(row => row.Assignment).ToArray(),
                group.First().StationId, group.First().AirlineId, actorAccountId, reason,
                "hr.agent_release.operation_released", ReleasedKind, correlation, now, cancellationToken);

        if (removedShifts.Length > 0)
        {
            var humanResources = await HumanResourcesRecipientsAsync(context, cancellationToken);
            foreach (var row in removedShifts)
            {
                context.ShiftAssignments.Remove(row.Shift);
                Audit(context, actorAccountId, "hr.agent_release.shift_removed", "hr.shift_assignments", row.Shift.PublicId,
                    row.Shift.StationId, reason, correlation, now, new AuditFieldChangeData("shift.status", "Scheduled", "Removed"));
                foreach (var recipient in humanResources)
                    AccountChangeOutboxWriter.Add(context, recipient, null, "hr_shifts", row.Shift.PublicId, now);
                stations.Add(row.Shift.StationId);
            }
        }

        foreach (var agent in scheduleAgents)
            await RampOperationChangeWriter.AnnounceScheduleAsync(context, agent, agentPublicId, now, cancellationToken);
        var stationKeys = stations.ToArray();
        foreach (var station in await context.Stations.AsNoTracking().Where(item => stationKeys.Contains(item.Id))
                     .Select(item => new { item.Id, item.PublicId }).ToArrayAsync(cancellationToken))
            await OccPlanningChangeWriter.AddForStationAsync(context, station.Id, station.PublicId, now, cancellationToken);
        return new Outcome(false, releasedCoverages.Length, releasedOperations.Length, removedShifts.Length);
    }

    /// <summary>
    /// Takes the given open assignments off one operation, inside the caller's transaction: each one is released,
    /// audited (<paramref name="auditAction"/>, with the reason) and its agent told with <c>assignment_released</c>,
    /// a type the deployed tablet knows. OCC is told with <paramref name="occNoticeKind"/> unless it is null (OCC made
    /// the change). An assigned operation left without agents goes back to Planned unless <paramref name="keepStatus"/>
    /// (a cancellation sets its own status, a handover keeps it). <paramref name="extraChanges"/> join the audit (the
    /// agent a handover names). The airline's portal and the tablets hear the change. The caller saves.
    /// </summary>
    public static async Task ReleaseOperationAsync(ElevantDbContext context, GroundOperation operation,
        IReadOnlyCollection<OperationAgentAssignment> assignments, long stationId, long airlineId, long actorAccountId,
        string reason, string auditAction, string? occNoticeKind, Guid correlation, DateTimeOffset now,
        CancellationToken cancellationToken, bool keepStatus = false,
        IReadOnlyCollection<AuditFieldChangeData>? extraChanges = null)
    {
        if (assignments.Count == 0) return;
        foreach (var assignment in assignments)
        {
            assignment.ReleasedAt = now < assignment.AssignedAt ? assignment.AssignedAt : now;
            assignment.UpdatedAt = now;
        }
        var released = assignments.Select(assignment => assignment.Id).ToArray();
        var othersKeep = await context.OperationAgentAssignments.AnyAsync(item => item.GroundOperationId == operation.Id &&
            item.ReleasedAt == null && !released.Contains(item.Id), cancellationToken);
        var changes = new List<AuditFieldChangeData> { new("assignment.status", "Open", "Released") };
        if (!keepStatus && operation.CurrentStatus == GroundOperationStatus.Assigned && !othersKeep)
        {
            operation.CurrentStatus = GroundOperationStatus.Planned;
            operation.UpdatedAt = now;
            context.Set<GroundOperationStatusEvent>().Add(new GroundOperationStatusEvent
            {
                GroundOperationId = operation.Id, FromStatus = GroundOperationStatus.Assigned,
                ToStatus = GroundOperationStatus.Planned, OccurredAt = now, ActorAccountId = actorAccountId,
                Reason = $"Agente liberado: {reason}.",
            });
            changes.Add(new("operation.status", nameof(GroundOperationStatus.Assigned), nameof(GroundOperationStatus.Planned)));
        }
        if (extraChanges is not null) changes.AddRange(extraChanges);
        Audit(context, actorAccountId, auditAction, nameof(GroundOperation), operation.PublicId, stationId, reason,
            correlation, now, [.. changes]);
        var first = assignments.First();
        if (occNoticeKind is not null)
            await OperationalNotificationWriter.NotifyOccAsync(context, stationId, operation.Id, first.PublicId,
                occNoticeKind, now, actorAccountId, cancellationToken);
        var agents = assignments.GroupBy(assignment => assignment.RampAgentId).ToArray();
        foreach (var agent in agents)
            await OperationalNotificationWriter.NotifyAgentAsync(context, agent.Key, stationId, operation.Id,
                agent.First().PublicId, "assignment_released", now, cancellationToken);
        var organizationId = await context.Airlines.Where(airline => airline.Id == airlineId)
            .Select(airline => airline.OrganizationId).SingleAsync(cancellationToken);
        await AirlineOperationChangeWriter.AddAsync(context, organizationId, operation.PublicId, now, cancellationToken);
        await RampOperationChangeWriter.AnnounceAsync(context, operation.Id, now, false, cancellationToken,
            [.. agents.Select(agent => agent.Key)]);
    }

    /// <summary>
    /// Hands an operation from its agent to another one, inside the caller's transaction (3-F, 3-N05): the previous
    /// assignment is released with <see cref="ReleaseOperationAsync"/> keeping the operation's status (nothing is
    /// re-materialized, the evidence keeps its author per row), the new agent gets an assignment with the same role and
    /// <paramref name="operationalPositionId"/> (the previous one's when null), is told with <c>operation_assigned</c>
    /// and both agents' tablets and schedules hear it. One audit (<paramref name="auditAction"/>) names both agents. The
    /// caller checks the new agent's eligibility and saves. Returns the new assignment.
    /// </summary>
    public static async Task<OperationAgentAssignment> ReplaceAgentAsync(ElevantDbContext context, GroundOperation operation,
        OperationAgentAssignment previous, long newAgentId, long? operationalPositionId, long stationId, long airlineId,
        long actorAccountId, string reason, string auditAction, Guid correlation, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var numbers = await context.RampAgents.AsNoTracking()
            .Where(agent => agent.Id == previous.RampAgentId || agent.Id == newAgentId)
            .ToDictionaryAsync(agent => agent.Id, agent => new { agent.EmployeeNumber, agent.PublicId }, cancellationToken);
        await ReleaseOperationAsync(context, operation, [previous], stationId, airlineId, actorAccountId, reason,
            auditAction, null, correlation, now, cancellationToken, keepStatus: true,
            [new AuditFieldChangeData("assignment.agent", numbers.GetValueOrDefault(previous.RampAgentId)?.EmployeeNumber,
                numbers.GetValueOrDefault(newAgentId)?.EmployeeNumber)]);
        var assignment = new OperationAgentAssignment
        {
            PublicId = Guid.CreateVersion7(), GroundOperationId = operation.Id, RampAgentId = newAgentId,
            OperationalPositionId = operationalPositionId ?? previous.OperationalPositionId,
            AssignmentRole = previous.AssignmentRole, AssignedAt = now, AssignedByAccountId = actorAccountId,
            CreatedAt = now, UpdatedAt = now,
        };
        context.OperationAgentAssignments.Add(assignment);
        await OperationalNotificationWriter.NotifyAgentAsync(context, newAgentId, stationId, operation.Id,
            assignment.PublicId, "operation_assigned", now, cancellationToken);
        await RampOperationChangeWriter.AnnounceAsync(context, operation.Id, now, false, cancellationToken,
            previous.RampAgentId, newAgentId);
        foreach (var agent in new[] { previous.RampAgentId, newAgentId })
            await RampOperationChangeWriter.AnnounceScheduleAsync(context, agent,
                numbers.GetValueOrDefault(agent)?.PublicId ?? operation.PublicId, now, cancellationToken);
        return assignment;
    }

    /// <summary>
    /// OCC approved the operation (3-D): from now on it no longer holds its agent nor its stand
    /// (<see cref="OperationOccupancyRules"/>), so the planning board and the agent's schedule hear that both are free.
    /// Nothing is closed: the assignment and the stand assignment stay as the record of who worked the flight and where
    /// (documents, attendance, reports and the reopening read them). Announcing twice is harmless, so a second approval
    /// of a reopened review calls it again. The caller saves.
    /// </summary>
    public static async Task ReleaseOnApprovalAsync(ElevantDbContext context, GroundOperation operation, long stationId,
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        var station = await context.Stations.AsNoTracking().Where(item => item.Id == stationId)
            .Select(item => item.PublicId).SingleAsync(cancellationToken);
        await OccPlanningChangeWriter.AddForStationAsync(context, stationId, station, now, cancellationToken);
        var agents = await context.OperationAgentAssignments.AsNoTracking()
            .Where(item => item.GroundOperationId == operation.Id && item.ReleasedAt == null)
            .Select(item => item.RampAgentId).Distinct().ToArrayAsync(cancellationToken);
        foreach (var agent in agents)
            await RampOperationChangeWriter.AnnounceScheduleAsync(context, agent, operation.PublicId, now, cancellationToken);
    }

    /// <summary>A scope that began after today ends the day it began; the check constraint keeps ValidTo ≥ ValidFrom.</summary>
    private static DateOnly Closing(DateOnly validFrom, DateOnly today) => today < validFrom ? validFrom : today;

    private static async Task<Dictionary<long, string>> ZonesAsync(ElevantDbContext context, IEnumerable<long> stationIds,
        CancellationToken cancellationToken)
    {
        var ids = stationIds.Distinct().ToArray();
        return ids.Length == 0 ? [] : await context.Stations.AsNoTracking().Where(station => ids.Contains(station.Id))
            .ToDictionaryAsync(station => station.Id, station => station.IanaTimeZone, cancellationToken);
    }

    private static Task<long[]> HumanResourcesRecipientsAsync(ElevantDbContext context, CancellationToken cancellationToken) =>
        (from link in context.Set<IdentityUserRole<long>>().AsNoTracking()
         join role in context.Roles.AsNoTracking() on link.RoleId equals role.Id
         where role.NormalizedName == "SUPERADMIN" || role.NormalizedName == "GESTION_HUMANA"
         select link.UserId).Distinct().ToArrayAsync(cancellationToken);

    private static string Label(Cause cause) => cause switch
    {
        Cause.Termination => "empleado dado de baja",
        Cause.Transfer => "traslado fuera de rampa",
        Cause.OfficePosition => "cambio a un puesto de oficina",
        Cause.ProfileDeactivated => "perfil de rampa desactivado",
        _ => "ausencia aprobada",
    };

    private static void Audit(ElevantDbContext context, long actorAccountId, string action, string entityType, Guid entityId,
        long stationId, string reason, Guid correlation, DateTimeOffset now, params AuditFieldChangeData[] changes) =>
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = now, ActorType = AuditActorType.Account,
            ActorAccountId = actorAccountId, Action = action, EntityType = entityType, EntityPublicId = entityId,
            StationId = stationId, Source = AuditSource.Api, CorrelationId = correlation, Reason = reason,
            MetadataJson = SafeAuditChanges.Serialize(changes),
        });
}
