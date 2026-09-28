using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;

namespace Elevant.Application.Commercial;

public sealed class GetAirlinePreinvoicesHandler(
    IActorContextResolver actors, IAirlinePortalReadStore preinvoices)
{
    public async Task<AirlinePreinvoiceDetailResult> HandleDetailAsync(
        Guid accountId, Guid preinvoiceId, CancellationToken cancellationToken = default)
    {
        if (preinvoiceId == Guid.Empty)
            return AirlinePreinvoiceDetailResult.Failed(AirlinePortalFailure.NotFound);
        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        var (organizationId, failure) = AirlinePortalAccess.Resolve(actor, accountId);
        if (failure is not null)
            return AirlinePreinvoiceDetailResult.Failed(failure.Value);
        var detail = await preinvoices.GetPreinvoiceAsync(
            organizationId!.Value, preinvoiceId, cancellationToken);
        return detail is null
            ? AirlinePreinvoiceDetailResult.Failed(AirlinePortalFailure.NotFound)
            : AirlinePreinvoiceDetailResult.Success(detail);
    }

    public async Task<AirlinePreinvoicePageResult> HandleAsync(
        Guid accountId, int page, int limit, CancellationToken cancellationToken = default)
    {
        if (page is < 1 or > 10_000 || limit is < 1 or > 50)
            throw new ArgumentOutOfRangeException(nameof(page));

        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        var (organizationId, failure) = AirlinePortalAccess.Resolve(actor, accountId);
        if (failure is not null)
            return AirlinePreinvoicePageResult.Failed(failure.Value);

        var result = await preinvoices.GetPreinvoicesAsync(
            organizationId!.Value, page, limit, cancellationToken);
        return result is null
            ? AirlinePreinvoicePageResult.Failed(AirlinePortalFailure.NotFound)
            : AirlinePreinvoicePageResult.Success(result);
    }
}
