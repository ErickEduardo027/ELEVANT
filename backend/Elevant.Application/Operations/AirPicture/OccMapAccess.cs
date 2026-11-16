using Elevant.Application.Identity;

namespace Elevant.Application.Operations.AirPicture;

/// <summary>
/// Who reads the OCC map (ADR-0042, contracts 1.3): AVIAM internal staff with the station in scope and any of the four map
/// permissions (dashboard, flight monitoring, positions map or planning). Every map reader sees the open proposals and
/// the milestone times; importing a flight stays under planning's own permission. The air picture and an aircraft's
/// track also need the station to be the one with live traffic (<c>AirTraffic:StationCode</c>).
/// </summary>
internal static class OccMapAccess
{
    /// <summary>Each one of them opens the map.</summary>
    public static IReadOnlyList<string> ReadPermissions { get; } =
    [
        "operations.dashboard.read",
        "operations.flight_monitoring.read",
        "operations.positions_map.read",
        "operations.planning.read",
    ];

    /// <summary>
    /// Null when <paramref name="actor"/> may read the map of <paramref name="stationId"/>; otherwise why not: an invalid
    /// actor is <see cref="OccMapFailure.Unauthorized"/>; someone outside AVIAM's internal staff or without a map
    /// permission <see cref="OccMapFailure.Forbidden"/>; a station outside the actor's scope, or (when
    /// <paramref name="requiredStationCode"/> is given) another station than that one, <see cref="OccMapFailure.NotFound"/>.
    /// </summary>
    public static OccMapFailure? Check(ActorContext? actor, Guid accountId, Guid stationId, string? requiredStationCode)
    {
        if (!ActorContextValidator.IsValid(actor, accountId)) return OccMapFailure.Unauthorized;
        if (!ReadPermissions.Any(permission => OccPlanningAccess.IsAuthorized(actor!, permission)))
            return OccMapFailure.Forbidden;
        var scope = actor!.StationScopes.FirstOrDefault(item => item.StationId == stationId);
        if (scope is null) return OccMapFailure.NotFound;
        return requiredStationCode is not null &&
            !string.Equals(scope.StationCode.Trim(), requiredStationCode.Trim(), StringComparison.OrdinalIgnoreCase)
                ? OccMapFailure.NotFound
                : null;
    }
}
