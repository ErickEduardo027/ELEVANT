using System.Globalization;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Integration.DemoFlights;
using Elevant.Application.Operations.DemoStation;
using Elevant.Domain.Entities.Reference;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Commercial;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;
using Step = Elevant.Persistence.Operations.MasterDataCommand.Step;

namespace Elevant.Persistence.Operations;

/// <summary>
/// «Cargar posiciones de Punta Cana» of the superadministrator (ADR-0041, contracts 1.2). It applies
/// <see cref="DemoStationPlan"/> in one command (<see cref="MasterDataCommand"/>): the catalogue's terminals the station
/// lacks, active, and its stands with the catalogue's attributes, active and without coordinates (the map's data draws
/// them by their code, and the database only keeps a location OCC placed, ADR-0027). A row the station already has is
/// never changed, reactivated, deactivated or deleted. Each new row is audited as OCC's master data audits it, with one
/// summary of the command, and the station's OCC hears it once (<c>occ_planning</c>). When nothing is missing only the
/// receipt is written. The answer is the station as it is afterwards (<see cref="DemoStationLayoutReader"/>), so a
/// replay and a second run answer the same and create nothing.
/// </summary>
internal sealed class EfDemoStationStore(ElevantDbContext context, IActorContextResolver actors, TimeProvider timeProvider)
    : IDemoStationStore
{
    private const string PrepareAction = "governance.demo_station.prepare";
    private const string PreparedAction = "governance.demo_station.prepared";
    private const string StationResource = "ref.stations";
    private const string TerminalResource = "ref.terminals";
    private const string StandResource = "ref.stands";

    public async Task<MasterDataResult<DemoStationLayoutData>> PrepareAsync(Guid actorId, Guid stationId,
        Guid idempotencyKey, CancellationToken cancellationToken = default)
    {
        // The handler already checked both; the store never trusts its caller.
        if (!await IsSuperAdministratorAsync(actorId, cancellationToken)) return Failed(MasterDataFailure.Forbidden, "forbidden");
        if (idempotencyKey == Guid.Empty) return Failed(MasterDataFailure.Invalid, "idempotency_key_required");
        var accountId = await AccountIdAsync(actorId, cancellationToken);
        var hash = CommercialCommandReceipts.Hash(new { stationId });
        var now = Now();

        // A unique code another command took first (OCC created the same stand meanwhile): the caller reads again.
        return await MasterDataCommand.RunAsync(context, idempotencyKey, accountId, PrepareAction, hash, "version_conflict", now,
            async () =>
            {
                var station = await context.Stations.AsNoTracking()
                    .Where(item => item.PublicId == stationId && item.IsActive)
                    .Select(item => new { item.Id, item.PublicId, item.Code }).SingleOrDefaultAsync(cancellationToken);
                if (station is null) return Step.Fail(MasterDataFailure.NotFound, "station_unavailable");
                if (!PuntaCanaStationLayout.IsStation(station.Code))
                    return Step.Fail(MasterDataFailure.Conflict, DemoFlightCodes.StationUnsupported);
                var (terminals, stands) = await DemoStationLayoutReader.ExistingAsync(context, station.Id, cancellationToken);
                var plan = DemoStationPlan.For(terminals, stands);
                if (plan.TerminalsToCreate.Count == 0 && plan.StandsToCreate.Count == 0) return Step.Done(station.PublicId);

                // The new terminals, active and with the defaults OCC's master data writes (no stand limit of their own,
                // no bridge qualification: each stand's bridge flag already asks for it).
                var created = plan.TerminalsToCreate.Select(terminal => new Terminal
                {
                    PublicId = Guid.CreateVersion7(), StationId = station.Id, Code = terminal.Code, Name = terminal.Name,
                    IsActive = true, MaxStandsPerAgent = null, RequiresBridgeQualification = false, CreatedAt = now,
                    UpdatedAt = now,
                }).ToArray();
                context.Terminals.AddRange(created);
                foreach (var terminal in created)
                    MasterDataCommand.Audit(context, accountId, "occ.terminal.created", TerminalResource, terminal.PublicId,
                        station.Id, now, new("terminal.code", null, terminal.Code), new("terminal.name", null, terminal.Name),
                        new("terminal.active", null, "true"));
                // The terminals get their keys before their stands point at them.
                await context.SaveChangesAsync(cancellationToken);

                var existing = plan.TerminalIds.Values.ToArray();
                var publicIds = await context.Terminals.AsNoTracking().Where(item => existing.Contains(item.Id))
                    .ToDictionaryAsync(item => item.Id, item => item.PublicId, cancellationToken);
                var targets = plan.TerminalIds.ToDictionary(pair => pair.Key, pair => (Id: pair.Value, PublicId: publicIds[pair.Value]),
                    StringComparer.Ordinal);
                foreach (var terminal in created) targets[terminal.Code] = (terminal.Id, terminal.PublicId);
                foreach (var stand in plan.StandsToCreate)
                {
                    var terminal = targets[stand.TerminalCode];
                    var row = new Stand
                    {
                        PublicId = Guid.CreateVersion7(), StationId = station.Id, TerminalId = terminal.Id, Code = stand.Code,
                        StandType = stand.StandType, IsActive = true, HasBoardingBridge = stand.HasBoardingBridge,
                        IsRemote = stand.IsRemote, MaxAircraftSize = stand.MaxAircraftSize,
                        Latitude = null, Longitude = null, LocatedAt = null, CreatedAt = now, UpdatedAt = now,
                    };
                    context.Stands.Add(row);
                    MasterDataCommand.Audit(context, accountId, "occ.stand.created", StandResource, row.PublicId, station.Id, now,
                        new("stand.code", null, row.Code), new("stand.terminal", null, terminal.PublicId.ToString()),
                        new("stand.bridge", null, Flag(row.HasBoardingBridge)), new("stand.remote", null, Flag(row.IsRemote)),
                        new("stand.max_size", null, row.MaxAircraftSize?.ToString()), new("stand.active", null, "true"));
                }
                MasterDataCommand.Audit(context, accountId, PreparedAction, StationResource, station.PublicId, station.Id, now,
                    new("demo_station.terminals_created", null, Count(created.Length)),
                    new("demo_station.stands_created", null, Count(plan.StandsToCreate.Count)),
                    new("demo_station.stands_adopted", null, Count(plan.Adopted.Count)));
                // Coverage, positions and planning read the station again.
                await OccPlanningChangeWriter.AddForStationAsync(context, station.Id, station.PublicId, now, cancellationToken);
                await context.SaveChangesAsync(cancellationToken);
                return Step.Done(station.PublicId);
            }, id => ReadAsync(id, cancellationToken), cancellationToken);
    }

    /// <summary>The station as it is now against the catalogue, active or not; null when it does not exist.</summary>
    private async Task<DemoStationLayoutData?> ReadAsync(Guid stationId, CancellationToken cancellationToken)
    {
        var station = await context.Stations.AsNoTracking().Where(item => item.PublicId == stationId)
            .Select(item => new { item.Id, item.PublicId, item.Code }).SingleOrDefaultAsync(cancellationToken);
        return station is null
            ? null
            : await DemoStationLayoutReader.ReadAsync(context, station.Id, station.PublicId, station.Code, cancellationToken);
    }

    private async Task<bool> IsSuperAdministratorAsync(Guid actorId, CancellationToken cancellationToken) =>
        actorId != Guid.Empty &&
        (await actors.ResolveAsync(actorId, cancellationToken))?.EffectiveAccess?.IsSuperAdministrator == true;

    private Task<long> AccountIdAsync(Guid actorId, CancellationToken cancellationToken) =>
        context.Users.AsNoTracking().Where(user => user.PublicId == actorId).Select(user => user.Id)
            .SingleAsync(cancellationToken);

    /// <summary>Instants are stored with milliseconds: what is written is what is read back.</summary>
    private DateTimeOffset Now()
    {
        var value = timeProvider.GetUtcNow();
        return new DateTimeOffset(value.UtcTicks - value.UtcTicks % TimeSpan.TicksPerMillisecond, TimeSpan.Zero);
    }

    private static string Flag(bool value) => value ? "true" : "false";

    private static string Count(int value) => value.ToString(CultureInfo.InvariantCulture);

    private static MasterDataResult<DemoStationLayoutData> Failed(MasterDataFailure failure, string code) =>
        MasterDataResult<DemoStationLayoutData>.Failed(failure, code);
}
