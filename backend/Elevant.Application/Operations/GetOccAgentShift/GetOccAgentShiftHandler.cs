using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;

namespace Elevant.Application.Operations.GetOccAgentShift;

/// <summary>
/// 3-E: OCC reads the shift an agent already has on the flight's day, to adjust it from planning instead of programming
/// a second one (one shift per agent and day, ADR-0026). Same permission as programming it.
/// </summary>
public sealed class GetOccAgentShiftHandler(
    IActorContextResolver actorContextResolver,
    IOccShiftProgrammingStore store)
{
    public async Task<GetOccAgentShiftResult> HandleAsync(
        GetOccAgentShiftQuery query,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);
        cancellationToken.ThrowIfCancellationRequested();
        if (query.AccountId == Guid.Empty)
            return GetOccAgentShiftResult.Failed(OccPlanningFailure.Unauthorized);
        if (query.TurnaroundId == Guid.Empty || query.AgentId == Guid.Empty)
            return GetOccAgentShiftResult.Failed(OccPlanningFailure.InvalidRequest);

        var actor = await actorContextResolver.ResolveAsync(query.AccountId, cancellationToken);
        if (!ActorContextValidator.IsValid(actor, query.AccountId))
            return GetOccAgentShiftResult.Failed(OccPlanningFailure.Unauthorized);
        if (!OccPlanningAccess.IsAuthorized(actor!, "operations.planning.assign"))
            return GetOccAgentShiftResult.Failed(OccPlanningFailure.Forbidden);

        var stations = actor!.StationScopes.Select(scope => scope.StationId)
            .Where(id => id != Guid.Empty).Distinct().ToArray();
        if (stations.Length == 0)
            return GetOccAgentShiftResult.Failed(OccPlanningFailure.NotFound);

        var result = await store.GetAgentShiftAsync(new OccAgentShiftReadRequest(
            query.AccountId, stations, query.TurnaroundId, query.AgentId), cancellationToken);
        return result.Failure switch
        {
            null => GetOccAgentShiftResult.Success(result.Shift!),
            OccAgentShiftReadFailure.ShiftNotFound => GetOccAgentShiftResult.Failed(OccPlanningFailure.NotFound, "shift_not_found"),
            _ => GetOccAgentShiftResult.Failed(OccPlanningFailure.NotFound),
        };
    }
}
