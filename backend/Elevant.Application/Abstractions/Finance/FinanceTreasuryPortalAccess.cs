using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;
namespace Elevant.Application.Abstractions.Finance;
/// <summary>Derives the sole customer tenant from live actor state; never from a route, body or query string.</summary>
public static class FinanceTreasuryPortalAccess
{
    public static Guid? OrganizationId(ActorContext? actor, Guid accountId)
    {
        if (accountId == Guid.Empty || actor?.AccountId != accountId ||
            actor.Roles is null || !actor.Roles.Any(r => r.Code == "AIRLINE_CLIENT" && r.Portal == PortalKind.AirlinePortal) ||
            actor.Memberships is null) return null;
        var ids = actor.Memberships.Where(m => m.Kind == MembershipKind.AirlineClient &&
            m.OrganizationType == OrganizationType.AirlineCustomer).Select(m => m.OrganizationId).Distinct().ToArray();
        return ids.Length == 1 && ids[0] != Guid.Empty ? ids[0] : null;
    }
}
