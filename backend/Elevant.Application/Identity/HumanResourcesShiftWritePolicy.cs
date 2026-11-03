using Elevant.Domain.Enumerations;

namespace Elevant.Application.Identity;

/// <summary>Authorizes the legacy shift write contract while OCC owns scheduling.</summary>
public static class HumanResourcesShiftWritePolicy
{
    /// <summary>
    /// Gestión Humana programs shifts with «Programar turnos» (ADR-0026); OCC still creates the
    /// one shift a flight needs from planning. Both are internal AVIAM staff with station scope.
    /// </summary>
    public static bool CanRecord(ActorContext? actor) =>
        (actor?.HasPermission("human_resources.schedules.write") == true ||
         actor?.HasPermission("operations.planning.assign") == true) &&
        actor.Memberships.Any(membership =>
            membership.OrganizationType == OrganizationType.AviamOperator &&
            membership.Kind == MembershipKind.InternalStaff);

    public static bool CanRecord(ActorContext? actor, Guid stationId) =>
        stationId != Guid.Empty && CanRecord(actor) &&
        actor!.StationScopes.Any(scope => scope.StationId == stationId);
}
