using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;

namespace Elevant.Application.Operations;

public sealed class RampOperationCorrectionHandler(
    IActorContextResolver actorResolver,
    IRampOperationCorrectionStore store)
{
    public async Task<RampOperationCorrectionWriteResult> ReopenAsync(
        Guid accountId, Guid operationId, Guid installationId,
        Guid idempotencyKey, string? requestId,
        CancellationToken cancellationToken = default)
    {
        if (accountId == Guid.Empty)
            return RampOperationCorrectionWriteResult.Failed(RampOperationsFailure.Unauthorized);
        if (operationId == Guid.Empty || installationId == Guid.Empty || idempotencyKey == Guid.Empty)
            return RampOperationCorrectionWriteResult.Failed(RampOperationsFailure.InvalidRequest);

        var actor = await actorResolver.ResolveAsync(accountId, cancellationToken);
        if (!ActorContextValidator.IsValid(actor, accountId))
            return RampOperationCorrectionWriteResult.Failed(RampOperationsFailure.Unauthorized);
        if (!RampOperationsAccess.IsAuthorized(actor!))
            return RampOperationCorrectionWriteResult.Failed(RampOperationsFailure.Forbidden);
        var stationIds = actor!.StationScopes.Select(scope => scope.StationId)
            .Where(id => id != Guid.Empty).Distinct().ToArray();
        if (stationIds.Length == 0)
            return RampOperationCorrectionWriteResult.Failed(RampOperationsFailure.NotFound);

        return await store.ReopenAsync(new RampOperationCorrectionWriteRequest(
            accountId, stationIds, operationId, installationId, idempotencyKey,
            idempotencyKey, requestId), cancellationToken);
    }
}
