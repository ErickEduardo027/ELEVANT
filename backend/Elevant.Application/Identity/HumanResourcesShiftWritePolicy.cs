using Elevant.Domain.Enumerations;

namespace Elevant.Application.Identity;

/// <summary>Authorizes the legacy shift write contract while OCC owns scheduling.</summary>
public static class HumanResourcesShiftWritePolicy
{
    public static bool CanRecord(ActorContext? actor) =>
        actor?.Roles.Any(role => role.Portal == PortalKind.BackOffice &&
            role.Code == "ADMIN_OCC") == true &&
        actor.Memberships.Any(membership =>
            membership.OrganizationType == OrganizationType.AviamOperator &&
            membership.Kind == MembershipKind.InternalStaff);
}
