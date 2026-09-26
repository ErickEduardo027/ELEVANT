using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Commercial;

/// <summary>Derives the sole airline tenant from live, server-owned identity state.</summary>
internal static class AirlinePortalAccess
{
    public static (Guid? OrganizationId, AirlinePortalFailure? Failure) Resolve(
        ActorContext? actor, Guid accountId)
    {
        if (accountId == Guid.Empty || !ActorContextValidator.IsValid(actor, accountId))
            return (null, AirlinePortalFailure.Unauthorized);

        if (!actor!.Roles.Any(role => role.Code == "AIRLINE_CLIENT" &&
            role.Portal == PortalKind.AirlinePortal))
            return (null, AirlinePortalFailure.Forbidden);

        var organizations = actor.Memberships
            .Where(membership => membership.OrganizationType == OrganizationType.AirlineCustomer &&
                membership.Kind == MembershipKind.AirlineClient)
            .Select(membership => membership.OrganizationId)
            .Distinct().ToArray();
        return organizations.Length == 1 && organizations[0] != Guid.Empty
            ? (organizations[0], null)
            : (null, AirlinePortalFailure.Forbidden);
    }
}
