using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;

namespace Elevant.Application.Operations.GetRampAssignedOperations;

public sealed class GetRampAssignedOperationsHandler(
    IActorContextResolver actorContextResolver,
    IRampOperationsReadStore readStore)
{
    public async Task<GetRampAssignedOperationsResult> HandleAsync(
        GetRampAssignedOperationsQuery query,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);
        cancellationToken.ThrowIfCancellationRequested();

        if (query.AccountId == Guid.Empty)
        {
            return GetRampAssignedOperationsResult.Failed(RampOperationsFailure.Unauthorized);
        }

        var actor = await actorContextResolver.ResolveAsync(query.AccountId, cancellationToken);
        if (!ActorContextValidator.IsValid(actor, query.AccountId))
        {
            return GetRampAssignedOperationsResult.Failed(RampOperationsFailure.Unauthorized);
        }

        if (!RampOperationsAccess.IsAuthorized(actor!))
        {
            return GetRampAssignedOperationsResult.Failed(RampOperationsFailure.Forbidden);
        }

        var allowedStationIds = actor!.StationScopes
            .Select(scope => scope.StationId)
            .Distinct()
            .ToArray();

        var readResult = await readStore.GetActiveAssignedOperationsAsync(
            query.AccountId,
            allowedStationIds,
            cancellationToken);

        return readResult.IsSuccess
            ? GetRampAssignedOperationsResult.Success(readResult.Operations!)
            : GetRampAssignedOperationsResult.Failed(RampOperationsFailure.Forbidden);
    }
}
