using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;

namespace Elevant.Application.Commercial;

/// <summary>Resolves one airline tenant and its contracted stations from server-side state.</summary>
public sealed class GetAirlinePortalBootstrapHandler(
    IActorContextResolver actorContextResolver,
    IAirlinePortalReadStore readStore,
    TimeProvider timeProvider)
{
    public async Task<AirlinePortalBootstrapResult> HandleAsync(
        Guid accountId,
        CancellationToken cancellationToken = default)
    {
        var actor = await actorContextResolver.ResolveAsync(accountId, cancellationToken);
        var (organizationId, failure) = AirlinePortalAccess.Resolve(actor, accountId);
        if (failure is not null)
            return AirlinePortalBootstrapResult.Failed(failure.Value);

        var onDate = DateOnly.FromDateTime(timeProvider.GetUtcNow().UtcDateTime);
        var bootstrap = await readStore.GetBootstrapAsync(
            organizationId!.Value, onDate, cancellationToken);
        return bootstrap is null || bootstrap.OrganizationId != organizationId
            ? AirlinePortalBootstrapResult.Failed(AirlinePortalFailure.NotFound)
            : AirlinePortalBootstrapResult.Success(bootstrap);
    }
}
