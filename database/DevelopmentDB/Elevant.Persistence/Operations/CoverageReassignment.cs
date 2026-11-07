using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;

using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>
/// ADR-0030: the airport changes stands up to the minute, and the flight follows the agent who
/// covers the new stand. Runs inside the stand change's transaction, before it saves, and only
/// moves an operation that is assigned but not started; the first assignment stays with OCC.
/// </summary>
internal static class CoverageReassignment
{
    /// <summary>An agent never carries more than this many simultaneous operations.</summary>
    public const int MaxSimultaneousOperations = 3;

    public sealed record Outcome(long? ReleasedAgentId, long? AssignedAgentId);

    public static async Task<Outcome> FollowStandAsync(ElevantDbContext context, long turnaroundId, long stationId, long standId,
        long actorAccountId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var operation = await context.GroundOperations
            .Where(item => item.TurnaroundId == turnaroundId && item.CurrentStatus == GroundOperationStatus.Assigned)
            .Select(item => new { item.Id, item.PublicId, item.PlannedStartAt, item.PlannedEndAt })
            .FirstOrDefaultAsync(cancellationToken);
        if (operation is null) return new(null, null);
        var current = await context.OperationAgentAssignments
            .Where(item => item.GroundOperationId == operation.Id && item.ReleasedAt == null)
            .ToArrayAsync(cancellationToken);
        if (current.Length != 1) return new(null, null);

        // The coverage at block time: a primary one first, a reinforcement only if nothing else. An agent who no
        // longer works the ramp or is on an approved absence that day never receives the flight (2-N06, 2-N08).
        var at = operation.PlannedStartAt ?? now;
        var operationDate = await context.Turnarounds.AsNoTracking().Where(item => item.Id == turnaroundId)
            .Select(item => item.OperationDate).SingleAsync(cancellationToken);
        var covering = await (from coverage in context.Set<PositionCoverage>().AsNoTracking()
                              join item in context.Set<PositionCoverageStand>().AsNoTracking()
                                  on coverage.Id equals item.PositionCoverageId
                              join agent in context.RampAgents.AsNoTracking() on coverage.RampAgentId equals agent.Id
                              where item.StandId == standId && coverage.StationId == stationId &&
                                    coverage.ReleasedAt == null && coverage.StartsAt <= at && at < coverage.EndsAt &&
                                    agent.IsActive &&
                                    !context.AvailabilityRequests.Any(request => request.RampAgentId == agent.Id &&
                                        request.Status == AvailabilityRequestStatus.Approved &&
                                        (request.Type == AvailabilityRequestType.DayOff ||
                                         request.Type == AvailabilityRequestType.Restriction) &&
                                        request.StartsOn <= operationDate && request.EndsOn >= operationDate)
                              orderby coverage.IsReinforcement, coverage.CreatedAt
                              select coverage.RampAgentId)
            .FirstOrDefaultAsync(cancellationToken);
        var previous = current[0];
        if (covering == 0 || covering == previous.RampAgentId) return new(null, null);

        if (operation.PlannedStartAt is { } start && operation.PlannedEndAt is { } end &&
            await (from open in context.OperationAgentAssignments.AsNoTracking()
                   join other in context.GroundOperations.AsNoTracking() on open.GroundOperationId equals other.Id
                   where open.RampAgentId == covering && open.ReleasedAt == null &&
                         other.Id != operation.Id &&
                         (other.CurrentStatus == GroundOperationStatus.Assigned ||
                          other.CurrentStatus == GroundOperationStatus.InProgress ||
                          other.CurrentStatus == GroundOperationStatus.Returned) &&
                         other.PlannedStartAt < end && start < other.PlannedEndAt
                   select open.Id).CountAsync(cancellationToken) >= MaxSimultaneousOperations)
            return new(null, null);

        previous.ReleasedAt = now < previous.AssignedAt ? previous.AssignedAt : now;
        previous.UpdatedAt = now;
        var assignment = new OperationAgentAssignment
        {
            PublicId = Guid.CreateVersion7(), GroundOperationId = operation.Id, RampAgentId = covering,
            OperationalPositionId = previous.OperationalPositionId, AssignmentRole = previous.AssignmentRole,
            AssignedAt = now, AssignedByAccountId = actorAccountId, CreatedAt = now, UpdatedAt = now,
        };
        context.OperationAgentAssignments.Add(assignment);
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = now, ActorType = AuditActorType.Account, ActorAccountId = actorAccountId,
            Action = "occ.operation.reassigned_by_stand", EntityType = nameof(GroundOperation), EntityPublicId = operation.PublicId,
            StationId = stationId, Source = AuditSource.Api, CorrelationId = Guid.CreateVersion7(),
            Reason = "The flight follows the agent covering its new stand.",
        });
        await OperationalNotificationWriter.NotifyAgentAsync(context, previous.RampAgentId, stationId, operation.Id,
            previous.PublicId, "assignment_released", now, cancellationToken);
        await OperationalNotificationWriter.NotifyAgentAsync(context, covering, stationId, operation.Id,
            assignment.PublicId, "operation_assigned", now, cancellationToken);
        await RampOperationChangeWriter.AnnounceAsync(context, operation.Id, now, false, cancellationToken,
            previous.RampAgentId, covering);
        return new(previous.RampAgentId, covering);
    }
}
