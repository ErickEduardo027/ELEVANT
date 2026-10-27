using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;

namespace Elevant.Application.Operations;

/// <summary>Limits the PUJ regional feed to scoped internal OCC staff.</summary>
public sealed class GetOccAircraftTrafficHandler(
    IActorContextResolver actorResolver,
    IOccAircraftTrafficSource source)
{
    public async Task<OccAircraftTrafficResult> HandleAsync(
        Guid accountId, Guid stationId, CancellationToken cancellationToken = default)
    {
        if (accountId == Guid.Empty)
            return OccAircraftTrafficResult.Failed(OccAircraftTrafficFailure.Unauthorized);
        if (stationId == Guid.Empty)
            return OccAircraftTrafficResult.Failed(OccAircraftTrafficFailure.InvalidRequest);

        var actor = await actorResolver.ResolveAsync(accountId, cancellationToken);
        if (!ActorContextValidator.IsValid(actor, accountId))
            return OccAircraftTrafficResult.Failed(OccAircraftTrafficFailure.Unauthorized);
        // Live traffic is shown on the Dashboard and in «Monitoreo de vuelos»; each option grants it.
        if (!OccPlanningAccess.IsAuthorized(actor!, "operations.flight_monitoring.read") &&
            !OccPlanningAccess.IsAuthorized(actor!, "operations.dashboard.read"))
            return OccAircraftTrafficResult.Failed(OccAircraftTrafficFailure.Forbidden);

        if (!actor!.StationScopes.Any(scope => scope.StationId == stationId &&
                string.Equals(scope.StationCode, "PUJ", StringComparison.OrdinalIgnoreCase)))
            return OccAircraftTrafficResult.Failed(OccAircraftTrafficFailure.NotFound);

        var traffic = await source.ReadAsync(cancellationToken);
        return traffic is null
            ? OccAircraftTrafficResult.Failed(OccAircraftTrafficFailure.Unavailable)
            : OccAircraftTrafficResult.Success(traffic);
    }
}
