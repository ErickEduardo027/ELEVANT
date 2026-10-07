using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;

namespace Elevant.Application.Operations.GetManualTurnaroundOptions;

public sealed class GetManualTurnaroundOptionsHandler(
    IActorContextResolver actorContextResolver,
    IManualTurnaroundOptionsStore store)
{
    public async Task<GetManualTurnaroundOptionsResult> HandleAsync(
        GetManualTurnaroundOptionsQuery query,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);
        if (query.AccountId == Guid.Empty)
            return GetManualTurnaroundOptionsResult.Failed(OccPlanningFailure.Unauthorized);
        if (query.StationId == Guid.Empty || query.Date == default)
            return GetManualTurnaroundOptionsResult.Failed(OccPlanningFailure.InvalidRequest);

        var actor = await actorContextResolver.ResolveAsync(query.AccountId, cancellationToken);
        if (!ActorContextValidator.IsValid(actor, query.AccountId))
            return GetManualTurnaroundOptionsResult.Failed(OccPlanningFailure.Unauthorized);
        if (!OccPlanningAccess.IsAuthorized(actor!, "operations.planning.manage"))
            return GetManualTurnaroundOptionsResult.Failed(OccPlanningFailure.Forbidden);
        if (!actor!.StationScopes.Any(scope => scope.StationId == query.StationId))
            return GetManualTurnaroundOptionsResult.Failed(OccPlanningFailure.NotFound);

        var options = await store.GetAsync(query.AccountId, query.StationId, query.Date,
            cancellationToken);
        return options is null
            ? GetManualTurnaroundOptionsResult.Failed(OccPlanningFailure.NotFound)
            : GetManualTurnaroundOptionsResult.Success(options);
    }
}
