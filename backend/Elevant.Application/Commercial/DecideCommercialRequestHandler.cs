using Elevant.Application.Abstractions.Commercial;

namespace Elevant.Application.Commercial;

/// <summary>
/// Contratos' decision on a request. An approval first checks the linked airline against the public
/// registries (ADR-0023) and stores the verdict on the request, so the inbox explains a refusal; the
/// store then refuses NotFound, Defunct and Mismatch unless Superadministración verified the profile by
/// hand with an official source. A profile verified that way is not sent to the registries. An approval
/// stores its verdict on the request; a refused one stores it afterwards, so the 409 re-read shows it.
/// </summary>
public sealed class DecideCommercialRequestHandler(ICommercialWorkflowStore store, IAirlineRegistryLookup registry)
{
    public async Task<CommercialWorkflowResult> HandleAsync(Guid actorId, Guid requestId, ReviewCommercialInput input,
        Guid? idempotencyKey, CancellationToken cancellationToken = default)
    {
        CommercialRegistryGate? gate = null;
        if (input?.Approve == true &&
            await store.RegistrySubjectAsync(actorId, requestId, cancellationToken) is { } subject)
        {
            AirlineRegistryCheck? check = null;
            if (!subject.ManuallyVerifiedBySuperAdministrator)
            {
                check = await AirlineRegistryChecks.RunAsync(registry, subject.Name, subject.IataCode, subject.IcaoCode,
                    cancellationToken);
            }
            gate = new CommercialRegistryGate(subject, check);
        }
        var result = await store.DecideAsync(actorId, requestId, input!, idempotencyKey, cancellationToken, gate);
        if (result.Failure == CommercialWorkflowFailure.AirlineNotInPublicRegistry && gate?.Check is { } verdict)
            await store.RecordRegistryCheckAsync(requestId, gate.Subject, verdict, cancellationToken);
        return result;
    }
}
