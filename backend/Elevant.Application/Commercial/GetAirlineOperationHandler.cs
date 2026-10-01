using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;

namespace Elevant.Application.Commercial;

public sealed class GetAirlineOperationHandler(
    IActorContextResolver actors, IAirlinePortalReadStore operations)
{
    public async Task<AirlineOperationDetailResult> HandleAsync(
        Guid accountId, Guid operationId, CancellationToken cancellationToken = default)
    {
        if (operationId == Guid.Empty)
            return AirlineOperationDetailResult.Failed(AirlinePortalFailure.NotFound);

        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        var (organizationId, failure) = AirlinePortalAccess.Resolve(actor, accountId);
        if (failure is not null) return AirlineOperationDetailResult.Failed(failure.Value);

        var operation = await operations.GetOperationAsync(
            organizationId!.Value, operationId, cancellationToken);
        return operation is null
            ? AirlineOperationDetailResult.Failed(AirlinePortalFailure.NotFound)
            : AirlineOperationDetailResult.Success(operation);
    }

    public async Task<AirlineApprovedOperationEvidenceResult> HandleEvidenceAsync(
        Guid accountId, Guid operationId, CancellationToken cancellationToken = default)
    {
        if (operationId == Guid.Empty)
            return AirlineApprovedOperationEvidenceResult.Failed(AirlinePortalFailure.NotFound);

        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        var (organizationId, failure) = AirlinePortalAccess.Resolve(actor, accountId);
        if (failure is not null)
            return AirlineApprovedOperationEvidenceResult.Failed(failure.Value);

        var evidence = await operations.GetApprovedOperationEvidenceAsync(
            organizationId!.Value, operationId, cancellationToken);
        return evidence is null
            ? AirlineApprovedOperationEvidenceResult.Failed(AirlinePortalFailure.NotFound)
            : AirlineApprovedOperationEvidenceResult.Success(evidence);
    }
}
