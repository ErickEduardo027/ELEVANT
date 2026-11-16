using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Common;

namespace Elevant.Application.Commercial;

/// <summary>
/// Where the authenticated airline stands with AVIAM (2-N32): resolved from server-side identity, never
/// from the client, and dated by AVIAM's business day (2-F).
/// </summary>
public sealed class GetAirlinePortalStandingHandler(
    IActorContextResolver actorContextResolver,
    IAirlinePortalStandingStore store,
    TimeProvider timeProvider)
{
    public async Task<AirlinePortalStandingResult> HandleAsync(Guid accountId, CancellationToken cancellationToken = default)
    {
        var actor = await actorContextResolver.ResolveAsync(accountId, cancellationToken);
        var (organizationId, failure) = AirlinePortalAccess.Resolve(actor, accountId);
        if (failure is not null) return AirlinePortalStandingResult.Failed(failure.Value);

        var standing = await store.GetStandingAsync(organizationId!.Value,
            BusinessCalendar.Today(timeProvider.GetUtcNow()), cancellationToken);
        return standing is null || standing.OrganizationId != organizationId
            ? AirlinePortalStandingResult.Failed(AirlinePortalFailure.NotFound)
            : AirlinePortalStandingResult.Success(standing);
    }
}
