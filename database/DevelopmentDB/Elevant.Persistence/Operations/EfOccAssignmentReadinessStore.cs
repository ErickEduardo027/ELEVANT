using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>
/// 2-N25: the planning board marks an assigned agent who cannot do the operation on its date — inactive, on an
/// approved absence, or without a current airport permit or ramp licence. A projection read with the board; OCC
/// decides what to do, nothing is released here.
/// </summary>
internal sealed class EfOccAssignmentReadinessStore(ElevantDbContext context, IActorContextResolver actors)
    : IOccAssignmentReadinessStore
{
    private const string ReadPermission = "operations.planning.read";

    public async Task<OccAssignmentReadinessResult> ReadAsync(Guid actorId, Guid stationId, DateOnly operationDate,
        CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor is null || !actor.HasPermission(ReadPermission) ||
            !actor.Memberships.Any(membership => membership.Kind == MembershipKind.InternalStaff &&
                membership.OrganizationType == OrganizationType.AviamOperator))
            return new OccAssignmentReadinessResult(null, OccAssignmentReadinessFailure.Forbidden);
        if (actor.StationScopes.All(scope => scope.StationId != stationId))
            return new OccAssignmentReadinessResult(null, OccAssignmentReadinessFailure.NotFound);
        var station = await context.Stations.AsNoTracking().Where(item => item.PublicId == stationId && item.IsActive)
            .Select(item => (long?)item.Id).SingleOrDefaultAsync(cancellationToken);
        if (station is null) return new OccAssignmentReadinessResult(null, OccAssignmentReadinessFailure.NotFound);

        var rows = await (from assignment in context.OperationAgentAssignments.AsNoTracking()
                          join operation in context.GroundOperations.AsNoTracking()
                              on assignment.GroundOperationId equals operation.Id
                          join turnaround in context.Turnarounds.AsNoTracking() on operation.TurnaroundId equals turnaround.Id
                          join agent in context.RampAgents.AsNoTracking() on assignment.RampAgentId equals agent.Id
                          where turnaround.StationId == station && turnaround.OperationDate == operationDate &&
                                assignment.ReleasedAt == null &&
                                (operation.CurrentStatus == GroundOperationStatus.Assigned ||
                                 operation.CurrentStatus == GroundOperationStatus.InProgress ||
                                 operation.CurrentStatus == GroundOperationStatus.Returned)
                          orderby turnaround.OperationCode, assignment.AssignedAt
                          select new { AssignmentId = assignment.PublicId, TurnaroundId = turnaround.PublicId,
                              TurnaroundKey = turnaround.Id, AgentKey = agent.Id, AgentId = agent.PublicId, agent.IsActive })
            .ToArrayAsync(cancellationToken);
        if (rows.Length == 0)
            return new OccAssignmentReadinessResult(new OccAssignmentReadinessData(stationId, operationDate, []), null);

        var agentKeys = rows.Select(row => row.AgentKey).Distinct().ToArray();
        var absent = (await context.AvailabilityRequests.AsNoTracking()
                .Where(request => agentKeys.Contains(request.RampAgentId) &&
                    request.Status == AvailabilityRequestStatus.Approved &&
                    (request.Type == AvailabilityRequestType.DayOff || request.Type == AvailabilityRequestType.Restriction) &&
                    request.StartsOn <= operationDate && request.EndsOn >= operationDate)
                .Select(request => request.RampAgentId).Distinct().ToArrayAsync(cancellationToken))
            .ToHashSet();
        var current = (await context.AirportPermitCycles.AsNoTracking()
                .Where(cycle => agentKeys.Contains(cycle.RampAgentId) && cycle.IsCurrent && cycle.IssuedOn <= operationDate &&
                    cycle.ExpiresOn >= operationDate)
                .Select(cycle => new { cycle.RampAgentId, cycle.DocumentType }).Distinct().ToArrayAsync(cancellationToken))
            .Select(cycle => (cycle.RampAgentId, cycle.DocumentType)).ToHashSet();
        // ADR-0045: the permits the flight's current stand requires.
        var turnaroundKeys = rows.Select(row => row.TurnaroundKey).Distinct().ToArray();
        var standOf = (await context.Set<Elevant.Domain.Entities.Operations.StandAssignment>().AsNoTracking()
                .Where(item => turnaroundKeys.Contains(item.TurnaroundId) && item.AssignedTo == null)
                .Select(item => new { item.TurnaroundId, item.StandId }).ToArrayAsync(cancellationToken))
            .GroupBy(item => item.TurnaroundId).ToDictionary(group => group.Key, group => group.First().StandId);
        var required = await EfOccPlanningReadStore.RequiredPermitsAsync(context, standOf.Values.ToArray(),
            cancellationToken);

        var unfit = new List<OccUnfitAssignmentData>();
        foreach (var row in rows)
        {
            var reasons = new List<string>(4);
            if (!row.IsActive) reasons.Add("agent_inactive");
            if (absent.Contains(row.AgentKey)) reasons.Add("approved_absence");
            if (!current.Contains((row.AgentKey, PermitDocumentTypes.AirportId)))
                reasons.Add("airport_id_not_current");
            if (!current.Contains((row.AgentKey, PermitDocumentTypes.RampDriverLicense)))
                reasons.Add("ramp_driver_license_not_current");
            var missing = standOf.TryGetValue(row.TurnaroundKey, out var standId) &&
                          required.TryGetValue(standId, out var permits)
                ? RequiredPermitRules.Missing(permits, current.Where(item => item.RampAgentId == row.AgentKey)
                    .Select(item => item.DocumentType).ToArray())
                : [];
            if (missing.Count > 0) reasons.Add("required_permit_missing");
            if (reasons.Count > 0)
                unfit.Add(new OccUnfitAssignmentData(row.AssignmentId, row.TurnaroundId, row.AgentId, reasons,
                    missing.Count == 0 ? null : missing.Select(permit => permit.Name).ToArray()));
        }
        return new OccAssignmentReadinessResult(new OccAssignmentReadinessData(stationId, operationDate, unfit), null);
    }
}
