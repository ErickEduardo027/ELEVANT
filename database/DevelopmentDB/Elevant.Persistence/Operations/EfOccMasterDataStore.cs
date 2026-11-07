using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Common;
using Elevant.Application.Identity;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Commercial;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;
using Step = Elevant.Persistence.Operations.MasterDataCommand.Step;

namespace Elevant.Persistence.Operations;

/// <summary>
/// OCC master data (2-A): the terminals and stands of a station in scope and the shared aircraft types, under
/// <c>operations.master_data.*</c>. A code changes only while nothing used it; something in use is never
/// deactivated; nothing is deleted. Every change is audited and announced to the station's OCC
/// (<c>occ_planning</c>), so coverage, positions and planning read it again; an aircraft type is shared, so its
/// change is announced to the OCC of every active station.
/// </summary>
internal sealed class EfOccMasterDataStore(ElevantDbContext context, IActorContextResolver actors, TimeProvider timeProvider)
    : IOccMasterDataStore
{
    private const string ReadPermission = "operations.master_data.read";
    private const string CreatePermission = "operations.master_data.create";
    private const string UpdatePermission = "operations.master_data.update";
    private const string TerminalResource = "ref.terminals";
    private const string StandResource = "ref.stands";
    private const string AircraftTypeResource = "ref.aircraft_types";

    private sealed record StationScope(long Id, Guid PublicId, string Code, string TimeZone);

    public async Task<MasterDataResult<OccMasterData>> ReadAsync(Guid actorId, Guid stationId,
        CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, ReadPermission)) return MasterDataResult<OccMasterData>.Failed(MasterDataFailure.Forbidden, "forbidden");
        var station = await StationAsync(actor!, stationId, cancellationToken);
        if (station is null) return MasterDataResult<OccMasterData>.Failed(MasterDataFailure.NotFound, "not_found");
        var terminals = await context.Terminals.AsNoTracking().Where(item => item.StationId == station.Id)
            .OrderBy(item => item.Code).ToArrayAsync(cancellationToken);
        var stands = await context.Stands.AsNoTracking().Where(item => item.StationId == station.Id)
            .OrderBy(item => item.Code).ToArrayAsync(cancellationToken);
        var types = await context.AircraftTypes.AsNoTracking().OrderBy(item => item.IcaoCode).ToArrayAsync(cancellationToken);
        var standHistory = await MasterDataUsage.StandsWithHistoryAsync(context, station.Id, cancellationToken);
        var terminalHistory = await MasterDataUsage.TerminalsWithHistoryAsync(context, station.Id, standHistory, cancellationToken);
        var terminalIds = terminals.ToDictionary(item => item.Id, item => item.PublicId);
        return MasterDataResult<OccMasterData>.Success(new OccMasterData(station.PublicId, station.Code,
            terminals.Select(item => TerminalItem(item, terminalHistory.Contains(item.Id))).ToArray(),
            stands.Select(item => StandItem(item, item.TerminalId is { } id ? terminalIds.GetValueOrDefault(id) : null,
                standHistory.Contains(item.Id))).ToArray(),
            types.Select(AircraftTypeItem).ToArray(),
            actor!.HasPermission(CreatePermission), actor.HasPermission(UpdatePermission)));
    }

    public async Task<MasterDataResult<MasterTerminalData>> CreateTerminalAsync(Guid actorId, CreateTerminalInput input,
        Guid idempotencyKey, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, CreatePermission)) return MasterDataResult<MasterTerminalData>.Failed(MasterDataFailure.Forbidden, "forbidden");
        if (idempotencyKey == Guid.Empty) return MasterDataResult<MasterTerminalData>.Failed(MasterDataFailure.Invalid, "idempotency_key_required");
        var code = MasterDataRules.TerminalCode(input.Code);
        var name = MasterDataRules.Name(input.Name, 120);
        if (code is null || name is null) return MasterDataResult<MasterTerminalData>.Failed(MasterDataFailure.Invalid, "invalid_terminal");
        var station = await StationAsync(actor!, input.StationId, cancellationToken);
        if (station is null) return MasterDataResult<MasterTerminalData>.Failed(MasterDataFailure.NotFound, "not_found");
        var accountId = await AccountIdAsync(actorId, cancellationToken);
        var hash = CommercialCommandReceipts.Hash(new { input.StationId, code, name });
        var now = Now();
        return await MasterDataCommand.RunAsync(context, idempotencyKey, accountId, "occ.terminal.create", hash,
            "terminal_code_taken", now, async () =>
            {
                if (await context.Terminals.AnyAsync(item => item.StationId == station.Id && item.Code == code, cancellationToken))
                    return Step.Fail(MasterDataFailure.Conflict, "terminal_code_taken");
                var terminal = new Terminal
                {
                    PublicId = Guid.CreateVersion7(), StationId = station.Id, Code = code, Name = name, IsActive = true,
                    CreatedAt = now, UpdatedAt = now,
                };
                context.Terminals.Add(terminal);
                MasterDataCommand.Audit(context, accountId, "occ.terminal.created", TerminalResource, terminal.PublicId,
                    station.Id, now, new("terminal.code", null, code), new("terminal.name", null, name),
                    new("terminal.active", null, "true"));
                await OccPlanningChangeWriter.AddForStationAsync(context, station.Id, station.PublicId, now, cancellationToken);
                await context.SaveChangesAsync(cancellationToken);
                return Step.Done(terminal.PublicId);
            }, TerminalAsync, cancellationToken);
    }

    public async Task<MasterDataResult<MasterTerminalData>> UpdateTerminalAsync(Guid actorId, Guid terminalId,
        UpdateTerminalInput input, Guid idempotencyKey, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, UpdatePermission)) return MasterDataResult<MasterTerminalData>.Failed(MasterDataFailure.Forbidden, "forbidden");
        if (idempotencyKey == Guid.Empty) return MasterDataResult<MasterTerminalData>.Failed(MasterDataFailure.Invalid, "idempotency_key_required");
        if (string.IsNullOrWhiteSpace(input.ExpectedVersion))
            return MasterDataResult<MasterTerminalData>.Failed(MasterDataFailure.Invalid, "expected_version_required");
        var code = MasterDataRules.TerminalCode(input.Code);
        var name = MasterDataRules.Name(input.Name, 120);
        if (code is null || name is null) return MasterDataResult<MasterTerminalData>.Failed(MasterDataFailure.Invalid, "invalid_terminal");
        var target = await context.Terminals.AsNoTracking().Where(item => item.PublicId == terminalId)
            .Select(item => (long?)item.StationId).SingleOrDefaultAsync(cancellationToken);
        var station = target is { } stationId ? await StationAsync(actor!, stationId, cancellationToken) : null;
        if (station is null) return MasterDataResult<MasterTerminalData>.Failed(MasterDataFailure.NotFound, "not_found");
        var accountId = await AccountIdAsync(actorId, cancellationToken);
        var hash = CommercialCommandReceipts.Hash(new { terminalId, code, name, input.IsActive, expected = input.ExpectedVersion });
        var now = Now();
        return await MasterDataCommand.RunAsync(context, idempotencyKey, accountId, "occ.terminal.update", hash,
            "terminal_code_taken", now, async () =>
            {
                var terminal = await context.Terminals.SingleAsync(item => item.PublicId == terminalId, cancellationToken);
                if (MasterDataCommand.Version(terminal.RowVersion) != input.ExpectedVersion)
                    return Step.Fail(MasterDataFailure.Conflict, "version_conflict");
                if (code != terminal.Code)
                {
                    var standHistory = await MasterDataUsage.StandsWithHistoryAsync(context, station.Id, cancellationToken);
                    if ((await MasterDataUsage.TerminalsWithHistoryAsync(context, station.Id, standHistory, cancellationToken))
                        .Contains(terminal.Id))
                        return Step.Fail(MasterDataFailure.Conflict, "terminal_code_locked");
                    if (await context.Terminals.AnyAsync(item => item.StationId == station.Id && item.Code == code &&
                            item.Id != terminal.Id, cancellationToken))
                        return Step.Fail(MasterDataFailure.Conflict, "terminal_code_taken");
                }
                if (terminal.IsActive && !input.IsActive && await MasterDataUsage.TerminalInUseAsync(context, terminal.Id,
                        BusinessCalendar.Today(now, station.TimeZone), now, cancellationToken))
                    return Step.Fail(MasterDataFailure.Conflict, "terminal_in_use");
                if (terminal.Code == code && terminal.Name == name && terminal.IsActive == input.IsActive)
                    return Step.Done(terminal.PublicId);
                MasterDataCommand.Audit(context, accountId, MasterDataCommand.Event("occ.terminal", terminal.IsActive, input.IsActive),
                    TerminalResource, terminal.PublicId, station.Id, now, new("terminal.code", terminal.Code, code),
                    new("terminal.name", terminal.Name, name),
                    new("terminal.active", Flag(terminal.IsActive), Flag(input.IsActive)));
                (terminal.Code, terminal.Name, terminal.IsActive, terminal.UpdatedAt) = (code, name, input.IsActive, now);
                await OccPlanningChangeWriter.AddForStationAsync(context, station.Id, station.PublicId, now, cancellationToken);
                await context.SaveChangesAsync(cancellationToken);
                return Step.Done(terminal.PublicId);
            }, TerminalAsync, cancellationToken);
    }

    public async Task<MasterDataResult<MasterStandData>> CreateStandAsync(Guid actorId, CreateStandInput input,
        Guid idempotencyKey, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, CreatePermission)) return MasterDataResult<MasterStandData>.Failed(MasterDataFailure.Forbidden, "forbidden");
        if (idempotencyKey == Guid.Empty) return MasterDataResult<MasterStandData>.Failed(MasterDataFailure.Invalid, "idempotency_key_required");
        var code = MasterDataRules.StandCode(input.Code);
        if (code is null || input.TerminalId == Guid.Empty || !MasterDataRules.TryParseSize(input.MaxAircraftSize, out var size))
            return MasterDataResult<MasterStandData>.Failed(MasterDataFailure.Invalid, "invalid_stand");
        var station = await StationAsync(actor!, input.StationId, cancellationToken);
        if (station is null) return MasterDataResult<MasterStandData>.Failed(MasterDataFailure.NotFound, "not_found");
        var accountId = await AccountIdAsync(actorId, cancellationToken);
        var hash = CommercialCommandReceipts.Hash(new
        {
            input.StationId, input.TerminalId, code, input.HasBoardingBridge, input.IsRemote, size = size?.ToString(),
        });
        var now = Now();
        return await MasterDataCommand.RunAsync(context, idempotencyKey, accountId, "occ.stand.create", hash,
            "stand_code_taken", now, async () =>
            {
                var terminal = await context.Terminals.AsNoTracking()
                    .Where(item => item.PublicId == input.TerminalId && item.StationId == station.Id)
                    .Select(item => new { item.Id, item.IsActive }).SingleOrDefaultAsync(cancellationToken);
                if (terminal is null) return Step.Fail(MasterDataFailure.Invalid, "invalid_stand");
                if (!terminal.IsActive) return Step.Fail(MasterDataFailure.Conflict, "terminal_inactive");
                if (await context.Stands.AnyAsync(item => item.StationId == station.Id && item.Code == code, cancellationToken))
                    return Step.Fail(MasterDataFailure.Conflict, "stand_code_taken");
                var stand = new Stand
                {
                    PublicId = Guid.CreateVersion7(), StationId = station.Id, TerminalId = terminal.Id, Code = code,
                    StandType = StandType(input.IsRemote), IsActive = true, HasBoardingBridge = input.HasBoardingBridge,
                    IsRemote = input.IsRemote, MaxAircraftSize = size, CreatedAt = now, UpdatedAt = now,
                };
                context.Stands.Add(stand);
                MasterDataCommand.Audit(context, accountId, "occ.stand.created", StandResource, stand.PublicId, station.Id, now,
                    new("stand.code", null, code), new("stand.terminal", null, input.TerminalId.ToString()),
                    new("stand.bridge", null, Flag(input.HasBoardingBridge)), new("stand.remote", null, Flag(input.IsRemote)),
                    new("stand.max_size", null, size?.ToString()), new("stand.active", null, "true"));
                await OccPlanningChangeWriter.AddForStationAsync(context, station.Id, station.PublicId, now, cancellationToken);
                await context.SaveChangesAsync(cancellationToken);
                return Step.Done(stand.PublicId);
            }, StandAsync, cancellationToken);
    }

    public async Task<MasterDataResult<MasterStandData>> UpdateStandAsync(Guid actorId, Guid standId, UpdateStandInput input,
        Guid idempotencyKey, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, UpdatePermission)) return MasterDataResult<MasterStandData>.Failed(MasterDataFailure.Forbidden, "forbidden");
        if (idempotencyKey == Guid.Empty) return MasterDataResult<MasterStandData>.Failed(MasterDataFailure.Invalid, "idempotency_key_required");
        if (string.IsNullOrWhiteSpace(input.ExpectedVersion))
            return MasterDataResult<MasterStandData>.Failed(MasterDataFailure.Invalid, "expected_version_required");
        var code = MasterDataRules.StandCode(input.Code);
        if (code is null || input.TerminalId == Guid.Empty || !MasterDataRules.TryParseSize(input.MaxAircraftSize, out var size))
            return MasterDataResult<MasterStandData>.Failed(MasterDataFailure.Invalid, "invalid_stand");
        var target = await context.Stands.AsNoTracking().Where(item => item.PublicId == standId)
            .Select(item => (long?)item.StationId).SingleOrDefaultAsync(cancellationToken);
        var station = target is { } stationId ? await StationAsync(actor!, stationId, cancellationToken) : null;
        if (station is null) return MasterDataResult<MasterStandData>.Failed(MasterDataFailure.NotFound, "not_found");
        var accountId = await AccountIdAsync(actorId, cancellationToken);
        var hash = CommercialCommandReceipts.Hash(new
        {
            standId, input.TerminalId, code, input.HasBoardingBridge, input.IsRemote, size = size?.ToString(), input.IsActive,
            expected = input.ExpectedVersion,
        });
        var now = Now();
        return await MasterDataCommand.RunAsync(context, idempotencyKey, accountId, "occ.stand.update", hash,
            "stand_code_taken", now, async () =>
            {
                var stand = await context.Stands.SingleAsync(item => item.PublicId == standId, cancellationToken);
                if (MasterDataCommand.Version(stand.RowVersion) != input.ExpectedVersion)
                    return Step.Fail(MasterDataFailure.Conflict, "version_conflict");
                var terminal = await context.Terminals.AsNoTracking()
                    .Where(item => item.PublicId == input.TerminalId && item.StationId == station.Id)
                    .Select(item => new { item.Id, item.IsActive }).SingleOrDefaultAsync(cancellationToken);
                if (terminal is null) return Step.Fail(MasterDataFailure.Invalid, "invalid_stand");
                if (input.IsActive && !terminal.IsActive) return Step.Fail(MasterDataFailure.Conflict, "terminal_inactive");
                if (code != stand.Code || terminal.Id != stand.TerminalId)
                {
                    if ((await MasterDataUsage.StandsWithHistoryAsync(context, station.Id, cancellationToken)).Contains(stand.Id))
                        return Step.Fail(MasterDataFailure.Conflict, "stand_code_locked");
                    if (await context.Stands.AnyAsync(item => item.StationId == station.Id && item.Code == code &&
                            item.Id != stand.Id, cancellationToken))
                        return Step.Fail(MasterDataFailure.Conflict, "stand_code_taken");
                }
                var today = BusinessCalendar.Today(now, station.TimeZone);
                if (stand.IsActive && !input.IsActive &&
                    await MasterDataUsage.StandInUseAsync(context, stand.Id, MasterDataUsage.Since(today), now, cancellationToken))
                    return Step.Fail(MasterDataFailure.Conflict, "stand_in_use");
                if (stand.Code == code && stand.TerminalId == terminal.Id && stand.HasBoardingBridge == input.HasBoardingBridge &&
                    stand.IsRemote == input.IsRemote && stand.MaxAircraftSize == size && stand.IsActive == input.IsActive)
                    return Step.Done(stand.PublicId);
                var previousTerminal = stand.TerminalId is { } previous
                    ? await context.Terminals.AsNoTracking().Where(item => item.Id == previous).Select(item => (Guid?)item.PublicId)
                        .SingleOrDefaultAsync(cancellationToken)
                    : null;
                MasterDataCommand.Audit(context, accountId, MasterDataCommand.Event("occ.stand", stand.IsActive, input.IsActive),
                    StandResource, stand.PublicId, station.Id, now, new("stand.code", stand.Code, code),
                    new("stand.terminal", previousTerminal?.ToString(), input.TerminalId.ToString()),
                    new("stand.bridge", Flag(stand.HasBoardingBridge), Flag(input.HasBoardingBridge)),
                    new("stand.remote", Flag(stand.IsRemote), Flag(input.IsRemote)),
                    new("stand.max_size", stand.MaxAircraftSize?.ToString(), size?.ToString()),
                    new("stand.active", Flag(stand.IsActive), Flag(input.IsActive)));
                if (stand.IsRemote != input.IsRemote) stand.StandType = StandType(input.IsRemote);
                (stand.Code, stand.TerminalId, stand.HasBoardingBridge, stand.IsRemote, stand.MaxAircraftSize, stand.IsActive,
                    stand.UpdatedAt) = (code, terminal.Id, input.HasBoardingBridge, input.IsRemote, size, input.IsActive, now);
                await OccPlanningChangeWriter.AddForStationAsync(context, station.Id, station.PublicId, now, cancellationToken);
                await context.SaveChangesAsync(cancellationToken);
                return Step.Done(stand.PublicId);
            }, StandAsync, cancellationToken);
    }

    public async Task<MasterDataResult<MasterAircraftTypeData>> CreateAircraftTypeAsync(Guid actorId,
        CreateAircraftTypeInput input, Guid idempotencyKey, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, CreatePermission))
            return MasterDataResult<MasterAircraftTypeData>.Failed(MasterDataFailure.Forbidden, "forbidden");
        if (idempotencyKey == Guid.Empty)
            return MasterDataResult<MasterAircraftTypeData>.Failed(MasterDataFailure.Invalid, "idempotency_key_required");
        var icao = MasterDataRules.AircraftIcao(input.IcaoCode);
        var manufacturer = MasterDataRules.Name(input.Manufacturer, 100);
        var model = MasterDataRules.Name(input.Model, 100);
        if (icao is null || manufacturer is null || model is null || !MasterDataRules.TryAircraftIata(input.IataCode, out var iata) ||
            !MasterDataRules.TryParseSize(input.SizeCategory, out var size))
            return MasterDataResult<MasterAircraftTypeData>.Failed(MasterDataFailure.Invalid, "invalid_aircraft_type");
        var accountId = await AccountIdAsync(actorId, cancellationToken);
        var hash = CommercialCommandReceipts.Hash(new { icao, iata, manufacturer, model, size = size?.ToString() });
        var now = Now();
        return await MasterDataCommand.RunAsync(context, idempotencyKey, accountId, "ref.aircraft_type.create", hash,
            "aircraft_type_code_taken", now, async () =>
            {
                if (await context.AircraftTypes.AnyAsync(item => item.IcaoCode == icao, cancellationToken))
                    return Step.Fail(MasterDataFailure.Conflict, "aircraft_type_code_taken");
                var type = new AircraftType
                {
                    PublicId = Guid.CreateVersion7(), IcaoCode = icao, IataCode = iata, Manufacturer = manufacturer, Model = model,
                    SizeCategory = size, IsActive = true, CreatedAt = now, UpdatedAt = now,
                };
                context.AircraftTypes.Add(type);
                MasterDataCommand.Audit(context, accountId, "ref.aircraft_type.created", AircraftTypeResource, type.PublicId, null,
                    now, new("aircraft_type.icao", null, icao), new("aircraft_type.iata", null, iata),
                    new("aircraft_type.manufacturer", null, manufacturer), new("aircraft_type.model", null, model),
                    new("aircraft_type.size", null, size?.ToString()), new("aircraft_type.active", null, "true"));
                await AnnounceToEveryStationAsync(now, cancellationToken);
                await context.SaveChangesAsync(cancellationToken);
                return Step.Done(type.PublicId);
            }, AircraftTypeAsync, cancellationToken);
    }

    public async Task<MasterDataResult<MasterAircraftTypeData>> UpdateAircraftTypeAsync(Guid actorId, Guid aircraftTypeId,
        UpdateAircraftTypeInput input, Guid idempotencyKey, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, UpdatePermission))
            return MasterDataResult<MasterAircraftTypeData>.Failed(MasterDataFailure.Forbidden, "forbidden");
        if (idempotencyKey == Guid.Empty)
            return MasterDataResult<MasterAircraftTypeData>.Failed(MasterDataFailure.Invalid, "idempotency_key_required");
        if (string.IsNullOrWhiteSpace(input.ExpectedVersion))
            return MasterDataResult<MasterAircraftTypeData>.Failed(MasterDataFailure.Invalid, "expected_version_required");
        var manufacturer = MasterDataRules.Name(input.Manufacturer, 100);
        var model = MasterDataRules.Name(input.Model, 100);
        if (manufacturer is null || model is null || !MasterDataRules.TryAircraftIata(input.IataCode, out var iata) ||
            !MasterDataRules.TryParseSize(input.SizeCategory, out var size))
            return MasterDataResult<MasterAircraftTypeData>.Failed(MasterDataFailure.Invalid, "invalid_aircraft_type");
        var accountId = await AccountIdAsync(actorId, cancellationToken);
        var hash = CommercialCommandReceipts.Hash(new
        {
            aircraftTypeId, iata, manufacturer, model, size = size?.ToString(), input.IsActive, expected = input.ExpectedVersion,
        });
        var now = Now();
        return await MasterDataCommand.RunAsync(context, idempotencyKey, accountId, "ref.aircraft_type.update", hash,
            "version_conflict", now, async () =>
            {
                var type = await context.AircraftTypes.SingleOrDefaultAsync(item => item.PublicId == aircraftTypeId,
                    cancellationToken);
                if (type is null) return Step.Fail(MasterDataFailure.NotFound, "not_found");
                if (MasterDataCommand.Version(type.RowVersion) != input.ExpectedVersion)
                    return Step.Fail(MasterDataFailure.Conflict, "version_conflict");
                if (type.IsActive && !input.IsActive && await MasterDataUsage.AircraftTypeInUseAsync(context, type.Id,
                        MasterDataUsage.Since(BusinessCalendar.Today(now)), cancellationToken))
                    return Step.Fail(MasterDataFailure.Conflict, "aircraft_type_in_use");
                if (type.IataCode == iata && type.Manufacturer == manufacturer && type.Model == model &&
                    type.SizeCategory == size && type.IsActive == input.IsActive)
                    return Step.Done(type.PublicId);
                MasterDataCommand.Audit(context, accountId,
                    MasterDataCommand.Event("ref.aircraft_type", type.IsActive, input.IsActive), AircraftTypeResource,
                    type.PublicId, null, now, new("aircraft_type.iata", type.IataCode, iata),
                    new("aircraft_type.manufacturer", type.Manufacturer, manufacturer),
                    new("aircraft_type.model", type.Model, model),
                    new("aircraft_type.size", type.SizeCategory?.ToString(), size?.ToString()),
                    new("aircraft_type.active", Flag(type.IsActive), Flag(input.IsActive)));
                (type.IataCode, type.Manufacturer, type.Model, type.SizeCategory, type.IsActive, type.UpdatedAt) =
                    (iata, manufacturer, model, size, input.IsActive, now);
                await AnnounceToEveryStationAsync(now, cancellationToken);
                await context.SaveChangesAsync(cancellationToken);
                return Step.Done(type.PublicId);
            }, AircraftTypeAsync, cancellationToken);
    }

    /// <summary>
    /// The aircraft types are shared: «Datos maestros», the planning and the stand rules of every active station read
    /// them again (<c>occ_planning</c>), in the command's transaction.
    /// </summary>
    private async Task AnnounceToEveryStationAsync(DateTimeOffset now, CancellationToken cancellationToken)
    {
        var stations = await context.Stations.AsNoTracking().Where(item => item.IsActive)
            .Select(item => new { item.Id, item.PublicId }).ToArrayAsync(cancellationToken);
        foreach (var station in stations)
            await OccPlanningChangeWriter.AddForStationAsync(context, station.Id, station.PublicId, now, cancellationToken);
    }

    private async Task<MasterTerminalData?> TerminalAsync(Guid terminalId)
    {
        var terminal = await context.Terminals.AsNoTracking().SingleOrDefaultAsync(item => item.PublicId == terminalId);
        if (terminal is null) return null;
        var standHistory = await MasterDataUsage.StandsWithHistoryAsync(context, terminal.StationId, CancellationToken.None);
        var history = await MasterDataUsage.TerminalsWithHistoryAsync(context, terminal.StationId, standHistory,
            CancellationToken.None);
        return TerminalItem(terminal, history.Contains(terminal.Id));
    }

    private async Task<MasterStandData?> StandAsync(Guid standId)
    {
        var stand = await context.Stands.AsNoTracking().SingleOrDefaultAsync(item => item.PublicId == standId);
        if (stand is null) return null;
        var terminal = stand.TerminalId is { } terminalId
            ? await context.Terminals.AsNoTracking().Where(item => item.Id == terminalId).Select(item => (Guid?)item.PublicId)
                .SingleOrDefaultAsync()
            : null;
        var history = await MasterDataUsage.StandsWithHistoryAsync(context, stand.StationId, CancellationToken.None);
        return StandItem(stand, terminal, history.Contains(stand.Id));
    }

    private async Task<MasterAircraftTypeData?> AircraftTypeAsync(Guid aircraftTypeId) =>
        await context.AircraftTypes.AsNoTracking().SingleOrDefaultAsync(item => item.PublicId == aircraftTypeId) is { } type
            ? AircraftTypeItem(type)
            : null;

    private static MasterTerminalData TerminalItem(Terminal terminal, bool hasHistory) =>
        new(terminal.PublicId, terminal.Code, terminal.Name, terminal.IsActive, hasHistory,
            MasterDataCommand.Version(terminal.RowVersion));

    private static MasterStandData StandItem(Stand stand, Guid? terminalId, bool hasHistory) =>
        new(stand.PublicId, terminalId, stand.Code, stand.HasBoardingBridge, stand.IsRemote, stand.MaxAircraftSize?.ToString(),
            stand.IsActive, hasHistory, MasterDataCommand.Version(stand.RowVersion));

    private static MasterAircraftTypeData AircraftTypeItem(AircraftType type) =>
        new(type.PublicId, type.IcaoCode, type.IataCode, type.Manufacturer, type.Model, type.SizeCategory?.ToString(),
            type.IsActive, MasterDataCommand.Version(type.RowVersion));

    /// <summary>Contact or remote, as the seed and the positions map name stands.</summary>
    private static string StandType(bool isRemote) => isRemote ? "Remote" : "Contact";

    /// <summary>The station when it is active and in the actor's scope; null otherwise (404, never «not yours»).</summary>
    private async Task<StationScope?> StationAsync(ActorContext actor, Guid stationId, CancellationToken cancellationToken) =>
        !actor.StationScopes.Any(scope => scope.StationId == stationId)
            ? null
            : await context.Stations.AsNoTracking().Where(item => item.PublicId == stationId && item.IsActive)
                .Select(item => new StationScope(item.Id, item.PublicId, item.Code, item.IanaTimeZone))
                .SingleOrDefaultAsync(cancellationToken);

    private async Task<StationScope?> StationAsync(ActorContext actor, long stationId, CancellationToken cancellationToken)
    {
        var publicId = await context.Stations.AsNoTracking().Where(item => item.Id == stationId).Select(item => item.PublicId)
            .SingleAsync(cancellationToken);
        return await StationAsync(actor, publicId, cancellationToken);
    }

    private static bool Allowed(ActorContext? actor, string permission) =>
        actor is not null && actor.HasPermission(permission) &&
        actor.Memberships.Any(membership => membership.Kind == MembershipKind.InternalStaff &&
            membership.OrganizationType == OrganizationType.AviamOperator);

    private Task<long> AccountIdAsync(Guid actorId, CancellationToken cancellationToken) =>
        context.Users.AsNoTracking().Where(user => user.PublicId == actorId).Select(user => user.Id)
            .SingleAsync(cancellationToken);

    private DateTimeOffset Now()
    {
        var value = timeProvider.GetUtcNow();
        return new DateTimeOffset(value.UtcTicks - value.UtcTicks % TimeSpan.TicksPerMillisecond, TimeSpan.Zero);
    }

    private static string Flag(bool value) => value ? "true" : "false";
}
