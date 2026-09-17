using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations;

internal static class OccPlanningAccess
{
    public static bool IsAuthorized(ActorContext actor) =>
        actor.Roles.Any(role =>
            string.Equals(role.Code, "ADMIN_OCC", StringComparison.Ordinal) &&
            role.Portal == PortalKind.BackOffice) &&
        actor.Memberships.Any(membership =>
            membership.OrganizationType == OrganizationType.AviamOperator &&
            membership.Kind == MembershipKind.InternalStaff);
}
