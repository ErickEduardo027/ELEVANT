using Elevant.Application.Integration.DemoFlights;
using Elevant.Application.Operations;
using Elevant.Application.Operations.DemoStation;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>
/// A station against the Punta Cana catalogue (ADR-0041, contracts 1.2), as the card «Posiciones de Punta Cana» and the
/// demo flight options read it: <see cref="DemoStationPlan.Describe"/> over the station's terminals and stands, in any
/// state. The stands are compared in memory, since <see cref="StandCodes.Normalize"/> has no SQL form. A station
/// without a catalogue (<see cref="PuntaCanaStationLayout.IsStation"/>) is not supported: its counts are zero and its
/// lists empty.
/// </summary>
internal static class DemoStationLayoutReader
{
    public static async Task<DemoStationLayoutData> ReadAsync(ElevantDbContext context, long stationId,
        Guid stationPublicId, string stationCode, CancellationToken cancellationToken)
    {
        if (!PuntaCanaStationLayout.IsStation(stationCode))
            return new DemoStationLayoutData(stationPublicId, stationCode, false, 0, 0, 0, 0, 0, 0, [], [], false);
        var (terminals, stands) = await ExistingAsync(context, stationId, cancellationToken);
        var state = DemoStationPlan.Describe(terminals, stands);
        return new DemoStationLayoutData(stationPublicId, stationCode, true, state.CatalogTerminals, state.Terminals,
            state.CatalogStands, state.Stands, state.ActiveStands, state.LocatedStands, state.MissingStands,
            state.UnmatchedStands, state.Complete);
    }

    /// <summary>
    /// Every terminal and stand of the station, active or not, as <see cref="DemoStationPlan"/> reads them: a stand is
    /// placed when OCC gave it a location (its latitude is set).
    /// </summary>
    public static async Task<(ExistingTerminal[] Terminals, ExistingStand[] Stands)> ExistingAsync(ElevantDbContext context,
        long stationId, CancellationToken cancellationToken)
    {
        var terminals = await context.Terminals.AsNoTracking().Where(item => item.StationId == stationId)
            .OrderBy(item => item.Id)
            .Select(item => new ExistingTerminal(item.Id, item.Code, item.IsActive))
            .ToArrayAsync(cancellationToken);
        var stands = await context.Stands.AsNoTracking().Where(item => item.StationId == stationId)
            .OrderBy(item => item.Id)
            .Select(item => new ExistingStand(item.Id, item.Code, item.TerminalId, item.IsActive, item.Latitude != null))
            .ToArrayAsync(cancellationToken);
        return (terminals, stands);
    }
}
