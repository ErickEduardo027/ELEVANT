using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations;

internal static class OccPlanningAccess
{
    /// <summary>AVIAM staff holding the given Operations permission.</summary>
    public static bool IsAuthorized(ActorContext actor, string permissionCode) =>
        actor.HasPermission(permissionCode) &&
        actor.Memberships.Any(membership =>
            membership.OrganizationType == OrganizationType.AviamOperator &&
            membership.Kind == MembershipKind.InternalStaff);
}
