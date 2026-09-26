using System.Data;
using System.Text.Json;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Elevant.Persistence.Operations;

/// <summary>Programs one live, scoped agent shift for an unassigned manual flight.</summary>
internal sealed class EfOccShiftProgrammingStore(
    ElevantDbContext context,
    IOccPlanningReadStore planningReadStore,
    TimeProvider timeProvider) : IOccShiftProgrammingStore
{
    public async Task<OccShiftWriteResult> ProgramAsync(
        OccShiftWriteRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        Guid? committedAuditId = null;
        OccShiftWriteResult? attempt = null;
        try
        {
            return await context.Database.CreateExecutionStrategy().ExecuteInTransactionAsync(
                async token =>
                {
                    context.ChangeTracker.Clear();
                    (attempt, committedAuditId) = await ProgramInsideTransactionAsync(request, token);
                    if (!attempt.IsSuccess) context.ChangeTracker.Clear();
                    return attempt;
                },
                async token =>
                {
                    context.ChangeTracker.Clear();
                    if (attempt is null || !attempt.IsSuccess || attempt.Replayed) return attempt is not null;
                    return committedAuditId.HasValue &&
                        await context.AuditEntries.AsNoTracking().AnyAsync(entry =>
                            entry.PublicId == committedAuditId.Value &&
                            entry.Action == "occ.shift.programmed" &&
                            entry.EntityPublicId == attempt.ShiftId, token);
                },
                IsolationLevel.Serializable,
                cancellationToken);
        }
        catch (ShiftConflictException)
        {
            context.ChangeTracker.Clear();
            return OccShiftWriteResult.Failed(OccShiftWriteFailure.Conflict);
        }
        catch (RetryLimitExceededException exception) when (IsConflict(exception))
        {
            context.ChangeTracker.Clear();
            return OccShiftWriteResult.Failed(OccShiftWriteFailure.Conflict);
        }
        catch (DbUpdateException exception) when (IsConflict(exception))
        {
            context.ChangeTracker.Clear();
            return OccShiftWriteResult.Failed(OccShiftWriteFailure.Conflict);
        }
        catch (SqlException exception) when (exception.Number is 1205 or 2601 or 2627)
        {
            context.ChangeTracker.Clear();
            return OccShiftWriteResult.Failed(OccShiftWriteFailure.Conflict);
        }
    }

    private async Task<(OccShiftWriteResult Result, Guid? AuditId)> ProgramInsideTransactionAsync(
        OccShiftWriteRequest request, CancellationToken cancellationToken)
    {
        var now = timeProvider.GetUtcNow();
        var actor = await new EfActorContextResolver(context, timeProvider)
            .ResolveAsync(request.ActorAccountId, cancellationToken);
        if (actor is null ||
            !actor.Roles.Any(role => role.Code == "ADMIN_OCC" && role.Portal == PortalKind.BackOffice) ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff))
            return (NotFound(), null);

        var target = await (
            from turnaround in context.Turnarounds.AsNoTracking()
            join station in context.Stations.AsNoTracking() on turnaround.StationId equals station.Id
            join account in context.Users.AsNoTracking() on request.ActorAccountId equals account.PublicId
            where turnaround.PublicId == request.TurnaroundId &&
                  station.IsActive && request.AllowedStationIds.Contains(station.PublicId) &&
                  context.AccountStationScopes.AsNoTracking().Any(grant =>
                      grant.AccountId == account.Id && grant.StationId == station.Id &&
                      grant.GrantedAt <= now && grant.RevokedAt == null)
            select new
            {
                turnaround.Id,
                turnaround.OperationDate,
                station.PublicId,
                StationId = station.Id,
                station.IanaTimeZone,
                ActorAccountId = account.Id,
            }).SingleOrDefaultAsync(cancellationToken);
        if (target is null || !actor.StationScopes.Any(scope => scope.StationId == target.PublicId))
            return (NotFound(), null);

        var operation = await context.GroundOperations.AsNoTracking()
            .Where(item => item.TurnaroundId == target.Id)
            .Select(item => new { item.Id, item.CurrentStatus, item.PlannedStartAt, item.PlannedEndAt })
            .SingleOrDefaultAsync(cancellationToken);
        if (operation is null || operation.CurrentStatus != GroundOperationStatus.Planned ||
            operation.PlannedStartAt is null || operation.PlannedEndAt is null ||
            operation.PlannedEndAt <= operation.PlannedStartAt ||
            await context.OperationAgentAssignments.AsNoTracking().AnyAsync(item =>
                item.GroundOperationId == operation.Id && item.ReleasedAt == null, cancellationToken))
            return (Conflict(), null);

        var standContext = await (
            from assignment in context.Set<StandAssignment>().AsNoTracking()
            join stand in context.Stands.AsNoTracking() on assignment.StandId equals stand.Id
            join terminal in context.Terminals.AsNoTracking() on stand.TerminalId equals (long?)terminal.Id
            where assignment.TurnaroundId == target.Id && assignment.AssignedTo == null &&
                  stand.IsActive && stand.StationId == target.StationId &&
                  terminal.IsActive && terminal.StationId == target.StationId
            select new { TerminalId = terminal.Id }).SingleOrDefaultAsync(cancellationToken);
        if (standContext is null) return (Conflict(), null);

        var position = await context.OperationalPositions.AsNoTracking()
            .Where(item => item.Code == "RAMP-AGENT" && item.IsActive)
            .Select(item => new { item.Id, item.PublicId })
            .SingleOrDefaultAsync(cancellationToken);
        if (position is null) return (Conflict(), null);

        var zone = TimeZoneInfo.FindSystemTimeZoneById(target.IanaTimeZone);
        var localStart = TimeZoneInfo.ConvertTime(operation.PlannedStartAt.Value, zone).DateTime;
        var localEnd = TimeZoneInfo.ConvertTime(operation.PlannedEndAt.Value, zone).DateTime;
        if (DateOnly.FromDateTime(localStart) != target.OperationDate ||
            !OccShiftCoveragePolicy.CoversInterval(target.OperationDate,
                request.StartsAtLocal, request.EndsAtLocal, localStart, localEnd))
            return (Conflict(), null);

        var agent = await context.RampAgents.AsNoTracking()
            .Where(item => item.PublicId == request.AgentId && item.IsActive)
            .Select(item => new { item.Id })
            .SingleOrDefaultAsync(cancellationToken);
        if (agent is null) return (Conflict(), null);

        var existing = await context.ShiftAssignments
            .FromSqlInterpolated($"""
                SELECT * FROM [hr].[shift_assignments] WITH (UPDLOCK, HOLDLOCK)
                WHERE [ramp_agent_id] = {agent.Id} AND [work_date] = {target.OperationDate}
                """)
            .AsNoTracking().SingleOrDefaultAsync(cancellationToken);
        if (existing is not null)
        {
            if (existing.StationId != target.StationId ||
                existing.TerminalId != standContext.TerminalId ||
                existing.OperationalPositionId != position.Id ||
                existing.StartsAtLocal != request.StartsAtLocal ||
                existing.EndsAtLocal != request.EndsAtLocal)
                return (Conflict(), null);
            await RequireEligibleCandidateAsync(target.PublicId, request.TurnaroundId,
                request.AgentId, cancellationToken);
            return (OccShiftWriteResult.Existing(existing.PublicId), null);
        }

        var shift = new ShiftAssignment
        {
            PublicId = Guid.CreateVersion7(),
            RampAgentId = agent.Id,
            StationId = target.StationId,
            TerminalId = standContext.TerminalId,
            OperationalPositionId = position.Id,
            WorkDate = target.OperationDate,
            StartsAtLocal = request.StartsAtLocal,
            EndsAtLocal = request.EndsAtLocal,
            Block = request.StartsAtLocal.Hour < 12 ? ShiftBlock.Morning :
                request.StartsAtLocal.Hour < 18 ? ShiftBlock.Afternoon : ShiftBlock.Night,
            Notes = "OCC coverage for a manual turnaround.",
            CreatedAt = now,
            UpdatedAt = now,
        };
        context.ShiftAssignments.Add(shift);
        await context.SaveChangesAsync(cancellationToken);
        await RequireEligibleCandidateAsync(target.PublicId, request.TurnaroundId,
            request.AgentId, cancellationToken);

        var audit = new AuditEntry
        {
            PublicId = Guid.CreateVersion7(),
            OccurredAt = now,
            ActorType = AuditActorType.Account,
            ActorAccountId = target.ActorAccountId,
            Action = "occ.shift.programmed",
            EntityType = nameof(ShiftAssignment),
            EntityPublicId = shift.PublicId,
            StationId = target.StationId,
            Source = AuditSource.Api,
            CorrelationId = request.CorrelationId,
            RequestId = request.RequestId,
            MetadataJson = JsonSerializer.Serialize(new
            {
                turnaroundId = request.TurnaroundId,
                agentId = request.AgentId,
                positionId = position.PublicId,
                workDate = target.OperationDate,
                startsAtLocal = request.StartsAtLocal,
                endsAtLocal = request.EndsAtLocal,
            }),
        };
        context.AuditEntries.Add(audit);
        await context.SaveChangesAsync(cancellationToken);
        return (OccShiftWriteResult.Created(shift.PublicId), audit.PublicId);
    }

    private async Task RequireEligibleCandidateAsync(Guid stationId, Guid turnaroundId,
        Guid agentId, CancellationToken cancellationToken)
    {
        var options = await planningReadStore.GetOptionsAsync(
            [stationId], turnaroundId, cancellationToken);
        if (!options.IsSuccess || !options.Options!.AgentCandidates.Any(candidate =>
                candidate.Id == agentId && OccAgentEligibilityPolicy.Evaluate(candidate).Eligible))
            throw new ShiftConflictException();
    }

    private static OccShiftWriteResult NotFound() =>
        OccShiftWriteResult.Failed(OccShiftWriteFailure.NotFound);

    private static OccShiftWriteResult Conflict() =>
        OccShiftWriteResult.Failed(OccShiftWriteFailure.Conflict);

    private static bool IsConflict(Exception exception) =>
        exception is SqlException sql && sql.Number is 1205 or 2601 or 2627 ||
        exception.InnerException is not null && IsConflict(exception.InnerException);

    private sealed class ShiftConflictException : Exception;
}
