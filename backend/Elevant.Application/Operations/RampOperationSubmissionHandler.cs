using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;

namespace Elevant.Application.Operations;

public sealed class RampOperationSubmissionHandler(
    IActorContextResolver actorResolver,
    IRampOperationSubmissionStore store)
{
    public async Task<RampOperationSubmissionWriteResult> SubmitAsync(
        Guid accountId,
        Guid operationId,
        Guid installationId,
        Guid idempotencyKey,
        string? agentNote,
        string? requestId,
        CancellationToken cancellationToken = default)
    {
        if (accountId == Guid.Empty)
        {
            return RampOperationSubmissionWriteResult.Failed(RampOperationsFailure.Unauthorized);
        }

        if (operationId == Guid.Empty || installationId == Guid.Empty ||
            idempotencyKey == Guid.Empty || !RampOperationSubmissionPolicy.HasValidNote(agentNote))
        {
            return RampOperationSubmissionWriteResult.Failed(RampOperationsFailure.InvalidRequest);
        }

        var actor = await actorResolver.ResolveAsync(accountId, cancellationToken);
        if (!ActorContextValidator.IsValid(actor, accountId))
        {
            return RampOperationSubmissionWriteResult.Failed(RampOperationsFailure.Unauthorized);
        }

        if (!RampOperationsAccess.IsAuthorized(actor!))
        {
            return RampOperationSubmissionWriteResult.Failed(RampOperationsFailure.Forbidden);
        }

        var stationIds = actor!.StationScopes.Select(scope => scope.StationId)
            .Where(id => id != Guid.Empty).Distinct().ToArray();
        if (stationIds.Length == 0)
        {
            return RampOperationSubmissionWriteResult.Failed(RampOperationsFailure.NotFound);
        }

        return await store.SubmitAsync(new RampOperationSubmissionWriteRequest(
            accountId,
            stationIds,
            operationId,
            installationId,
            idempotencyKey,
            string.IsNullOrWhiteSpace(agentNote) ? null : agentNote.Trim(),
            idempotencyKey,
            requestId), cancellationToken);
    }
}
