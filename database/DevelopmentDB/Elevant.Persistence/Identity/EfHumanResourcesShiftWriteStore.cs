using System.Data;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Common;
using Elevant.Application.Identity;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Commercial;
using Elevant.Persistence.Realtime;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

internal sealed class EfHumanResourcesShiftWriteStore(
    ElevantDbContext context, IActorContextResolver actors, TimeProvider clock)
    : IHumanResourcesShiftWriteStore
{
    private const string RemoveAction = "hr.shift.remove";

    public async Task<HumanResourcesShiftWriteResult> RecordAsync(Guid actorId,
        Guid shiftId, RecordHumanResourcesShiftInput input,
        CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!HumanResourcesShiftWritePolicy.CanRecord(actor))
            return HumanResourcesShiftWriteResult.Failed(
                HumanResourcesShiftWriteFailure.Forbidden);
        if (shiftId == Guid.Empty || input is null || !Valid(input))
            return HumanResourcesShiftWriteResult.Failed(
                HumanResourcesShiftWriteFailure.Invalid, "invalid_shift");
        if (!HumanResourcesShiftWritePolicy.CanRecord(actor, input.StationId))
            return HumanResourcesShiftWriteResult.Failed(
                HumanResourcesShiftWriteFailure.Forbidden);

        var actorDatabaseId = await context.Users.AsNoTracking()
            .Where(user => user.PublicId == actorId).Select(user => user.Id)
            .SingleAsync(cancellationToken);
        var now = clock.GetUtcNow();
        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(
                    IsolationLevel.Serializable, cancellationToken);

                if (!await HasActiveStationGrantAsync(actorDatabaseId, input.StationId,
                    now, cancellationToken))
                    return HumanResourcesShiftWriteResult.Failed(
                        HumanResourcesShiftWriteFailure.Forbidden);

                var existingById = await context.ShiftAssignments.AsNoTracking()
                    .SingleOrDefaultAsync(shift => shift.PublicId == shiftId,
                        cancellationToken);
                if (existingById is not null)
                    return await ReplayAsync(existingById, actorDatabaseId, input,
                        cancellationToken);

                var agent = await context.RampAgents.AsNoTracking()
                    .SingleOrDefaultAsync(item => item.PublicId == input.RampProfileId &&
                        item.IsActive, cancellationToken);
                if (agent is null)
                    return HumanResourcesShiftWriteResult.Failed(
                        HumanResourcesShiftWriteFailure.Conflict, "agent_unavailable");
                var station = await context.Stations.AsNoTracking()
                    .SingleOrDefaultAsync(item => item.PublicId == input.StationId &&
                        item.IsActive, cancellationToken);
                var terminal = station is null ? null : await context.Terminals.AsNoTracking()
                    .SingleOrDefaultAsync(item => item.PublicId == input.TerminalId &&
                        item.StationId == station.Id && item.IsActive, cancellationToken);
                var position = await context.OperationalPositions.AsNoTracking()
                    .SingleOrDefaultAsync(item => item.Code == "RAMP-AGENT" && item.IsActive,
                        cancellationToken);
                if (station is null || terminal is null || position is null)
                    return HumanResourcesShiftWriteResult.Failed(
                        HumanResourcesShiftWriteFailure.Conflict, "shift_scope_missing");

                var stationScope = await context.Set<RampAgentStationScope>()
                    .AsNoTracking().AnyAsync(scope => scope.RampAgentId == agent.Id &&
                        scope.StationId == station.Id && scope.ValidFrom <= input.WorkDate &&
                        (scope.ValidTo == null || scope.ValidTo >= input.WorkDate),
                        cancellationToken);
                var terminalScope = await context.Set<RampAgentTerminalScope>()
                    .AsNoTracking().AnyAsync(scope => scope.RampAgentId == agent.Id &&
                        scope.TerminalId == terminal.Id && scope.ValidFrom <= input.WorkDate &&
                        (scope.ValidTo == null || scope.ValidTo >= input.WorkDate),
                        cancellationToken);
                if (!stationScope || !terminalScope)
                    return HumanResourcesShiftWriteResult.Failed(
                        HumanResourcesShiftWriteFailure.Conflict, "shift_scope_missing");
                if (await context.ShiftAssignments.AsNoTracking().AnyAsync(shift =>
                        shift.RampAgentId == agent.Id && shift.WorkDate == input.WorkDate, cancellationToken))
                    return HumanResourcesShiftWriteResult.Failed(
                        HumanResourcesShiftWriteFailure.Conflict, "shift_day_taken");
                // 2-N24: a day of an approved day off or restriction takes no shift.
                if (await context.AvailabilityRequests.AsNoTracking().AnyAsync(request =>
                        request.RampAgentId == agent.Id &&
                        request.Status == AvailabilityRequestStatus.Approved &&
                        (request.Type == AvailabilityRequestType.DayOff ||
                         request.Type == AvailabilityRequestType.Restriction) &&
                        request.StartsOn <= input.WorkDate && request.EndsOn >= input.WorkDate,
                        cancellationToken))
                    return HumanResourcesShiftWriteResult.Failed(
                        HumanResourcesShiftWriteFailure.Conflict, "shift_on_approved_absence");

                var shift = new ShiftAssignment
                {
                    PublicId = shiftId,
                    CreatedAt = now,
                    UpdatedAt = now,
                    RampAgentId = agent.Id,
                    StationId = station.Id,
                    TerminalId = terminal.Id,
                    OperationalPositionId = position.Id,
                    WorkDate = input.WorkDate,
                    StartsAtLocal = input.StartsAtLocal,
                    EndsAtLocal = input.EndsAtLocal,
                    Block = input.StartsAtLocal.Hour < 12 ? ShiftBlock.Morning :
                        input.StartsAtLocal.Hour < 18 ? ShiftBlock.Afternoon : ShiftBlock.Night,
                    Notes = NormalizeNotes(input.Notes),
                };
                context.ShiftAssignments.Add(shift);
                context.AuditEntries.Add(new AuditEntry
                {
                    PublicId = Guid.CreateVersion7(),
                    OccurredAt = now,
                    ActorType = AuditActorType.Account,
                    ActorAccountId = actorDatabaseId,
                    Source = AuditSource.Api,
                    CorrelationId = shiftId,
                    Action = "hr.shift.recorded",
                    EntityType = "hr.shift_assignments",
                    EntityPublicId = shiftId,
                    StationId = station.Id,
                });
                foreach (var recipient in await HumanResourcesRecipientsAsync(cancellationToken))
                    AccountChangeOutboxWriter.Add(context, recipient, null,
                        "hr_shifts", shiftId, now);
                await Elevant.Persistence.Operations.RampOperationChangeWriter.AnnounceScheduleAsync(context, agent.Id, shiftId, now, cancellationToken);
                await OccPlanningChangeWriter.AddForStationAsync(context, station.Id,
                    station.PublicId, now, cancellationToken);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return HumanResourcesShiftWriteResult.Success(shiftId);
            });
        }
        catch (DbUpdateException exception) when (
            exception.InnerException is SqlException { Number: 2601 or 2627 })
        {
            context.ChangeTracker.Clear();
            if (!await HasActiveStationGrantAsync(actorDatabaseId, input.StationId,
                clock.GetUtcNow(), cancellationToken))
                return HumanResourcesShiftWriteResult.Failed(
                    HumanResourcesShiftWriteFailure.Forbidden);
            var existing = await context.ShiftAssignments.AsNoTracking()
                .SingleOrDefaultAsync(shift => shift.PublicId == shiftId,
                    cancellationToken);
            return existing is null
                ? HumanResourcesShiftWriteResult.Failed(
                    HumanResourcesShiftWriteFailure.Conflict, "shift_day_taken")
                : await ReplayAsync(existing, actorDatabaseId, input,
                    cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return HumanResourcesShiftWriteResult.Failed(
                HumanResourcesShiftWriteFailure.Conflict, "version_conflict");
        }
    }

    public async Task<HumanResourcesShiftWriteResult> RemoveAsync(Guid actorId, Guid shiftId,
        RemoveHumanResourcesShiftInput input, CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!HumanResourcesShiftWritePolicy.CanRecord(actor))
            return HumanResourcesShiftWriteResult.Failed(HumanResourcesShiftWriteFailure.Forbidden);
        if (shiftId == Guid.Empty || input is null)
            return HumanResourcesShiftWriteResult.Failed(HumanResourcesShiftWriteFailure.Invalid, "invalid_shift");
        // Expand phase: the key and the version are optional for older clients; a key needs the version.
        if (input.IdempotencyKey == Guid.Empty)
            return HumanResourcesShiftWriteResult.Failed(HumanResourcesShiftWriteFailure.Invalid, "idempotency_key_required");
        var expected = string.IsNullOrWhiteSpace(input.ExpectedVersion) ? null : input.ExpectedVersion.Trim();
        if (input.IdempotencyKey is not null && expected is null)
            return HumanResourcesShiftWriteResult.Failed(HumanResourcesShiftWriteFailure.Invalid, "expected_version_required");
        var actorDatabaseId = await context.Users.AsNoTracking()
            .Where(user => user.PublicId == actorId).Select(user => user.Id).SingleAsync(cancellationToken);
        var hash = CommercialCommandReceipts.Hash(new { shiftId, version = expected });

        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(
                    IsolationLevel.Serializable, cancellationToken);
                if (input.IdempotencyKey is { } key)
                {
                    var prior = await CommercialCommandReceipts.FindAsync(context, key, actorDatabaseId, RemoveAction,
                        hash, cancellationToken);
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Conflict)
                        return HumanResourcesShiftWriteResult.Failed(HumanResourcesShiftWriteFailure.Conflict,
                            "idempotency_conflict");
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Replay)
                        return HumanResourcesShiftWriteResult.Success(shiftId);
                }
                var row = await (from shift in context.ShiftAssignments
                                 join station in context.Stations on shift.StationId equals station.Id
                                 where shift.PublicId == shiftId
                                 select new { Shift = shift, StationPublicId = station.PublicId, StationKey = station.Id,
                                     station.IanaTimeZone })
                    .SingleOrDefaultAsync(cancellationToken);
                // Removing twice answers the same: the shift is gone.
                if (row is null) return HumanResourcesShiftWriteResult.Success(shiftId);
                if (!HumanResourcesShiftWritePolicy.CanRecord(actor, row.StationPublicId))
                    return HumanResourcesShiftWriteResult.Failed(HumanResourcesShiftWriteFailure.Forbidden);
                var now = clock.GetUtcNow();
                if (!await HasActiveStationGrantAsync(actorDatabaseId, row.StationPublicId, now, cancellationToken))
                    return HumanResourcesShiftWriteResult.Failed(HumanResourcesShiftWriteFailure.Forbidden);
                if (expected is not null && GovernanceSupport.Version(row.Shift.RowVersion) != expected)
                    return HumanResourcesShiftWriteResult.Failed(HumanResourcesShiftWriteFailure.Conflict, "version_conflict");
                // 2-N31: the station's day decides what is past, never the UTC day.
                if (row.Shift.WorkDate < BusinessCalendar.Today(now, row.IanaTimeZone))
                    return HumanResourcesShiftWriteResult.Failed(HumanResourcesShiftWriteFailure.Conflict, "shift_in_past");
                if (await InUseAsync(row.Shift, row.IanaTimeZone, cancellationToken))
                    return HumanResourcesShiftWriteResult.Failed(HumanResourcesShiftWriteFailure.Conflict, "shift_in_use");

                context.ShiftAssignments.Remove(row.Shift);
                context.AuditEntries.Add(new AuditEntry
                {
                    PublicId = Guid.CreateVersion7(), OccurredAt = now, ActorType = AuditActorType.Account,
                    ActorAccountId = actorDatabaseId, Source = AuditSource.Api, CorrelationId = shiftId,
                    Action = "hr.shift.removed", EntityType = "hr.shift_assignments", EntityPublicId = shiftId,
                    StationId = row.StationKey,
                });
                foreach (var recipient in await HumanResourcesRecipientsAsync(cancellationToken))
                    AccountChangeOutboxWriter.Add(context, recipient, null, "hr_shifts", shiftId, now);
                await Elevant.Persistence.Operations.RampOperationChangeWriter.AnnounceScheduleAsync(context, row.Shift.RampAgentId, shiftId, now, cancellationToken);
                await OccPlanningChangeWriter.AddForStationAsync(context, row.StationKey, row.StationPublicId, now, cancellationToken);
                if (input.IdempotencyKey is { } receipt)
                    CommercialCommandReceipts.Add(context, receipt, actorDatabaseId, RemoveAction, hash, shiftId, now);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return HumanResourcesShiftWriteResult.Success(shiftId);
            });
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return HumanResourcesShiftWriteResult.Failed(HumanResourcesShiftWriteFailure.Conflict, "version_conflict");
        }
        catch (DbUpdateException exception) when (input.IdempotencyKey is { } key &&
            CommercialCommandReceipts.IsDuplicateKey(exception))
        {
            context.ChangeTracker.Clear();
            var concurrent = await CommercialCommandReceipts.FindAsync(context, key, actorDatabaseId, RemoveAction, hash,
                cancellationToken);
            return concurrent.Outcome == CommercialCommandReceipts.Outcome.Replay
                ? HumanResourcesShiftWriteResult.Success(shiftId)
                : HumanResourcesShiftWriteResult.Failed(HumanResourcesShiftWriteFailure.Conflict, "idempotency_conflict");
        }
        catch (DbUpdateException exception) when (exception.InnerException is SqlException { Number: 547 })
        {
            // Still referenced: it stays as history.
            context.ChangeTracker.Clear();
            return HumanResourcesShiftWriteResult.Failed(HumanResourcesShiftWriteFailure.Conflict, "shift_in_use");
        }
    }

    /// <summary>
    /// 2-N11: the agent of the shift already works in its hours at its station — an open coverage as the agent or
    /// the mentor, or an open assignment of an operation that is not cancelled.
    /// </summary>
    private async Task<bool> InUseAsync(ShiftAssignment shift, string ianaTimeZone, CancellationToken cancellationToken)
    {
        var (start, end) = RampAgentReleaseRules.ShiftWindow(shift.WorkDate, shift.StartsAtLocal, shift.EndsAtLocal,
            ianaTimeZone);
        if (await context.Set<PositionCoverage>().AsNoTracking().AnyAsync(coverage => coverage.ReleasedAt == null &&
                coverage.StationId == shift.StationId &&
                (coverage.RampAgentId == shift.RampAgentId || coverage.MentorRampAgentId == shift.RampAgentId) &&
                coverage.StartsAt < end && start < coverage.EndsAt, cancellationToken))
            return true;
        return await (from assignment in context.OperationAgentAssignments.AsNoTracking()
                      join operation in context.GroundOperations.AsNoTracking()
                          on assignment.GroundOperationId equals operation.Id
                      join turnaround in context.Turnarounds.AsNoTracking() on operation.TurnaroundId equals turnaround.Id
                      where assignment.RampAgentId == shift.RampAgentId && assignment.ReleasedAt == null &&
                            turnaround.StationId == shift.StationId &&
                            operation.CurrentStatus != GroundOperationStatus.Cancelled &&
                            ((operation.PlannedStartAt != null && operation.PlannedStartAt < end &&
                              ((operation.PlannedEndAt != null && operation.PlannedEndAt > start) ||
                               (operation.PlannedEndAt == null && operation.PlannedStartAt >= start))) ||
                             (operation.PlannedStartAt == null && turnaround.OperationDate == shift.WorkDate))
                      select assignment.Id).AnyAsync(cancellationToken);
    }

    private Task<long[]> HumanResourcesRecipientsAsync(CancellationToken cancellationToken) =>
        (from link in context.Set<IdentityUserRole<long>>()
         join role in context.Roles on link.RoleId equals role.Id
         where role.NormalizedName == "SUPERADMIN" || role.NormalizedName == "GESTION_HUMANA"
         select link.UserId).Distinct().ToArrayAsync(cancellationToken);

    private Task<bool> HasActiveStationGrantAsync(long actorDatabaseId, Guid stationId,
        DateTimeOffset now, CancellationToken cancellationToken) =>
        (from grant in context.AccountStationScopes.AsNoTracking()
         join station in context.Stations.AsNoTracking() on grant.StationId equals station.Id
         where grant.AccountId == actorDatabaseId && station.PublicId == stationId &&
               station.IsActive && grant.GrantedAt <= now && grant.RevokedAt == null
         select grant.Id).AnyAsync(cancellationToken);

    private async Task<HumanResourcesShiftWriteResult> ReplayAsync(
        ShiftAssignment existing, long actorDatabaseId,
        RecordHumanResourcesShiftInput input, CancellationToken cancellationToken)
    {
        var auditMatches = await context.AuditEntries.AsNoTracking().AnyAsync(entry =>
            entry.Action == "hr.shift.recorded" &&
            entry.EntityPublicId == existing.PublicId &&
            entry.ActorAccountId == actorDatabaseId &&
            entry.CorrelationId == existing.PublicId, cancellationToken);
        var agentMatches = await context.RampAgents.AsNoTracking().AnyAsync(agent =>
            agent.Id == existing.RampAgentId && agent.PublicId == input.RampProfileId,
            cancellationToken);
        var stationMatches = await context.Stations.AsNoTracking().AnyAsync(station =>
            station.Id == existing.StationId && station.PublicId == input.StationId,
            cancellationToken);
        var terminalMatches = await context.Terminals.AsNoTracking().AnyAsync(terminal =>
            terminal.Id == existing.TerminalId && terminal.PublicId == input.TerminalId,
            cancellationToken);
        return auditMatches && agentMatches && stationMatches && terminalMatches &&
               existing.WorkDate == input.WorkDate &&
               existing.StartsAtLocal == input.StartsAtLocal &&
               existing.EndsAtLocal == input.EndsAtLocal &&
               existing.Notes == NormalizeNotes(input.Notes)
            ? HumanResourcesShiftWriteResult.Success(existing.PublicId)
            : HumanResourcesShiftWriteResult.Failed(
                HumanResourcesShiftWriteFailure.Conflict, "idempotency_conflict");
    }

    private static bool Valid(RecordHumanResourcesShiftInput input)
    {
        if (input.RampProfileId == Guid.Empty || input.StationId == Guid.Empty ||
            input.TerminalId == Guid.Empty || input.WorkDate == default ||
            input.StartsAtLocal == input.EndsAtLocal ||
            input.Notes?.Trim().Length > 500) return false;
        var start = input.WorkDate.ToDateTime(input.StartsAtLocal);
        var end = input.WorkDate.ToDateTime(input.EndsAtLocal);
        if (end <= start) end = end.AddDays(1);
        return end - start <= TimeSpan.FromHours(16);
    }

    private static string? NormalizeNotes(string? notes) =>
        string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();
}
