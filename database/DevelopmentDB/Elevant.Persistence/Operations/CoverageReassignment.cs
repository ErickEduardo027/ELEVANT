using Elevant.Application.Operations;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;

using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>
/// ADR-0030: the airport changes stands up to the minute, and the flight follows the agent who covers the new stand.
/// Runs inside the stand change's transaction, before it saves, and only moves an operation that is assigned but not
/// started; the first assignment stays with OCC. 3-N05: the agents who cover the new stand, and the agent the flight
/// had, are evaluated with the manual assignment's rules (<see cref="OccAgentEligibilityPolicy"/>) at the operation's
/// local date: documents, terminal scope, shift in that terminal, absences, mobile account, mentor and the three
/// simultaneous operations. The first eligible covering agent receives the flight; otherwise an eligible previous agent
/// keeps it; otherwise nobody may work it there, so the operation goes back to Planned and OCC is told
/// (<see cref="UnassignedKind"/>) to reassign it.
/// </summary>
internal static class CoverageReassignment
{
    /// <summary>Operational notice to OCC: the stand change left the operation without an eligible agent.</summary>
    public const string UnassignedKind = "stand_change_unassigned";

    public sealed record Outcome(long? ReleasedAgentId, long? AssignedAgentId);

    public static async Task<Outcome> FollowStandAsync(ElevantDbContext context, TimeProvider timeProvider, long turnaroundId,
        long stationId, long standId, long actorAccountId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var operation = await context.GroundOperations
            .Where(item => item.TurnaroundId == turnaroundId && item.CurrentStatus == GroundOperationStatus.Assigned)
            .FirstOrDefaultAsync(cancellationToken);
        if (operation is null) return new(null, null);
        var current = await context.OperationAgentAssignments
            .Where(item => item.GroundOperationId == operation.Id && item.ReleasedAt == null)
            .ToArrayAsync(cancellationToken);
        if (current.Length != 1) return new(null, null);
        var previous = current[0];

        var flight = await (from turnaround in context.Turnarounds.AsNoTracking()
                            join station in context.Stations.AsNoTracking() on turnaround.StationId equals station.Id
                            where turnaround.Id == turnaroundId
                            select new { turnaround.OperationDate, turnaround.AirlineId, station.IanaTimeZone })
            .SingleAsync(cancellationToken);
        var terminalId = await context.Stands.AsNoTracking().Where(item => item.Id == standId)
            .Select(item => item.TerminalId).SingleAsync(cancellationToken);

        // The coverages of the new stand at block time: the primary ones first, the reinforcements after.
        var at = operation.PlannedStartAt ?? now;
        var covering = (await (from coverage in context.Set<PositionCoverage>().AsNoTracking()
                               join item in context.Set<PositionCoverageStand>().AsNoTracking()
                                   on coverage.Id equals item.PositionCoverageId
                               where item.StandId == standId && coverage.StationId == stationId &&
                                     coverage.ReleasedAt == null && coverage.StartsAt <= at && at < coverage.EndsAt
                               orderby coverage.IsReinforcement, coverage.CreatedAt
                               select coverage.RampAgentId)
                .ToArrayAsync(cancellationToken))
            .Distinct().ToArray();

        // The same facts and rules as the manual assignment, for these agents only (3-N05).
        var candidates = await new EfOccPlanningReadStore(context, timeProvider).BuildAgentCandidatesAsync(operation.Id,
            stationId, terminalId, flight.OperationDate, at, operation.PlannedStartAt, operation.PlannedEndAt,
            flight.IanaTimeZone, [.. covering, previous.RampAgentId], cancellationToken);
        var eligible = candidates
            .Where(candidate => candidate.Data.OperationalPositionId is not null &&
                OccAgentEligibilityPolicy.Evaluate(candidate.Data).Eligible)
            .ToDictionary(candidate => candidate.AgentId);
        if (covering.Contains(previous.RampAgentId) && eligible.ContainsKey(previous.RampAgentId)) return new(null, null);

        var correlation = Guid.CreateVersion7();
        var target = covering.FirstOrDefault(agent => agent != previous.RampAgentId && eligible.ContainsKey(agent));
        if (target != 0)
        {
            var positionId = await context.OperationalPositions.AsNoTracking()
                .Where(item => item.PublicId == eligible[target].Data.OperationalPositionId)
                .Select(item => (long?)item.Id).SingleOrDefaultAsync(cancellationToken);
            await RampAgentRelease.ReplaceAgentAsync(context, operation, previous, target, positionId, stationId,
                flight.AirlineId, actorAccountId, "El vuelo sigue al agente que cubre su nueva posición.",
                "occ.operation.reassigned_by_stand", correlation, now, cancellationToken);
            return new(previous.RampAgentId, target);
        }

        // Nobody covering the new stand may take it: the agent it had keeps it when they still may work it there.
        if (eligible.ContainsKey(previous.RampAgentId)) return new(null, null);
        await RampAgentRelease.ReleaseOperationAsync(context, operation, [previous], stationId, flight.AirlineId,
            actorAccountId, "el cambio de posición dejó la operación sin un agente elegible",
            "occ.operation.unassigned_by_stand", null, correlation, now, cancellationToken);
        // Every OCC of the station hears it, the one who moved the flight too: the release is a consequence of the move.
        await OperationalNotificationWriter.NotifyOccAsync(context, stationId, operation.Id, previous.PublicId, UnassignedKind,
            now, null, cancellationToken);
        return new(previous.RampAgentId, null);
    }
}
