using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;

namespace Elevant.Application.Commercial;

public sealed class GetAirlineOperationalRequestsHandler(
    IActorContextResolver actors, IAirlinePortalReadStore requests)
{
    public async Task<AirlineOperationalRequestPageResult> HandleAsync(
        Guid accountId, int page, int limit, CancellationToken cancellationToken = default)
    {
        if (page is < 1 or > 10_000 || limit is < 1 or > 50)
            throw new ArgumentOutOfRangeException(nameof(page));

        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        var (organizationId, failure) = AirlinePortalAccess.Resolve(actor, accountId);
        if (failure is not null)
            return AirlineOperationalRequestPageResult.Failed(failure.Value);

        var result = await requests.GetRequestsAsync(
            organizationId!.Value, page, limit, cancellationToken);
        return result is null
            ? AirlineOperationalRequestPageResult.Failed(AirlinePortalFailure.NotFound)
            : AirlineOperationalRequestPageResult.Success(result);
    }
}
