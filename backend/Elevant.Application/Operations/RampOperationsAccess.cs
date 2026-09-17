using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations;

public static class RampOperationsAccess
{
    public static bool IsAuthorized(ActorContext actor) =>
        actor.Roles.Any(role =>
            string.Equals(role.Code, "RAMP_AGENT", StringComparison.Ordinal) &&
            role.Portal == PortalKind.RampMobileApp) &&
        actor.Memberships.Any(membership =>
            membership.OrganizationType == OrganizationType.AviamOperator &&
            membership.Kind == MembershipKind.InternalStaff) &&
        actor.StationScopes.Count > 0;
}
