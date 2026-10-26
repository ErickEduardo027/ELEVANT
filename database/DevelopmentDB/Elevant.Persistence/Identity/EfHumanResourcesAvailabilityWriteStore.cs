using System.Data;
using Elevant.Application.Abstractions.Identity;
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

internal sealed class EfHumanResourcesAvailabilityWriteStore(
    ElevantDbContext context, IActorContextResolver actors, TimeProvider clock)
    : IHumanResourcesAvailabilityWriteStore
{
    public async Task<HumanResourcesAvailabilityWriteResult> RecordAsync(
        Guid actorId, Guid requestId, RecordHumanResourcesAvailabilityInput input,
        CancellationToken cancellationToken = default)
    {
        var actorKey = await AuthorizedActorKeyAsync(actorId, "human_resources.availability.create", cancellationToken);
        if (actorKey is null) return Fail(HumanResourcesAvailabilityWriteFailure.Forbidden);
        if (requestId == Guid.Empty || input is null ||
            input.RampProfileId == Guid.Empty || input.StartsOn == default ||
            input.EndsOn < input.StartsOn ||
            input.EndsOn.DayNumber - input.StartsOn.DayNumber > 30 ||
            string.IsNullOrWhiteSpace(input.Reason) || input.Reason.Trim().Length > 1000 ||
            !TryType(input.Type, out var type))
            return Fail(HumanResourcesAvailabilityWriteFailure.Invalid);

        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(
                    IsolationLevel.Serializable, cancellationToken);
                var existing = await context.AvailabilityRequests.AsNoTracking()
                    .SingleOrDefaultAsync(request => request.PublicId == requestId,
                        cancellationToken);
                if (existing is not null)
                    return await ReplayRecordAsync(existing, actorKey.Value, input,
                        type, cancellationToken);

                var agentKey = await context.RampAgents.AsNoTracking()
                    .Where(agent => agent.PublicId == input.RampProfileId && agent.IsActive)
                    .Select(agent => (long?)agent.Id).SingleOrDefaultAsync(cancellationToken);
                if (agentKey is null || await context.AvailabilityRequests.AsNoTracking()
                    .AnyAsync(request => request.RampAgentId == agentKey &&
                        request.Type == type &&
                        (request.Status == AvailabilityRequestStatus.Pending ||
                         request.Status == AvailabilityRequestStatus.Approved) &&
                        request.StartsOn <= input.EndsOn && request.EndsOn >= input.StartsOn,
                        cancellationToken))
                    return Fail(HumanResourcesAvailabilityWriteFailure.Conflict);

                var now = clock.GetUtcNow();
                context.AvailabilityRequests.Add(new AvailabilityRequest
                {
                    PublicId = requestId,
                    CreatedAt = now,
                    UpdatedAt = now,
                    RampAgentId = agentKey.Value,
                    StartsOn = input.StartsOn,
                    EndsOn = input.EndsOn,
                    Type = type,
                    Status = AvailabilityRequestStatus.Pending,
                    Reason = input.Reason.Trim(),
                    RequestedAt = now,
                });
                AddAudit(actorKey.Value, requestId, "hr.availability.recorded", now);
                await AddHumanResourcesHintsAsync(requestId, now, cancellationToken);
                await DepartmentNotificationWriter.NotifyAsync(context, Department.HumanResources,
                    "human_resources.availability.decide", "availability_request", requestId, null, now,
                    cancellationToken, exceptAccountId: actorKey.Value);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return HumanResourcesAvailabilityWriteResult.Success(requestId, "Pending");
            });
        }
        catch (DbUpdateException exception) when (
            exception.InnerException is SqlException { Number: 2601 or 2627 })
        {
            context.ChangeTracker.Clear();
            var existing = await context.AvailabilityRequests.AsNoTracking()
                .SingleOrDefaultAsync(request => request.PublicId == requestId,
                    cancellationToken);
            return existing is null
                ? Fail(HumanResourcesAvailabilityWriteFailure.Conflict)
                : await ReplayRecordAsync(existing, actorKey.Value, input, type,
                    cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Fail(HumanResourcesAvailabilityWriteFailure.Conflict);
        }
    }

    public async Task<HumanResourcesAvailabilityWriteResult> ResolveAsync(
        Guid actorId, Guid requestId, ResolveHumanResourcesAvailabilityInput input,
        CancellationToken cancellationToken = default)
    {
        var actorKey = await AuthorizedActorKeyAsync(actorId, "human_resources.availability.decide", cancellationToken);
        if (actorKey is null) return Fail(HumanResourcesAvailabilityWriteFailure.Forbidden);
        var targetStatus = input?.Decision switch
        {
            "Approve" => AvailabilityRequestStatus.Approved,
            "Reject" => AvailabilityRequestStatus.Rejected,
            "Cancel" => AvailabilityRequestStatus.Cancelled,
            _ => (AvailabilityRequestStatus?)null,
        };
        if (requestId == Guid.Empty || targetStatus is null || input!.Note?.Trim().Length > 1000)
            return Fail(HumanResourcesAvailabilityWriteFailure.Invalid);
        var note = Normalize(input.Note);

        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(
                    IsolationLevel.Serializable, cancellationToken);
                var request = await context.AvailabilityRequests
                    .SingleOrDefaultAsync(item => item.PublicId == requestId,
                        cancellationToken);
                if (request is null)
                    return Fail(HumanResourcesAvailabilityWriteFailure.Conflict);
                if (request.Status != AvailabilityRequestStatus.Pending)
                    return await ReplayResolutionAsync(request, actorKey.Value,
                        targetStatus.Value, note, cancellationToken);

                if (targetStatus == AvailabilityRequestStatus.Approved &&
                    request.Type is AvailabilityRequestType.DayOff or
                        AvailabilityRequestType.Restriction)
                {
                    var followingDate = request.EndsOn < DateOnly.MaxValue
                        ? request.EndsOn.AddDays(1) : request.EndsOn;
                    var assignedDates = await (
                        from assignment in context.OperationAgentAssignments.AsNoTracking()
                        join operation in context.GroundOperations.AsNoTracking()
                            on assignment.GroundOperationId equals operation.Id
                        join turnaround in context.Turnarounds.AsNoTracking()
                            on operation.TurnaroundId equals turnaround.Id
                        where assignment.RampAgentId == request.RampAgentId &&
                            assignment.ReleasedAt == null &&
                            turnaround.OperationDate >= request.StartsOn &&
                            turnaround.OperationDate <= followingDate
                        select new { turnaround.OperationDate, turnaround.StationId })
                        .Distinct().ToArrayAsync(cancellationToken);
                    if (assignedDates.Any(item => item.OperationDate <= request.EndsOn))
                        return Fail(HumanResourcesAvailabilityWriteFailure.Conflict);
                    var followingStations = assignedDates
                        .Where(item => item.OperationDate == followingDate)
                        .Select(item => item.StationId).Distinct().ToArray();
                    if (followingStations.Length > 0 && await context.ShiftAssignments
                        .AsNoTracking().AnyAsync(shift =>
                            shift.RampAgentId == request.RampAgentId &&
                            followingStations.Contains(shift.StationId) &&
                            shift.WorkDate == request.EndsOn &&
                            shift.EndsAtLocal < shift.StartsAtLocal,
                            cancellationToken))
                        return Fail(HumanResourcesAvailabilityWriteFailure.Conflict);
                }

                var now = clock.GetUtcNow();
                request.Status = targetStatus.Value;
                request.ResolvedAt = now;
                request.ResolvedByAccountId = actorKey.Value;
                request.ResolutionNote = note;
                request.UpdatedAt = now;
                AddAudit(actorKey.Value, requestId, ResolutionAction(targetStatus.Value), now);
                await AddHumanResourcesHintsAsync(requestId, now, cancellationToken);
                if (targetStatus == AvailabilityRequestStatus.Approved &&
                    request.Type is AvailabilityRequestType.DayOff or
                        AvailabilityRequestType.Restriction)
                    await OccPlanningChangeWriter.AddForAgentAsync(context,
                        request.RampAgentId, request.StartsOn, request.EndsOn,
                        now, cancellationToken);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return HumanResourcesAvailabilityWriteResult.Success(
                    requestId, targetStatus.Value.ToString());
            });
        }
        catch (DbUpdateConcurrencyException)
        {
            return Fail(HumanResourcesAvailabilityWriteFailure.Conflict);
        }
    }

    private async Task<long?> AuthorizedActorKeyAsync(Guid actorId, string permission,
        CancellationToken cancellationToken)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor?.HasPermission(permission) != true ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff)) return null;
        return await context.Users.AsNoTracking().Where(user => user.PublicId == actorId)
            .Select(user => (long?)user.Id).SingleOrDefaultAsync(cancellationToken);
    }

    private async Task<HumanResourcesAvailabilityWriteResult> ReplayRecordAsync(
        AvailabilityRequest existing, long actorKey,
        RecordHumanResourcesAvailabilityInput input, AvailabilityRequestType type,
        CancellationToken cancellationToken)
    {
        var matches = existing.StartsOn == input.StartsOn &&
            existing.EndsOn == input.EndsOn && existing.Type == type &&
            existing.Reason == input.Reason.Trim() &&
            await context.RampAgents.AsNoTracking().AnyAsync(agent =>
                agent.Id == existing.RampAgentId &&
                agent.PublicId == input.RampProfileId, cancellationToken) &&
            await context.AuditEntries.AsNoTracking().AnyAsync(entry =>
                entry.Action == "hr.availability.recorded" &&
                entry.EntityPublicId == existing.PublicId &&
                entry.ActorAccountId == actorKey &&
                entry.CorrelationId == existing.PublicId, cancellationToken);
        return matches
            ? HumanResourcesAvailabilityWriteResult.Success(existing.PublicId,
                existing.Status.ToString())
            : Fail(HumanResourcesAvailabilityWriteFailure.Conflict);
    }

    private async Task<HumanResourcesAvailabilityWriteResult> ReplayResolutionAsync(
        AvailabilityRequest existing, long actorKey,
        AvailabilityRequestStatus status, string? note,
        CancellationToken cancellationToken)
    {
        var action = ResolutionAction(status);
        var matches = existing.Status == status &&
            existing.ResolvedByAccountId == actorKey &&
            existing.ResolutionNote == note &&
            await context.AuditEntries.AsNoTracking().AnyAsync(entry =>
                entry.Action == action && entry.EntityPublicId == existing.PublicId &&
                entry.ActorAccountId == actorKey &&
                entry.CorrelationId == existing.PublicId, cancellationToken);
        return matches
            ? HumanResourcesAvailabilityWriteResult.Success(existing.PublicId,
                status.ToString())
            : Fail(HumanResourcesAvailabilityWriteFailure.Conflict);
    }

    private static string ResolutionAction(AvailabilityRequestStatus status) => status switch
    {
        AvailabilityRequestStatus.Approved => "hr.availability.approved",
        AvailabilityRequestStatus.Cancelled => "hr.availability.cancelled",
        _ => "hr.availability.rejected",
    };

    private void AddAudit(long actorKey, Guid id, string action, DateTimeOffset now) =>
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(),
            OccurredAt = now,
            ActorType = AuditActorType.Account,
            ActorAccountId = actorKey,
            Source = AuditSource.Api,
            CorrelationId = id,
            Action = action,
            EntityType = "hr.availability_requests",
            EntityPublicId = id,
        });

    private async Task AddHumanResourcesHintsAsync(Guid id, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var recipients = await (from link in context.Set<IdentityUserRole<long>>()
            join role in context.Roles on link.RoleId equals role.Id
            where role.NormalizedName == "SUPERADMIN" ||
                  role.NormalizedName == "GESTION_HUMANA"
            select link.UserId).Distinct().ToArrayAsync(cancellationToken);
        foreach (var recipient in recipients)
            AccountChangeOutboxWriter.Add(context, recipient, null,
                "hr_absences", id, now);
    }

    private static bool TryType(string? text, out AvailabilityRequestType type)
    {
        type = text switch
        {
            "DayOff" => AvailabilityRequestType.DayOff,
            "ShiftChange" => AvailabilityRequestType.ShiftChange,
            "Restriction" => AvailabilityRequestType.Restriction,
            _ => default,
        };
        return text is "DayOff" or "ShiftChange" or "Restriction";
    }

    private static string? Normalize(string? note) =>
        string.IsNullOrWhiteSpace(note) ? null : note.Trim();

    private static HumanResourcesAvailabilityWriteResult Fail(
        HumanResourcesAvailabilityWriteFailure failure) =>
        HumanResourcesAvailabilityWriteResult.Failed(failure);
}
