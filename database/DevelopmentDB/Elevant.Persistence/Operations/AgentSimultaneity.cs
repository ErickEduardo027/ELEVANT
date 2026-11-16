using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>
/// How many operations already occupy each agent in a window (<see cref="OperationOccupancyRules"/>, 3-D): open
/// assignments of other operations that hold the agent (assigned, in progress or returned) whose planned window
/// overlaps it. An operation that holds the agent without a valid window counts as overlapping, so the rule fails
/// closed. The one count planning, the stand reassignment, the handover and the reschedule of a flight compare with
/// <see cref="OperationOccupancyRules.MaxSimultaneousOperations"/>.
/// </summary>
internal static class AgentSimultaneity
{
    /// <summary>
    /// The overlapping operations of each agent in the window; <paramref name="excludeOperationId"/> is the operation
    /// being placed, which never counts against itself.
    /// </summary>
    public static async Task<IReadOnlyDictionary<long, int>> CountOverlapsAsync(ElevantDbContext context,
        IReadOnlyCollection<long> agentIds, long? excludeOperationId, DateTimeOffset start, DateTimeOffset end,
        CancellationToken cancellationToken)
    {
        if (agentIds.Count == 0) return new Dictionary<long, int>();
        var ids = agentIds.Distinct().ToArray();
        var agents = await (from open in context.OperationAgentAssignments.AsNoTracking()
                            join other in context.GroundOperations.AsNoTracking() on open.GroundOperationId equals other.Id
                            where ids.Contains(open.RampAgentId) && open.ReleasedAt == null &&
                                  (excludeOperationId == null || other.Id != excludeOperationId) &&
                                  // Enums stored as text: explicit comparisons, never an array Contains.
                                  (other.CurrentStatus == GroundOperationStatus.Assigned ||
                                   other.CurrentStatus == GroundOperationStatus.InProgress ||
                                   other.CurrentStatus == GroundOperationStatus.Returned) &&
                                  (other.PlannedStartAt == null || other.PlannedEndAt == null ||
                                   other.PlannedStartAt >= other.PlannedEndAt ||
                                   (other.PlannedStartAt < end && start < other.PlannedEndAt))
                            select open.RampAgentId)
            .ToArrayAsync(cancellationToken);
        return agents.GroupBy(agent => agent).ToDictionary(group => group.Key, group => group.Count());
    }
}
