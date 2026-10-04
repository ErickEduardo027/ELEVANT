using System.Data;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Realtime;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

internal sealed class EfHumanResourcesShiftWriteStore(
    ElevantDbContext context, IActorContextResolver actors, TimeProvider clock)
    : IHumanResourcesShiftWriteStore
{
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
                HumanResourcesShiftWriteFailure.Invalid);
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
                var station = await context.Stations.AsNoTracking()
                    .SingleOrDefaultAsync(item => item.PublicId == input.StationId &&
                        item.IsActive, cancellationToken);
                var terminal = station is null ? null : await context.Terminals.AsNoTracking()
                    .SingleOrDefaultAsync(item => item.PublicId == input.TerminalId &&
                        item.StationId == station.Id && item.IsActive, cancellationToken);
                var position = await context.OperationalPositions.AsNoTracking()
                    .SingleOrDefaultAsync(item => item.Code == "RAMP-AGENT" && item.IsActive,
                        cancellationToken);
                if (agent is null || station is null || terminal is null || position is null)
                    return HumanResourcesShiftWriteResult.Failed(
                        HumanResourcesShiftWriteFailure.Conflict);

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
                if (!stationScope || !terminalScope || await context.ShiftAssignments
                    .AsNoTracking().AnyAsync(shift => shift.RampAgentId == agent.Id &&
                        shift.WorkDate == input.WorkDate, cancellationToken))
                    return HumanResourcesShiftWriteResult.Failed(
                        HumanResourcesShiftWriteFailure.Conflict);

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
                var recipients = await (from link in context.Set<IdentityUserRole<long>>()
                    join role in context.Roles on link.RoleId equals role.Id
                    where role.NormalizedName == "SUPERADMIN" ||
                          role.NormalizedName == "GESTION_HUMANA"
                    select link.UserId).Distinct().ToArrayAsync(cancellationToken);
                foreach (var recipient in recipients)
                    AccountChangeOutboxWriter.Add(context, recipient, null,
                        "hr_shifts", shiftId, now);
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
                    HumanResourcesShiftWriteFailure.Conflict)
                : await ReplayAsync(existing, actorDatabaseId, input,
                    cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return HumanResourcesShiftWriteResult.Failed(
                HumanResourcesShiftWriteFailure.Conflict);
        }
    }

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
                HumanResourcesShiftWriteFailure.Conflict);
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
