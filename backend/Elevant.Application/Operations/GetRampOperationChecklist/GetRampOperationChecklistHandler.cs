using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;

namespace Elevant.Application.Operations.GetRampOperationChecklist;

public sealed class GetRampOperationChecklistHandler(
    IActorContextResolver actorContextResolver,
    IRampOperationChecklistReadStore readStore)
{
    public async Task<GetRampOperationChecklistResult> HandleAsync(
        GetRampOperationChecklistQuery query,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);
        cancellationToken.ThrowIfCancellationRequested();

        if (query.AccountId == Guid.Empty)
        {
            return GetRampOperationChecklistResult.Failed(
                RampOperationsFailure.Unauthorized);
        }

        if (query.OperationId == Guid.Empty)
        {
            return GetRampOperationChecklistResult.Failed(
                RampOperationsFailure.InvalidRequest);
        }

        var actor = await actorContextResolver.ResolveAsync(
            query.AccountId,
            cancellationToken);
        if (!ActorContextValidator.IsValid(actor, query.AccountId))
        {
            return GetRampOperationChecklistResult.Failed(
                RampOperationsFailure.Unauthorized);
        }

        if (!RampOperationsAccess.IsAuthorized(actor!))
        {
            return GetRampOperationChecklistResult.Failed(
                RampOperationsFailure.Forbidden);
        }

        var stationIds = DistinctStationIds(actor!);
        if (stationIds.Length == 0)
        {
            return GetRampOperationChecklistResult.Failed(
                RampOperationsFailure.NotFound);
        }

        var result = await readStore.GetChecklistAsync(
            new RampOperationChecklistReadRequest(
                query.AccountId,
                stationIds,
                query.OperationId),
            cancellationToken);

        return result.IsSuccess
            ? GetRampOperationChecklistResult.Success(result.Checklist!)
            : GetRampOperationChecklistResult.Failed(result.Failure switch
            {
                RampOperationChecklistReadFailure.AgentProfileUnavailable =>
                    RampOperationsFailure.Forbidden,
                RampOperationChecklistReadFailure.NotFound =>
                    RampOperationsFailure.NotFound,
                RampOperationChecklistReadFailure.Conflict =>
                    RampOperationsFailure.Conflict,
                _ => throw new InvalidOperationException(
                    "Unsupported ramp checklist read failure."),
            });
    }

    private static Guid[] DistinctStationIds(ActorContext actor) =>
        actor.StationScopes
            .Select(scope => scope.StationId)
            .Where(id => id != Guid.Empty)
            .Distinct()
            .ToArray();
}
