using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;

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
        if (accountId == Guid.Empty)
        {
            return AirlinePortalBootstrapResult.Failed(AirlinePortalFailure.Unauthorized);
        }

        var actor = await actorContextResolver.ResolveAsync(accountId, cancellationToken);
        if (!ActorContextValidator.IsValid(actor, accountId))
        {
            return AirlinePortalBootstrapResult.Failed(AirlinePortalFailure.Unauthorized);
        }

        if (!actor!.Roles.Any(role => role.Code == "AIRLINE_CLIENT" && role.Portal == PortalKind.AirlinePortal))
        {
            return AirlinePortalBootstrapResult.Failed(AirlinePortalFailure.Forbidden);
        }

        var airlineOrganizations = actor.Memberships
            .Where(membership =>
                membership.OrganizationType == OrganizationType.AirlineCustomer &&
                membership.Kind == MembershipKind.AirlineClient)
            .Select(membership => membership.OrganizationId)
            .Distinct()
            .ToArray();

        // The first portal release does not permit choosing among multiple tenants.
        if (airlineOrganizations.Length != 1 || airlineOrganizations[0] == Guid.Empty)
        {
            return AirlinePortalBootstrapResult.Failed(AirlinePortalFailure.Forbidden);
        }

        var onDate = DateOnly.FromDateTime(timeProvider.GetUtcNow().UtcDateTime);
        var bootstrap = await readStore.GetBootstrapAsync(
            airlineOrganizations[0], onDate, cancellationToken);
        return bootstrap is null || bootstrap.OrganizationId != airlineOrganizations[0]
            ? AirlinePortalBootstrapResult.Failed(AirlinePortalFailure.NotFound)
            : AirlinePortalBootstrapResult.Success(bootstrap);
    }
}
