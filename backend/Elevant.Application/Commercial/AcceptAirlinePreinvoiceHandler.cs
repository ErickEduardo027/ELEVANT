using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;

namespace Elevant.Application.Commercial;

public sealed record AcceptAirlinePreinvoiceCommand(
    Guid AccountId, Guid OrganizationId, Guid PreinvoiceId, Guid RequestId);

public enum AcceptAirlinePreinvoiceFailure
{
    Unauthorized,
    Forbidden,
    InvalidRequest,
    NotFound,
    Conflict,
}

public sealed record AcceptAirlinePreinvoiceResult(
    Guid? PreinvoiceId, bool Replayed, AcceptAirlinePreinvoiceFailure? Failure)
{
    public bool IsSuccess => PreinvoiceId.HasValue && Failure is null;
    public static AcceptAirlinePreinvoiceResult Success(Guid id, bool replayed) =>
        new(id, replayed, null);
    public static AcceptAirlinePreinvoiceResult Failed(AcceptAirlinePreinvoiceFailure failure) =>
        new(null, false, failure);
}

public sealed class AcceptAirlinePreinvoiceHandler(
    IActorContextResolver actors, IAirlinePreinvoiceAcceptanceStore store)
{
    public async Task<AcceptAirlinePreinvoiceResult> HandleAsync(
        Guid accountId, Guid preinvoiceId, Guid requestId,
        CancellationToken cancellationToken = default)
    {
        if (accountId == Guid.Empty)
            return AcceptAirlinePreinvoiceResult.Failed(
                AcceptAirlinePreinvoiceFailure.Unauthorized);
        if (preinvoiceId == Guid.Empty || requestId == Guid.Empty)
            return AcceptAirlinePreinvoiceResult.Failed(
                AcceptAirlinePreinvoiceFailure.InvalidRequest);
        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        var (organizationId, failure) = AirlinePortalAccess.Resolve(actor, accountId);
        if (failure is not null)
            return AcceptAirlinePreinvoiceResult.Failed(failure.Value switch
            {
                AirlinePortalFailure.Unauthorized => AcceptAirlinePreinvoiceFailure.Unauthorized,
                _ => AcceptAirlinePreinvoiceFailure.Forbidden,
            });
        return await store.AcceptAsync(new AcceptAirlinePreinvoiceCommand(
            accountId, organizationId!.Value, preinvoiceId, requestId), cancellationToken);
    }
}
