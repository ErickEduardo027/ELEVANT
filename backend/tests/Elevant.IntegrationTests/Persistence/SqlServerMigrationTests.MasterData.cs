using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Common;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    /// <summary>
    /// 2-A: the superadministrator creates and edits stations (a new airport needs its data, a known one is
    /// reused); OCC creates and edits terminals, stands and aircraft types. Codes stay fixed once used, the time
    /// zone too, and nothing in use is deactivated, from the master-data screen or from the coverage one.
    /// </summary>
    [Fact]
    public async Task MasterDataIsCreatedEditedAndDeactivatedOnlyWhileNotInUse()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        async Task<T> Run<T>(Func<IServiceProvider, Task<T>> action)
        {
            await using var scope = provider.CreateAsyncScope();
            return await action(scope.ServiceProvider);
        }
        Task<MasterDataResult<StationCatalogItemData>> CreateStation(Guid actor, CreateStationInput input, Guid key) =>
            Run(services => services.GetRequiredService<IStationCatalogStore>().CreateAsync(actor, input, key, ct));
        Task<MasterDataResult<StationCatalogItemData>> UpdateStation(Guid actor, Guid id, UpdateStationInput input, Guid key) =>
            Run(services => services.GetRequiredService<IStationCatalogStore>().UpdateAsync(actor, id, input, key, ct));
        Task<MasterDataResult<OccMasterData>> Read(Guid actor, Guid stationId) =>
            Run(services => services.GetRequiredService<IOccMasterDataStore>().ReadAsync(actor, stationId, ct));
        IOccMasterDataStore Store(IServiceProvider services) => services.GetRequiredService<IOccMasterDataStore>();
        var today = BusinessCalendar.Today(DateTimeOffset.UtcNow, "America/Santo_Domingo");

        // 1. Stations: only the superadministrator, with an Idempotency-Key.
        Assert.Null(await Run(services => services.GetRequiredService<IStationCatalogStore>().ListAsync(SeededOccAccount, ct)));
        var catalog = (await Run(services => services.GetRequiredService<IStationCatalogStore>()
            .ListAsync(SuperAdministratorAccount, ct)))!;
        var puj = Assert.Single(catalog.Stations, item => item.Code == "PUJ");
        Assert.True(puj.HasHistory);
        Assert.Contains(catalog.AvailableAirports, item => item.IataCode == "MIA");
        Assert.Equal("forbidden", (await CreateStation(SeededOccAccount,
            new CreateStationInput("XQS", "Estación sintética", "America/Santo_Domingo"), Guid.NewGuid())).Code);
        Assert.Equal("invalid_time_zone", (await CreateStation(SuperAdministratorAccount,
            new CreateStationInput("XQS", "Estación sintética", "Mars/Olympus_Mons"), Guid.NewGuid())).Code);
        Assert.Equal("invalid_station", (await CreateStation(SuperAdministratorAccount,
            new CreateStationInput("XQSS", "Estación sintética", "America/Santo_Domingo"), Guid.NewGuid())).Code);
        Assert.Equal("airport_required", (await CreateStation(SuperAdministratorAccount,
            new CreateStationInput("XQS", "Estación sintética", "America/Santo_Domingo"), Guid.NewGuid())).Code);
        var stationKey = Guid.NewGuid();
        var stationInput = new CreateStationInput("xqs", "Estación sintética", "America/Santo_Domingo", "xqss",
            "Synthetic Airport", "Synthetic City", "do");
        var created = await CreateStation(SuperAdministratorAccount, stationInput, stationKey);
        Assert.Null(created.Failure);
        var station = created.Value!;
        Assert.Equal(("XQS", "XQSS", "DO", false, true, false), (station.Code, station.Airport.IcaoCode,
            station.Airport.CountryCode, station.HasHistory, station.IsActive, created.Replayed));
        var replayed = await CreateStation(SuperAdministratorAccount, stationInput, stationKey);
        Assert.Equal((station.Id, true), (replayed.Value!.Id, replayed.Replayed));
        Assert.Equal("idempotency_conflict", (await CreateStation(SuperAdministratorAccount,
            stationInput with { Name = "Otra estación" }, stationKey)).Code);
        Assert.Equal("station_code_taken", (await CreateStation(SuperAdministratorAccount, stationInput, Guid.NewGuid())).Code);
        // A known airport is reused: Miami becomes a station without typing its data again.
        var miami = await CreateStation(SuperAdministratorAccount,
            new CreateStationInput("MIA", "AVIAM Miami", "America/New_York"), Guid.NewGuid());
        Assert.Equal(("MIA", "KMIA"), (miami.Value!.Code, miami.Value.Airport.IcaoCode));

        // Its time zone changes while it has no history; a stale version is refused; PUJ is in use and has history.
        Assert.Equal("expected_version_required", (await UpdateStation(SuperAdministratorAccount, station.Id,
            new UpdateStationInput("Estación sintética", "America/Santo_Domingo", true, " "), Guid.NewGuid())).Code);
        var moved = await UpdateStation(SuperAdministratorAccount, station.Id,
            new UpdateStationInput("Estación sintética Norte", "America/New_York", true, station.Version), Guid.NewGuid());
        Assert.Equal(("Estación sintética Norte", "America/New_York"), (moved.Value!.Name, moved.Value.IanaTimeZone));
        Assert.Equal("version_conflict", (await UpdateStation(SuperAdministratorAccount, station.Id,
            new UpdateStationInput("Estación sintética Norte", "America/New_York", false, station.Version), Guid.NewGuid())).Code);
        var deactivated = await UpdateStation(SuperAdministratorAccount, station.Id,
            new UpdateStationInput("Estación sintética Norte", "America/New_York", false, moved.Value.Version), Guid.NewGuid());
        Assert.False(deactivated.Value!.IsActive);
        Assert.Equal("station_in_use", (await UpdateStation(SuperAdministratorAccount, puj.Id,
            new UpdateStationInput(puj.Name, puj.IanaTimeZone, false, puj.Version), Guid.NewGuid())).Code);
        Assert.Equal("time_zone_locked", (await UpdateStation(SuperAdministratorAccount, puj.Id,
            new UpdateStationInput(puj.Name, "America/New_York", true, puj.Version), Guid.NewGuid())).Code);
        await using (var context = CreateContext(database.ConnectionString))
            Assert.Equal(["ref.station.created", "ref.station.updated", "ref.station.deactivated"], await context.AuditEntries
                .AsNoTracking().Where(item => item.EntityPublicId == station.Id).OrderBy(item => item.Id)
                .Select(item => item.Action).ToArrayAsync(ct));

        // 2. OCC master data of PUJ, under operations.master_data.*; a ramp agent has none.
        var data = (await Read(SeededOccAccount, SeededPujStation)).Value!;
        Assert.True(data.CanCreate && data.CanUpdate);
        Assert.Contains(data.Terminals, item => item.Code == "A");
        Assert.Contains(data.Stands, item => item.Code == "A01");
        Assert.Contains(data.AircraftTypes, item => item.IcaoCode == "A320");
        Assert.Equal("forbidden", (await Read(SeededRampAgentAccount, SeededPujStation)).Code);
        Assert.Equal("not_found", (await Read(SeededOccAccount, station.Id)).Code);

        var terminalKey = Guid.NewGuid();
        var terminal = await Run(services => Store(services).CreateTerminalAsync(SeededOccAccount,
            new CreateTerminalInput(SeededPujStation, "c", "Terminal C"), terminalKey, ct));
        Assert.Equal(("C", true, false), (terminal.Value!.Code, terminal.Value.IsActive, terminal.Value.HasHistory));
        Assert.True((await Run(services => Store(services).CreateTerminalAsync(SeededOccAccount,
            new CreateTerminalInput(SeededPujStation, "c", "Terminal C"), terminalKey, ct))).Replayed);
        Assert.Equal("terminal_code_taken", (await Run(services => Store(services).CreateTerminalAsync(SeededOccAccount,
            new CreateTerminalInput(SeededPujStation, "A", "Otra terminal"), Guid.NewGuid(), ct))).Code);
        Assert.Equal("invalid_terminal", (await Run(services => Store(services).CreateTerminalAsync(SeededOccAccount,
            new CreateTerminalInput(SeededPujStation, "C C", "Terminal"), Guid.NewGuid(), ct))).Code);
        Assert.Equal("forbidden", (await Run(services => Store(services).CreateTerminalAsync(SeededRampAgentAccount,
            new CreateTerminalInput(SeededPujStation, "D", "Terminal D"), Guid.NewGuid(), ct))).Code);
        var stand = await Run(services => Store(services).CreateStandAsync(SeededOccAccount,
            new CreateStandInput(SeededPujStation, terminal.Value.Id, "c01", true, false, "Narrowbody"), Guid.NewGuid(), ct));
        Assert.Equal(("C01", terminal.Value.Id, "Narrowbody", true), (stand.Value!.Code, stand.Value.TerminalId,
            stand.Value.MaxAircraftSize, stand.Value.HasBoardingBridge));
        Assert.Equal("stand_code_taken", (await Run(services => Store(services).CreateStandAsync(SeededOccAccount,
            new CreateStandInput(SeededPujStation, terminal.Value.Id, "A01", false, false, null), Guid.NewGuid(), ct))).Code);
        Assert.Equal("invalid_stand", (await Run(services => Store(services).CreateStandAsync(SeededOccAccount,
            new CreateStandInput(SeededPujStation, terminal.Value.Id, "C09", false, false, "Huge"), Guid.NewGuid(), ct))).Code);
        // The new stand reaches the coverage board and the manual flight options.
        Assert.Contains((await Run(services => services.GetRequiredService<IPositionCoverageStore>()
            .ReadAsync(SeededOccAccount, SeededPujStation, today, ct))).Board!.Stands, item => item.Code == "C01");
        Assert.Contains((await Run(services => services.GetRequiredService<IManualTurnaroundOptionsStore>()
            .GetAsync(SeededOccAccount, SeededPujStation, today, ct)))!.Stands, item => item.Code == "C01");

        // Renamed while nothing used it; the terminal is in use while it has an active stand.
        var renamed = await Run(services => Store(services).UpdateStandAsync(SeededOccAccount, stand.Value.Id,
            new UpdateStandInput(terminal.Value.Id, "C02", true, false, "Narrowbody", true, stand.Value.Version), Guid.NewGuid(), ct));
        Assert.Equal("C02", renamed.Value!.Code);
        Assert.Equal("terminal_in_use", (await Run(services => Store(services).UpdateTerminalAsync(SeededOccAccount,
            terminal.Value.Id, new UpdateTerminalInput("C", "Terminal C", false, terminal.Value.Version), Guid.NewGuid(), ct))).Code);
        var standOff = await Run(services => Store(services).UpdateStandAsync(SeededOccAccount, stand.Value.Id,
            new UpdateStandInput(terminal.Value.Id, "C02", true, false, "Narrowbody", false, renamed.Value.Version), Guid.NewGuid(),
            ct));
        Assert.False(standOff.Value!.IsActive);
        var terminalOff = await Run(services => Store(services).UpdateTerminalAsync(SeededOccAccount, terminal.Value.Id,
            new UpdateTerminalInput("C", "Terminal C", false, terminal.Value.Version), Guid.NewGuid(), ct));
        Assert.False(terminalOff.Value!.IsActive);
        Assert.Equal("terminal_inactive", (await Run(services => Store(services).CreateStandAsync(SeededOccAccount,
            new CreateStandInput(SeededPujStation, terminal.Value.Id, "C03", false, false, null), Guid.NewGuid(), ct))).Code);
        Assert.Equal("terminal_inactive", (await Run(services => Store(services).UpdateStandAsync(SeededOccAccount, stand.Value.Id,
            new UpdateStandInput(terminal.Value.Id, "C02", true, false, "Narrowbody", true, standOff.Value.Version), Guid.NewGuid(),
            ct))).Code);
        var reread = (await Read(SeededOccAccount, SeededPujStation)).Value!;
        Assert.False(Assert.Single(reread.Terminals, item => item.Code == "C").IsActive);
        Assert.False(Assert.Single(reread.Stands, item => item.Code == "C02").IsActive);
        Assert.DoesNotContain((await Run(services => services.GetRequiredService<IPositionCoverageStore>()
            .ReadAsync(SeededOccAccount, SeededPujStation, today, ct))).Board!.Terminals, item => item.Code == "C");

        // 3. Aircraft types are shared; the ICAO designator is fixed.
        var typeKey = Guid.NewGuid();
        var b738 = await Run(services => Store(services).CreateAircraftTypeAsync(SeededOccAccount,
            new CreateAircraftTypeInput("b738", "73h", "Boeing", "737-800", "Narrowbody"), typeKey, ct));
        Assert.Equal(("B738", "73H", "Narrowbody"), (b738.Value!.IcaoCode, b738.Value.IataCode, b738.Value.SizeCategory));
        Assert.True((await Run(services => Store(services).CreateAircraftTypeAsync(SeededOccAccount,
            new CreateAircraftTypeInput("b738", "73h", "Boeing", "737-800", "Narrowbody"), typeKey, ct))).Replayed);
        Assert.Equal("aircraft_type_code_taken", (await Run(services => Store(services).CreateAircraftTypeAsync(SeededOccAccount,
            new CreateAircraftTypeInput("B738", null, "Boeing", "737-800", null), Guid.NewGuid(), ct))).Code);
        Assert.Equal("invalid_aircraft_type", (await Run(services => Store(services).CreateAircraftTypeAsync(SeededOccAccount,
            new CreateAircraftTypeInput("B73", null, "Boeing", "737", null), Guid.NewGuid(), ct))).Code);
        Assert.Contains((await Run(services => services.GetRequiredService<IManualTurnaroundOptionsStore>()
            .GetAsync(SeededOccAccount, SeededPujStation, today, ct)))!.AircraftTypes!, item => item.IcaoCode == "B738");

        // 4. A manual flight carries its type («type once»); an unknown type is refused with its code.
        var airline = await Run(services => services.GetRequiredService<ElevantDbContext>().Airlines.AsNoTracking()
            .Where(item => item.IataCode == "ZZ").Select(item => item.PublicId).SingleAsync(ct));
        var b01 = Assert.Single(reread.Stands, item => item.Code == "B01").Id;
        var zone = TimeZoneInfo.FindSystemTimeZoneById("America/Santo_Domingo");
        DateTimeOffset At(int hour) => new(TimeZoneInfo.ConvertTimeToUtc(today.ToDateTime(new TimeOnly(hour, 0)), zone));
        Task<ManualTurnaroundWriteResult> Enter(Guid id, Guid? aircraftType) => Run(services =>
            services.GetRequiredService<IManualTurnaroundStore>().CreateAsync(new ManualTurnaroundWriteRequest(SeededOccAccount,
                [SeededPujStation], id, SeededPujStation, airline, b01, today, "ZZ900", "MIA", At(22), "ZZ901", "MIA", At(23),
                Guid.NewGuid(), "master-data-test", false, aircraftType), ct));
        var unknownType = await Enter(Guid.CreateVersion7(), Guid.NewGuid());
        Assert.Equal((ManualTurnaroundWriteFailure.Conflict, "aircraft_type_unavailable"), (unknownType.Failure, unknownType.Code));
        // With its type known, a wide-body never takes a narrow-body stand (ADR-0030): the size rule now applies.
        var terminalA = Assert.Single(reread.Terminals, item => item.Code == "A").Id;
        var narrow = await Run(services => Store(services).CreateStandAsync(SeededOccAccount,
            new CreateStandInput(SeededPujStation, terminalA, "A09", false, false, "Narrowbody"), Guid.NewGuid(), ct));
        var a333 = Assert.Single(reread.AircraftTypes, item => item.IcaoCode == "A333").Id;
        var wide = await Run(services => services.GetRequiredService<IManualTurnaroundStore>().CreateAsync(
            new ManualTurnaroundWriteRequest(SeededOccAccount, [SeededPujStation], Guid.CreateVersion7(), SeededPujStation, airline,
                narrow.Value!.Id, today, "ZZ902", "MIA", At(20), "ZZ903", "MIA", At(21), Guid.NewGuid(), "master-data-test", false,
                a333), ct));
        Assert.Equal((ManualTurnaroundWriteFailure.Conflict, "stand_unavailable"), (wide.Failure, wide.Code));
        var manualId = Guid.CreateVersion7();
        Assert.True((await Enter(manualId, b738.Value.Id)).IsSuccess);
        Assert.True((await Enter(manualId, b738.Value.Id)).Replayed);
        Assert.Equal(ManualTurnaroundWriteFailure.Conflict, (await Enter(manualId, null)).Failure);

        // 5. In use: the flight holds B01 and the B738, so neither is deactivated (nor B01 renamed), from either screen.
        await using (var context = CreateContext(database.ConnectionString))
            Assert.NotNull(await context.Turnarounds.AsNoTracking().Where(item => item.PublicId == manualId)
                .Select(item => item.AircraftTypeId).SingleAsync(ct));
        var b01Row = Assert.Single((await Read(SeededOccAccount, SeededPujStation)).Value!.Stands, item => item.Code == "B01");
        Assert.True(b01Row.HasHistory);
        Assert.Equal("stand_in_use", (await Run(services => Store(services).UpdateStandAsync(SeededOccAccount, b01,
            new UpdateStandInput(b01Row.TerminalId!.Value, "B01", b01Row.HasBoardingBridge, b01Row.IsRemote,
                b01Row.MaxAircraftSize, false, b01Row.Version), Guid.NewGuid(), ct))).Code);
        Assert.Equal("stand_code_locked", (await Run(services => Store(services).UpdateStandAsync(SeededOccAccount, b01,
            new UpdateStandInput(b01Row.TerminalId!.Value, "B99", b01Row.HasBoardingBridge, b01Row.IsRemote,
                b01Row.MaxAircraftSize, true, b01Row.Version), Guid.NewGuid(), ct))).Code);
        var rejected = await Run(services => services.GetRequiredService<IPositionCoverageStore>().UpdateStandAsync(
            SeededOccAccount, b01, new StandAttributesInput(b01Row.HasBoardingBridge, b01Row.IsRemote, b01Row.MaxAircraftSize, false),
            today, ct));
        Assert.Equal((PositionCoverageFailure.Rejected, "stand_in_use"), (rejected.Failure, rejected.Code));
        Assert.Equal(["stand_in_use"], rejected.Reasons);
        Assert.Equal("aircraft_type_in_use", (await Run(services => Store(services).UpdateAircraftTypeAsync(SeededOccAccount,
            b738.Value.Id, new UpdateAircraftTypeInput("73H", "Boeing", "737-800", "Narrowbody", false, b738.Value.Version),
            Guid.NewGuid(), ct))).Code);
        var edited = await Run(services => Store(services).UpdateAircraftTypeAsync(SeededOccAccount, b738.Value.Id,
            new UpdateAircraftTypeInput(null, "Boeing", "737-800 Winglets", "Narrowbody", true, b738.Value.Version), Guid.NewGuid(),
            ct));
        Assert.Equal(("737-800 Winglets", (string?)null), (edited.Value!.Model, edited.Value.IataCode));

        // Once the flight is cancelled nothing holds them any more.
        await using (var context = CreateContext(database.ConnectionString))
            await context.Turnarounds.Where(item => item.PublicId == manualId)
                .ExecuteUpdateAsync(set => set.SetProperty(item => item.CurrentStatus, TurnaroundStatus.Cancelled), ct);
        Assert.False((await Run(services => Store(services).UpdateAircraftTypeAsync(SeededOccAccount, b738.Value.Id,
            new UpdateAircraftTypeInput(null, "Boeing", "737-800 Winglets", "Narrowbody", false, edited.Value.Version),
            Guid.NewGuid(), ct))).Value!.IsActive);
    }
}
