using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Integration.DemoFlights;

namespace Elevant.Application.Operations.DemoStation;

/// <summary>
/// «Cargar posiciones de Punta Cana» of the superadministrator (ADR-0041, contracts 1.2). The request is checked in this
/// order before the store runs, as the demo flights are: the caller is the superadministrator (<c>forbidden</c>); demo
/// flights are on in this environment (<c>DemoFlights:Mode</c>, <c>demo_flights_unavailable</c>); the command carries its
/// Idempotency-Key (<c>idempotency_key_required</c>); it names a station (<c>station_unavailable</c>). The store checks
/// the superadministrator and the key again, and the station.
/// </summary>
public sealed class DemoStationHandler(IDemoStationStore store, IActorContextResolver actors,
    DemoFlightAvailability availability)
{
    public async Task<MasterDataResult<DemoStationLayoutData>> PrepareAsync(Guid actorId, Guid stationId,
        Guid idempotencyKey, CancellationToken cancellationToken = default)
    {
        if (actorId == Guid.Empty ||
            (await actors.ResolveAsync(actorId, cancellationToken))?.EffectiveAccess?.IsSuperAdministrator != true)
            return Failed(MasterDataFailure.Forbidden, "forbidden");
        if (!availability.Enabled) return Failed(MasterDataFailure.Conflict, DemoFlightCodes.Unavailable);
        if (idempotencyKey == Guid.Empty) return Failed(MasterDataFailure.Invalid, "idempotency_key_required");
        if (stationId == Guid.Empty) return Failed(MasterDataFailure.NotFound, "station_unavailable");
        return await store.PrepareAsync(actorId, stationId, idempotencyKey, cancellationToken);
    }

    private static MasterDataResult<DemoStationLayoutData> Failed(MasterDataFailure failure, string code) =>
        MasterDataResult<DemoStationLayoutData>.Failed(failure, code);
}
