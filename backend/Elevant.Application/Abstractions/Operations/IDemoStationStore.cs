using Elevant.Application.Integration.DemoFlights;
using Elevant.Application.Operations.DemoStation;

namespace Elevant.Application.Abstractions.Operations;

/// <summary>
/// «Cargar posiciones de Punta Cana» (ADR-0041, contracts 1.2): the superadministrator loads the terminals and stands of
/// <see cref="PuntaCanaStationLayout"/> that the station lacks. It only creates, active and without coordinates: an
/// existing terminal or stand is adopted as it is, nothing is changed, deactivated or deleted.
/// </summary>
public interface IDemoStationStore
{
    /// <summary>
    /// Applies <see cref="DemoStationPlan"/> to the station and answers the station as it is afterwards, so a replay of the
    /// Idempotency-Key and a second run answer the same and create nothing. Only the superadministrator
    /// (<c>forbidden</c>); an inactive or unknown station is <c>station_unavailable</c> and a station without a catalogue
    /// <c>demo_station_unsupported</c>.
    /// </summary>
    Task<MasterDataResult<DemoStationLayoutData>> PrepareAsync(Guid actorId, Guid stationId, Guid idempotencyKey,
        CancellationToken cancellationToken = default);
}
