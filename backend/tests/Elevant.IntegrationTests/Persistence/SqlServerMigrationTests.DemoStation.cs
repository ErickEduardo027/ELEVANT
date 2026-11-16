using System.Globalization;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Common;
using Elevant.Application.Integration.DemoFlights;
using Elevant.Application.Operations.DemoStation;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Integration;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Enumerations;
using Elevant.Persistence;
using Elevant.Persistence.Audit;
using Elevant.Persistence.Operations;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>
/// ADR-0041, contracts 1.1 and 1.2, against SQL Server. «Cargar posiciones de Punta Cana» only creates: the catalogue's
/// terminals and stands the station lacks, active and without coordinates, while every row the station had stays as it
/// was. The demo flight options judge every stand with OCC's real assignment rule: a stand is eligible only when the map
/// knows it, it is free for the visit and an agent who covers it when the aircraft parks may be assigned to the flight.
/// «Al azar» draws among those with the Idempotency-Key as the seed, and a stand chosen by hand must be one of them.
/// </summary>
public sealed partial class SqlServerMigrationTests
{
    private static readonly string[] DemoStationAuditActions =
        ["occ.terminal.created", "occ.stand.created", "governance.demo_station.prepared"];

    /// <summary>The seeded station with demo flights on (or off) and «Cargar posiciones de Punta Cana».</summary>
    private sealed class DemoStationFixture(ServiceProvider provider, string connection, CancellationToken ct) : IAsyncDisposable
    {
        public string Connection => connection;

        public ValueTask DisposeAsync() => provider.DisposeAsync();

        public async Task<T> Run<T>(Func<IServiceProvider, Task<T>> action)
        {
            await using var scope = provider.CreateAsyncScope();
            return await action(scope.ServiceProvider);
        }

        public Task<MasterDataResult<DemoStationLayoutData>> Prepare(Guid? key = null, Guid? station = null,
            Guid? actor = null) =>
            Run(services => services.GetRequiredService<DemoStationHandler>().PrepareAsync(actor ?? SuperAdministratorAccount,
                station ?? SeededPujStation, key ?? Guid.NewGuid(), ct));

        /// <summary>The <c>occ_planning</c> announcements queued for the station's OCC accounts.</summary>
        public async Task<int> PlanningHints()
        {
            await using var context = CreateContext(connection);
            return (await context.OutboxMessages.AsNoTracking().Where(item => item.EventType == "account.changed.v1")
                    .ToArrayAsync(ct)).Select(AccountChangeOutboxWriter.Decode)
                .Count(item => item.Resource == "occ_planning" && item.ResourceId == SeededPujStation);
        }

        /// <summary>The OCC accounts that have the station in scope: each announcement reaches every one.</summary>
        public async Task<int> OccAccounts()
        {
            await using var context = CreateContext(connection);
            var station = await context.Stations.AsNoTracking().Where(item => item.PublicId == SeededPujStation)
                .Select(item => item.Id).SingleAsync(ct);
            return (await OperationalNotificationWriter.OccRecipientsAsync(context, station, DateTimeOffset.UtcNow, null, ct))
                .Length;
        }

        /// <summary>The audit entries of the command after the entry <paramref name="after"/>, in the order written.</summary>
        public async Task<AuditEntry[]> Audits(long after = 0)
        {
            await using var context = CreateContext(connection);
            return await context.AuditEntries.AsNoTracking()
                .Where(item => item.Id > after && DemoStationAuditActions.Contains(item.Action)).OrderBy(item => item.Id)
                .ToArrayAsync(ct);
        }

        public async Task<long> LastAudit()
        {
            await using var context = CreateContext(connection);
            return await context.AuditEntries.AsNoTracking().MaxAsync(item => (long?)item.Id, ct) ?? 0;
        }

        /// <summary>
        /// Every terminal and stand of PUJ by key, with everything the command must never change on a row the station
        /// had, its last change and its row version included.
        /// </summary>
        public async Task<(Dictionary<long, string> Terminals, Dictionary<long, string> Stands)> Rows()
        {
            await using var context = CreateContext(connection);
            var station = await context.Stations.AsNoTracking().Where(item => item.PublicId == SeededPujStation)
                .Select(item => item.Id).SingleAsync(ct);
            var terminals = await context.Terminals.AsNoTracking().Where(item => item.StationId == station).ToArrayAsync(ct);
            var stands = await context.Stands.AsNoTracking().Where(item => item.StationId == station).ToArrayAsync(ct);
            return (terminals.ToDictionary(item => item.Id, item => string.Create(CultureInfo.InvariantCulture,
                    $"{item.Code}|{item.Name}|{item.IsActive}|{item.MaxStandsPerAgent}|{item.RequiresBridgeQualification}|{item.UpdatedAt:O}|{Convert.ToBase64String(item.RowVersion)}")),
                stands.ToDictionary(item => item.Id, item => string.Create(CultureInfo.InvariantCulture,
                    $"{item.Code}|{item.TerminalId}|{item.StandType}|{item.IsActive}|{item.HasBoardingBridge}|{item.IsRemote}|{item.MaxAircraftSize}|{item.Latitude}|{item.Longitude}|{item.LocatedAt:O}|{item.UpdatedAt:O}|{Convert.ToBase64String(item.RowVersion)}")));
        }
    }

    /// <summary>The Development seed with demo flights on: terminals A and B, A01 and A02, B01 and B02, nothing placed.</summary>
    private static async Task<DemoStationFixture> DemoStationAsync(TemporaryDatabase database, CancellationToken ct)
    {
        await using (await SeededFinanceProviderAsync(database, ct)) { }
        return new DemoStationFixture(DemoStationServices(database.ConnectionString, DemoFlightAvailability.On),
            database.ConnectionString, ct);
    }

    private static ServiceProvider DemoStationServices(string connection, DemoFlightAvailability availability) =>
        new ServiceCollection().AddLogging()
            .AddSingleton(TimeProvider.System)
            .AddSingleton(availability)
            .AddScoped<DemoStationHandler>()
            .AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ElevantDatabase"] = connection,
            }).Build()).BuildServiceProvider(new ServiceProviderOptions { ValidateOnBuild = true, ValidateScopes = true });

    /// <summary>The station against the catalogue as the tests compare it, its lists joined with «|».</summary>
    private static (Guid StationId, string StationCode, bool Supported, int CatalogTerminals, int Terminals, int CatalogStands,
        int Stands, int ActiveStands, int LocatedStands, string Missing, string Unmatched, bool Complete)
        LayoutRow(DemoStationLayoutData layout) =>
        (layout.StationId, layout.StationCode, layout.Supported, layout.CatalogTerminals, layout.Terminals,
            layout.CatalogStands, layout.Stands, layout.ActiveStands, layout.LocatedStands, string.Join('|', layout.MissingStands),
            string.Join('|', layout.UnmatchedStands), layout.Complete);

    private static Dictionary<string, (string? Before, string? After)> AuditChanges(AuditEntry entry)
    {
        Assert.NotNull(entry.MetadataJson);
        return SafeAuditChanges.Parse(entry.MetadataJson).ToDictionary(change => change.Field,
            change => (change.Before, change.After));
    }

    /// <summary>
    /// On the seed the command creates the FBO terminal and the 39 stands of the catalogue the station lacks, each with the
    /// catalogue's attributes, active and without coordinates; it adopts A01 and A02 as they are and leaves B01 and B02,
    /// which the catalogue does not have, untouched. Every new row is audited with its metadata, OCC hears it once, and
    /// a replay or a second run answer the same and write nothing.
    /// </summary>
    [Fact]
    public async Task DemoStationCreatesTheLayoutOnceAndAdoptsTheSeededStands()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var station = await DemoStationAsync(database, ct);
        var before = await station.Rows();
        Assert.Equal((2, 4), (before.Terminals.Count, before.Stands.Count));
        var occAccounts = await station.OccAccounts();
        Assert.True(occAccounts > 0);
        var hints = await station.PlanningHints();
        var lastAudit = await station.LastAudit();

        var key = Guid.NewGuid();
        var prepared = await station.Prepare(key);
        Assert.Null(prepared.Failure);
        Assert.False(prepared.Replayed);
        var expected = (SeededPujStation, "PUJ", true, 3, 3, 41, 41, 43, 41, "", "B01|B02", true);
        Assert.Equal(expected, LayoutRow(prepared.Value!));

        var after = await station.Rows();
        Assert.Equal((3, 43), (after.Terminals.Count, after.Stands.Count));
        // What the station had is exactly as it was: A01 and A02 (the catalogue's A1 and A2), B01, B02 and both terminals.
        Assert.All(before.Terminals, pair => Assert.Equal(pair.Value, after.Terminals[pair.Key]));
        Assert.All(before.Stands, pair => Assert.Equal(pair.Value, after.Stands[pair.Key]));
        Dictionary<string, Guid> terminalIds;
        await using (var check = CreateContext(database.ConnectionString))
        {
            var puj = await check.Stations.AsNoTracking().Where(item => item.PublicId == SeededPujStation)
                .Select(item => item.Id).SingleAsync(ct);
            var terminals = await check.Terminals.AsNoTracking().Where(item => item.StationId == puj).ToArrayAsync(ct);
            terminalIds = terminals.ToDictionary(item => item.Code, item => item.PublicId);
            var fbo = Assert.Single(terminals, item => !before.Terminals.ContainsKey(item.Id));
            Assert.Equal(("FBO", "FBO / Aviación local", true, (int?)null, false),
                (fbo.Code, fbo.Name, fbo.IsActive, fbo.MaxStandsPerAgent, fbo.RequiresBridgeQualification));
            var codes = terminals.ToDictionary(item => item.Id, item => item.Code);
            var created = await check.Stands.AsNoTracking().Where(item => item.StationId == puj).ToArrayAsync(ct);
            created = created.Where(item => !before.Stands.ContainsKey(item.Id)).ToArray();
            // Each one as the catalogue has it, in its terminal; active and placed nowhere: the map draws it by its code.
            Assert.Equal(PuntaCanaStationLayout.Stands.Where(stand => stand.Code is not ("A1" or "A2"))
                    .Select(stand => (stand.Code, stand.TerminalCode, stand.StandType, stand.HasBoardingBridge, stand.IsRemote,
                        stand.MaxAircraftSize))
                    .OrderBy(item => item.Code, StringComparer.Ordinal),
                created.Select(item => (item.Code, codes[item.TerminalId!.Value], item.StandType!, item.HasBoardingBridge,
                    item.IsRemote, item.MaxAircraftSize)).OrderBy(item => item.Code, StringComparer.Ordinal));
            Assert.All(created, item => Assert.Equal((true, (decimal?)null, (decimal?)null, (DateTimeOffset?)null),
                (item.IsActive, item.Latitude, item.Longitude, item.LocatedAt)));
        }

        // One audit entry per new row, as OCC's master data writes them, and one for the command; none is empty.
        var audits = await station.Audits(lastAudit);
        Assert.Equal((1, 39, 1), (audits.Count(item => item.Action == "occ.terminal.created"),
            audits.Count(item => item.Action == "occ.stand.created"),
            audits.Count(item => item.Action == "governance.demo_station.prepared")));
        Assert.All(audits, item => Assert.Equal((AuditActorType.Account, AuditSource.Api), (item.ActorType, item.Source)));
        Assert.All(audits, item => Assert.NotEmpty(AuditChanges(item)));
        Assert.Equal(new Dictionary<string, (string?, string?)>
        {
            ["terminal.code"] = (null, "FBO"), ["terminal.name"] = (null, "FBO / Aviación local"), ["terminal.active"] = (null, "true"),
        }, AuditChanges(audits.Single(item => item.Action == "occ.terminal.created")));
        var bn6 = audits.Where(item => item.Action == "occ.stand.created").Select(AuditChanges)
            .Single(changes => changes["stand.code"].After == "BN6");
        Assert.Equal(new Dictionary<string, (string?, string?)>
        {
            ["stand.code"] = (null, "BN6"), ["stand.terminal"] = (null, terminalIds["FBO"].ToString()),
            ["stand.bridge"] = (null, "false"), ["stand.remote"] = (null, "true"), ["stand.max_size"] = (null, "Narrowbody"),
            ["stand.active"] = (null, "true"),
        }, bn6);
        var summary = audits.Single(item => item.Action == "governance.demo_station.prepared");
        Assert.Equal(("ref.stations", (Guid?)SeededPujStation), (summary.EntityType, summary.EntityPublicId));
        Assert.Equal(new Dictionary<string, (string?, string?)>
        {
            ["demo_station.terminals_created"] = (null, "1"), ["demo_station.stands_created"] = (null, "39"),
            ["demo_station.stands_adopted"] = (null, "2"),
        }, AuditChanges(summary));
        // Every OCC account of the station is told once.
        Assert.Equal(hints + occAccounts, await station.PlanningHints());

        // The same key answers the same state; a new key finds nothing to create. Neither writes a row, an audit entry
        // or an announcement.
        var replay = await station.Prepare(key);
        Assert.Equal((true, expected), (replay.Replayed, LayoutRow(replay.Value!)));
        var again = await station.Prepare();
        Assert.Equal((false, expected), (again.Replayed, LayoutRow(again.Value!)));
        var unchanged = await station.Rows();
        Assert.Equal(after.Terminals, unchanged.Terminals);
        Assert.Equal(after.Stands, unchanged.Stands);
        Assert.Equal(41, (await station.Audits(lastAudit)).Length);
        Assert.Equal(hints + occAccounts, await station.PlanningHints());
    }

    /// <summary>
    /// Whatever OCC did to its stations' rows stays: a stand OCC placed keeps its location, a stand OCC renamed is still
    /// adopted by its normalized code, and nothing inactive is created again or reactivated, so its stands stay missing.
    /// </summary>
    [Fact]
    public async Task DemoStationNeverTouchesAStandOccPlacedOrRenamed()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var station = await DemoStationAsync(database, ct);
        var today = BusinessCalendar.Today(DateTimeOffset.UtcNow, StationZone);
        // OCC placed A01 on the map and renamed A02 «A-2»; it created A3 and an FBO terminal and deactivated both.
        Assert.Null((await station.Run(services => services.GetRequiredService<IOccPositionStore>()
            .LocateStandAsync(SeededOccAccount, SeededStandA01, 18.5674123m, -68.3634567m, today, ct))).Failure);
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var puj = await setup.Stations.SingleAsync(item => item.PublicId == SeededPujStation, ct);
            var terminalA = await setup.Terminals.SingleAsync(item => item.StationId == puj.Id && item.Code == "A", ct);
            await setup.Stands.Where(item => item.StationId == puj.Id && item.Code == "A02")
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.Code, "A-2"), ct);
            setup.Stands.Add(new Stand
            {
                PublicId = Guid.CreateVersion7(), StationId = puj.Id, TerminalId = terminalA.Id, Code = "A3", StandType = "Contact",
                IsActive = false, CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
            });
            setup.Terminals.Add(new Terminal
            {
                PublicId = Guid.CreateVersion7(), StationId = puj.Id, Code = "FBO", Name = "FBO cerrado", IsActive = false,
                CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
            });
            await setup.SaveChangesAsync(ct);
        }
        var before = await station.Rows();
        var lastAudit = await station.LastAudit();

        var prepared = await station.Prepare();
        Assert.Null(prepared.Failure);
        // A3 and the FBO stands stay missing: OCC turned them off. A01 and «A-2» are the catalogue's A1 and A2.
        var expected = (SeededPujStation, "PUJ", true, 3, 2, 41, 32, 34, 32, "A3|BN6|BN7|BN8|BN9|BN10|BN11|BN12|BN13",
            "B01|B02", false);
        Assert.Equal(expected, LayoutRow(prepared.Value!));
        var after = await station.Rows();
        Assert.All(before.Terminals, pair => Assert.Equal(pair.Value, after.Terminals[pair.Key]));
        Assert.All(before.Stands, pair => Assert.Equal(pair.Value, after.Stands[pair.Key]));
        Assert.Equal((before.Terminals.Count, before.Stands.Count + 30), (after.Terminals.Count, after.Stands.Count));
        await using (var check = CreateContext(database.ConnectionString))
        {
            var placed = await check.Stands.AsNoTracking().SingleAsync(item => item.PublicId == SeededStandA01, ct);
            Assert.Equal((18.567412m, -68.363457m, true), (placed.Latitude, placed.Longitude, placed.LocatedAt is not null));
            var puj = await check.Stations.AsNoTracking().Where(item => item.PublicId == SeededPujStation)
                .Select(item => item.Id).SingleAsync(ct);
            var codes = await check.Stands.AsNoTracking().Where(item => item.StationId == puj).Select(item => item.Code)
                .ToArrayAsync(ct);
            Assert.DoesNotContain("A2", codes);
            Assert.DoesNotContain("BN6", codes);
            Assert.Single(codes, code => code == "A3");
        }
        var audits = await station.Audits(lastAudit);
        Assert.Equal((0, 30), (audits.Count(item => item.Action == "occ.terminal.created"),
            audits.Count(item => item.Action == "occ.stand.created")));
        Assert.Equal(new Dictionary<string, (string?, string?)>
        {
            ["demo_station.terminals_created"] = (null, "0"), ["demo_station.stands_created"] = (null, "30"),
            ["demo_station.stands_adopted"] = (null, "2"),
        }, AuditChanges(audits.Single(item => item.Action == "governance.demo_station.prepared")));

        // A second run finds nothing it may create.
        var again = await station.Prepare();
        Assert.Equal(expected, LayoutRow(again.Value!));
        Assert.Equal(after.Stands, (await station.Rows()).Stands);
        Assert.Equal(audits.Length, (await station.Audits(lastAudit)).Length);
    }

    /// <summary>
    /// Only Punta Cana has a catalogue, only an active station can be loaded and only the superadministrator loads it,
    /// where demo flights are on. No refusal writes anything.
    /// </summary>
    [Fact]
    public async Task DemoStationRefusesOtherStationsAndOccAccounts()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var station = await DemoStationAsync(database, ct);
        static (MasterDataFailure?, string?) Refusal(MasterDataResult<DemoStationLayoutData> result) =>
            (result.Failure, result.Code);
        Guid other;
        Guid closed;
        await using (var setup = CreateContext(database.ConnectionString))
        {
            static Airport NewAirport(string iata, string icao) => new()
            {
                PublicId = Guid.CreateVersion7(), IataCode = iata, IcaoCode = icao, Name = $"Synthetic {iata}", City = iata,
                CountryCode = "DO", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
            };
            var otherAirport = NewAirport("XQS", "XQSS");
            var closedAirport = NewAirport("XQC", "XQCC");
            setup.Airports.AddRange(otherAirport, closedAirport);
            await setup.SaveChangesAsync(ct);
            static Station NewStation(string code, Airport airport, bool active) => new()
            {
                PublicId = Guid.CreateVersion7(), AirportId = airport.Id, Code = code, Name = $"Synthetic {code}",
                IanaTimeZone = StationZone, IsActive = active, CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
            };
            var otherStation = NewStation("XQS", otherAirport, true);
            var closedStation = NewStation("XQC", closedAirport, false);
            setup.Stations.AddRange(otherStation, closedStation);
            await setup.SaveChangesAsync(ct);
            (other, closed) = (otherStation.PublicId, closedStation.PublicId);
        }
        var before = await station.Rows();
        var lastAudit = await station.LastAudit();

        Assert.Equal((MasterDataFailure.Conflict, "demo_station_unsupported"), Refusal(await station.Prepare(station: other)));
        Assert.Equal((MasterDataFailure.NotFound, "station_unavailable"), Refusal(await station.Prepare(station: closed)));
        Assert.Equal((MasterDataFailure.NotFound, "station_unavailable"), Refusal(await station.Prepare(station: Guid.NewGuid())));
        Assert.Equal((MasterDataFailure.NotFound, "station_unavailable"), Refusal(await station.Prepare(station: Guid.Empty)));
        // An OCC account, through the handler and at the store itself, whoever calls it; the key is asked for there too.
        Assert.Equal((MasterDataFailure.Forbidden, "forbidden"), Refusal(await station.Prepare(actor: SeededOccAccount)));
        Assert.Equal((MasterDataFailure.Forbidden, "forbidden"), Refusal(await station.Run(services =>
            services.GetRequiredService<IDemoStationStore>().PrepareAsync(SeededOccAccount, SeededPujStation, Guid.NewGuid(), ct))));
        Assert.Equal((MasterDataFailure.Invalid, "idempotency_key_required"), Refusal(await station.Run(services =>
            services.GetRequiredService<IDemoStationStore>().PrepareAsync(SuperAdministratorAccount, SeededPujStation, Guid.Empty,
                ct))));
        // Where demo flights are off the stands are not loaded either.
        await using (var off = DemoStationServices(database.ConnectionString, DemoFlightAvailability.Disabled))
        {
            await using var scope = off.CreateAsyncScope();
            Assert.Equal((MasterDataFailure.Conflict, "demo_flights_unavailable"), Refusal(await scope.ServiceProvider
                .GetRequiredService<DemoStationHandler>().PrepareAsync(SuperAdministratorAccount, SeededPujStation, Guid.NewGuid(),
                    ct)));
        }

        var after = await station.Rows();
        Assert.Equal(before.Terminals, after.Terminals);
        Assert.Equal(before.Stands, after.Stands);
        Assert.Empty(await station.Audits(lastAudit));
        await using var check = CreateContext(database.ConnectionString);
        var otherKey = await check.Stations.AsNoTracking().Where(item => item.PublicId == other).Select(item => item.Id)
            .SingleAsync(ct);
        Assert.False(await check.Terminals.AnyAsync(item => item.StationId == otherKey, ct));
    }

    /// <summary>
    /// A stand is eligible only when an agent who covers it when the aircraft parks passes OCC's assignment rule; the
    /// options say who covers it, how many of them may take the flight and, when none may, the rule's reasons: nobody
    /// covers it, a shift in another terminal, a document out of date, no account for the tablet, a junior without a
    /// mentor, three operations at once although the demo flight has none yet. A stand the map does not know is never
    /// eligible, until OCC places it.
    /// </summary>
    [Fact]
    public async Task DemoOptionsMarkAStandEligibleOnlyWhenACoveringAgentPassesTheAssignmentRule()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var demo = await DemoFlightsAsync(database, ct);
        var connection = database.ConnectionString;
        await AddPujStandAsync(connection, "A04", "A", ct);
        async Task<(string, bool, string, int, bool, string)[]> Stands() =>
            (await demo.Options()).Stands.Select(DemoStandRow).ToArray();
        // A01 to A03, which the seeded agent covers, as the agent's verdict leaves them.
        static (string, bool, string, int, bool, string)[] Covered(string reasons) =>
            [.. DemoCoveredStands.Select(code => (code, true, "Riley Ramp", reasons.Length == 0 ? 1 : 0,
                reasons.Length == 0, reasons))];

        // The seeded agent covers A01 to A03 and passes the rule; nobody covers A04; B01 to B03 are no catalogue stands.
        Assert.Equal(
            [
                ("A01", true, "Riley Ramp", 1, true, ""), ("A02", true, "Riley Ramp", 1, true, ""),
                ("A03", true, "Riley Ramp", 1, true, ""), ("A04", true, "", 0, false, "stand_not_covered"),
                ("B01", false, "", 0, false, ""), ("B02", false, "", 0, false, ""), ("B03", false, "", 0, false, ""),
            ], await Stands());
        Assert.Empty((await demo.Options()).Warnings);

        // An agent of Terminal B covers A04: they work their shift in the other terminal.
        var xavier = await EligibleRampAgentAsync(demo.Provider, connection, "Xavier", "QA-RA-402", "40212345603",
            "xavier.demo@dev.elevant.test", demo.Day, "B", ["A", "B"], ct);
        await CoverStandsAsync(connection, xavier.Agent, ["A04"], LocalAt(demo.Day, 5), LocalAt(demo.Day, 21), ct);
        Assert.Equal(("A04", true, "Xavier Prueba", 0, false, "shift_not_compatible"), (await Stands())[3]);

        // The seeded agent's airport ID is out of date: none of the stands has an eligible agent, and the options say why.
        async Task SetAirportId(bool current)
        {
            await using var setup = CreateContext(connection);
            await setup.AirportPermitCycles.Where(item => item.RampAgentId == demo.Agent &&
                    item.DocumentType == PermitDocumentType.AirportId)
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.IsCurrent, current), ct);
        }
        await SetAirportId(false);
        Assert.Equal(Covered("airport_id_not_current"), (await Stands())[..3]);
        Assert.Equal([("no_eligible_stand", "airport_id_not_current|shift_not_compatible")],
            (await demo.Options()).Warnings.Select(DemoWarningRow));
        await SetAirportId(true);

        // The account of the tablet is locked.
        async Task SetLockout(DateTimeOffset? until)
        {
            await using var setup = CreateContext(connection);
            await setup.Users.Where(item => item.PublicId == SeededRampAgentAccount)
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.LockoutEnd, until), ct);
        }
        await SetLockout(demo.Now.AddDays(1));
        Assert.Equal(Covered("mobile_account_unavailable"), (await Stands())[..3]);
        await SetLockout(null);

        // Hired a month ago, the agent never works alone; a coverage that names a mentor makes them eligible again.
        async Task SetHireDate(DateOnly date)
        {
            await using var setup = CreateContext(connection);
            await setup.RampAgents.Where(item => item.Id == demo.Agent)
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.HireDate, date), ct);
        }
        await SetHireDate(demo.Day.AddMonths(-1));
        Assert.Equal(Covered("mentor_required"), (await Stands())[..3]);
        await CoverStandsAsync(connection, demo.Agent, ["A01"], LocalAt(demo.Day, 5), LocalAt(demo.Day, 21), ct, xavier.Agent);
        Assert.Equal(Covered(""), (await Stands())[..3]);
        await SetHireDate(new DateOnly(2026, 1, 1));

        // Three operations of the agent overlap the visit: a fourth is one too many, although the demo flight has no
        // operation of its own yet to leave out of the count.
        await using (var setup = CreateContext(connection))
        {
            var fixture = await ReleaseFixtureAsync(setup, ct);
            foreach (var code in new[] { "DEV-DEMO-BUSY-1", "DEV-DEMO-BUSY-2", "DEV-DEMO-BUSY-3" })
                await AddAgentOperationAsync(setup, fixture, code, demo.Day, demo.Agent, GroundOperationStatus.Assigned, ct);
        }
        Assert.Equal(Covered("assignment_conflict"), (await Stands())[..3]);

        // B03 is no stand of the catalogue: the map knows it once OCC places it, and then nobody covers it.
        Assert.Equal(("B03", false, "", 0, false, ""), (await Stands())[^1]);
        Assert.Null((await demo.Run(services => services.GetRequiredService<IOccPositionStore>()
            .LocateStandAsync(SeededOccAccount, demo.Stands["B03"], 18.5681m, -68.3621m, demo.Day, ct))).Failure);
        Assert.Equal(("B03", true, "", 0, false, "stand_not_covered"), (await Stands())[^1]);
    }

    /// <summary>
    /// «Al azar» draws one of the eligible stands with the Idempotency-Key as the seed: the replay answers the same stand,
    /// each draw leaves out the stands other active demo aircraft go to, and a stand nobody covers is never drawn.
    /// </summary>
    [Fact]
    public async Task TheRandomDrawIsStableOnAReplayAndOnlyPicksEligibleStands()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var demo = await DemoFlightsAsync(database, ct);
        await AddPujStandAsync(database.ConnectionString, "A04", "A", ct);
        var random = demo.Command() with { StandChoice = "Random" };
        async Task<string> DrawnWith(Guid key)
        {
            var eligible = (await demo.Options()).Stands.Where(item => item.Eligible).ToArray();
            Assert.DoesNotContain(eligible, item => item.Code == "A04");
            var drawn = await demo.Trigger(random, key);
            Assert.True(drawn.Failure is null, drawn.Code);
            // The stand the key draws among the eligible ones, whatever order they come in.
            Assert.Equal(eligible.Single(item => item.StandId == DemoStandDraw.Pick(eligible.Select(stand => stand.StandId)
                .Reverse().ToArray(), key)).Code, drawn.Value!.SuggestedStandCode);
            return drawn.Value.SuggestedStandCode!;
        }

        var key = Guid.NewGuid();
        var first = await DrawnWith(key);
        var flight = (await demo.Listed()).Single();
        var replay = await demo.Trigger(random, key);
        Assert.Equal((flight.Id, true, first), (replay.Value!.Id, replay.Replayed, replay.Value.SuggestedStandCode));
        var rows = await demo.Rows(flight.Id);
        Assert.Equal(("A", first, "A", first), (rows.Arrival.Terminal, rows.Arrival.Gate, rows.Departure.Terminal,
            rows.Departure.Gate));
        var created = AuditChanges(Assert.Single(await demo.Audits(flight.Id)));
        Assert.Equal(((string?)null, "Random", (string?)null, first),
            (created["demo_flight.stand_choice"].Before, created["demo_flight.stand_choice"].After,
                created["demo_flight.stand"].Before, created["demo_flight.stand"].After));

        // The next draws leave out the stands the active demo aircraft go to: the three covered stands, once each.
        var second = await DrawnWith(Guid.NewGuid());
        var third = await DrawnWith(Guid.NewGuid());
        Assert.Equal(["A01", "A02", "A03"], new[] { first, second, third }.Order(StringComparer.Ordinal));
        // Three demo aircraft are the station's limit: it answers before any stand is drawn.
        var limited = await demo.Trigger(random);
        Assert.Equal((MasterDataFailure.Conflict, "demo_flight_limit_reached"), (limited.Failure, limited.Code));

        // The first one is cancelled: its stand is the only eligible one again, and A04 is still never drawn.
        Assert.Null((await demo.End(flight.Id, "Cancel")).Failure);
        Assert.Equal(first, await DrawnWith(Guid.NewGuid()));
    }

    /// <summary>
    /// A stand chosen by hand must be eligible too: one nobody covers, one the map does not know and one whose agent the
    /// rule refuses are refused with their reasons, and nothing is written.
    /// </summary>
    [Fact]
    public async Task ASpecificStandWithoutAnEligibleAgentIsRefused()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var demo = await DemoFlightsAsync(database, ct);
        await AddPujStandAsync(database.ConnectionString, "A04", "A", ct);
        var a04 = (await demo.Stand("A04")).StandId;
        static (MasterDataFailure?, string?, string) Refusal(MasterDataResult<DemoFlightData> result) =>
            (result.Failure, result.Code, string.Join('|', result.Reasons ?? []));

        Assert.Equal((MasterDataFailure.Conflict, "stand_not_eligible", "stand_not_covered"),
            Refusal(await demo.Trigger(demo.Command(stand: a04))));
        Assert.Equal((MasterDataFailure.Conflict, "stand_not_eligible", "stand_not_located"),
            Refusal(await demo.Trigger(demo.Command(stand: demo.Stands["B03"]))));
        await using (var setup = CreateContext(database.ConnectionString))
            await setup.AirportPermitCycles.Where(item => item.RampAgentId == demo.Agent &&
                    item.DocumentType == PermitDocumentType.AirportId)
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.IsCurrent, false), ct);
        Assert.Equal((MasterDataFailure.Conflict, "stand_not_eligible", "airport_id_not_current"),
            Refusal(await demo.Trigger(demo.Command(stand: demo.Stands["A02"]))));
        // A stand the visit cannot take says so first, as before.
        var planned = await PlanManualFlightAsync(demo.Provider, demo.Airline, demo.Stands["A01"], demo.Day, "ZZ951",
            demo.Now.AddMinutes(5), demo.Now.AddMinutes(50), ct);
        Assert.True(planned.IsSuccess, planned.Code);
        Assert.Equal((MasterDataFailure.Conflict, "stand_unavailable", "stand_taken"),
            Refusal(await demo.Trigger(demo.Command(stand: demo.Stands["A01"]))));
        await using (var check = CreateContext(database.ConnectionString))
        {
            Assert.False(await check.Set<ExternalFlightProposal>().AnyAsync(item => item.Provider == DemoProvider, ct));
            Assert.False(await check.AuditEntries.AnyAsync(item => item.Action.StartsWith("governance.demo_flight."), ct));
        }

        // With the agent's documents in order the same stand is taken.
        await using (var setup = CreateContext(database.ConnectionString))
            await setup.AirportPermitCycles.Where(item => item.RampAgentId == demo.Agent &&
                    item.DocumentType == PermitDocumentType.AirportId)
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.IsCurrent, true), ct);
        Assert.Equal("A02", (await demo.Triggered(stand: demo.Stands["A02"])).SuggestedStandCode);
    }

    /// <summary>
    /// With no eligible stand the options warn with the reasons and «Al azar» has nothing to draw, while «Sin posición»
    /// still triggers the flight; with no stand the map knows, they warn about that too.
    /// </summary>
    [Fact]
    public async Task WithoutAnEligibleStandTheOptionsWarnAndRandomAnswersNoEligibleStand()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var demo = await DemoFlightsAsync(database, ct, covered: []);

        var options = await demo.Options();
        Assert.DoesNotContain(options.Stands, item => item.Eligible);
        Assert.Equal([("no_eligible_stand", "stand_not_covered")], options.Warnings.Select(DemoWarningRow));
        var random = await demo.Trigger(demo.Command() with { StandChoice = "Random" });
        Assert.Equal((MasterDataFailure.Conflict, "no_eligible_stand", "stand_not_covered"),
            (random.Failure, random.Code, string.Join('|', random.Reasons ?? [])));
        await using (var check = CreateContext(database.ConnectionString))
            Assert.False(await check.Set<ExternalFlightProposal>().AnyAsync(item => item.Provider == DemoProvider, ct));
        // «Disparar sin posición»: OCC assigns the stand when it imports the flight.
        Assert.Null((await demo.Triggered()).SuggestedStandCode);

        // Only stands outside the catalogue are left: the map knows none of them.
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var puj = await setup.Stations.AsNoTracking().Where(item => item.PublicId == SeededPujStation)
                .Select(item => item.Id).SingleAsync(ct);
            await setup.Stands.Where(item => item.StationId == puj &&
                    (item.Code == "A01" || item.Code == "A02" || item.Code == "A03"))
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.IsActive, false), ct);
        }
        var unlocated = await demo.Options();
        Assert.Equal(["B01", "B02", "B03"], unlocated.Stands.Select(item => item.Code));
        Assert.Equal([("no_located_stands", ""), ("no_eligible_stand", "")], unlocated.Warnings.Select(DemoWarningRow));
    }

    /// <summary>
    /// The options evaluate the visit the form asks about: a wide-body is not free on a narrow-body stand, a flight
    /// planned later only overlaps the longer visit (and cancels the stand a combined-stand rule ties to its own), every
    /// stand is judged as each command that places a flight judges it, and an agent whose shift ends before the aircraft
    /// parks may not take it although their coverage goes on.
    /// </summary>
    [Fact]
    public async Task OptionsUseTheFormWindowAndTheAircraftSize()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var demo = await DemoFlightsAsync(database, ct, start: day => LocalAt(day, 20, 40));
        // Punta Cana's stands are loaded: BN6 to BN13 admit narrow-bodies only.
        var prepared = await demo.Run(services => services.GetRequiredService<IDemoStationStore>()
            .PrepareAsync(SuperAdministratorAccount, SeededPujStation, Guid.NewGuid(), ct));
        Assert.True(prepared.Value!.Complete);
        var wide = await AircraftTypeAsync(database.ConnectionString, "A333", ct);
        DemoFlightOptionsQuery Visit(int minutes, int ground = 60, Guid? type = null) =>
            new(SeededPujStation, type, minutes, ground);

        Assert.True((await demo.Stand("BN6", Visit(8, type: demo.AircraftType))).Free);
        Assert.True((await demo.Stand("BN6", Visit(8))).Free);
        var bn6 = await demo.Stand("BN6", Visit(8, type: wide));
        Assert.Equal((false, false, ""), (bn6.Free, bn6.Eligible, string.Join('|', bn6.Reasons)));
        Assert.True((await demo.Stand("A01", Visit(8, type: wide))).Free);

        // A flight is planned on A02 from 21:30: a visit of an hour from 20:48 overlaps it, one of twenty minutes does not.
        var planned = await PlanManualFlightAsync(demo.Provider, demo.Airline, demo.Stands["A02"], demo.Day, "ZZ953",
            LocalAt(demo.Day, 21, 30), LocalAt(demo.Day, 22, 30), ct);
        Assert.True(planned.IsSuccess, planned.Code);
        Assert.False((await demo.Stand("A02", Visit(8))).Free);
        Assert.True((await demo.Stand("A02", Visit(8, ground: 20))).Eligible);
        // A combined stand (ADR-0030): while A02 is occupied it cancels A03, which is not free for the hour either.
        Assert.Null((await demo.Run(services => services.GetRequiredService<IPositionCoverageStore>()
            .AddConstraintAsync(SeededOccAccount, new StandConstraintInput(demo.Stands["A02"], demo.Stands["A03"], "Cancels"),
                demo.Day, ct))).Failure);
        Assert.False((await demo.Stand("A03", Visit(8))).Free);
        Assert.True((await demo.Stand("A03", Visit(8, ground: 20))).Free);

        // The options judge the whole station with one read of the flights and of the rules, and answer for every stand
        // what the check of each command that places a flight answers for it.
        await using (var check = CreateContext(database.ConnectionString))
        {
            var puj = await check.Stations.AsNoTracking().Where(item => item.PublicId == SeededPujStation)
                .Select(item => item.Id).SingleAsync(ct);
            var (start, end) = (demo.Now.AddMinutes(8), demo.Now.AddMinutes(68));
            var evaluated = await StandAvailability.EvaluateAsync(check, puj, start, end, AircraftSizeCategory.Widebody,
                null, ct);
            var usable = await (from stand in check.Stands.AsNoTracking()
                                join terminal in check.Terminals.AsNoTracking() on stand.TerminalId equals (long?)terminal.Id
                                where stand.StationId == puj && stand.IsActive && terminal.IsActive
                                select new { stand.Id, stand.PublicId, stand.Code }).ToArrayAsync(ct);
            Assert.Equal(usable.Select(item => item.Id).Order(), evaluated.Keys.Order());
            foreach (var item in usable)
                Assert.Equal((await StandAvailability.CheckAsync(check, puj, item.PublicId, start, end,
                    AircraftSizeCategory.Widebody, null, ct)).Reasons, evaluated[item.Id]);
            string Reasons(string code) => string.Join('|', evaluated[usable.Single(item => item.Code == code).Id]);
            Assert.Equal(("stand_taken", "stand_cancelled", "stand_narrowbody_only", ""),
                (Reasons("A02"), Reasons("A03"), Reasons("BN6"), Reasons("A01")));
        }

        // The agent's coverage of A01 goes on until 23:00, but their shift ends at 21:00: parking at 20:48 they may take
        // the flight, at 21:10 they may not.
        await CoverStandsAsync(database.ConnectionString, demo.Agent, ["A01"], LocalAt(demo.Day, 20), LocalAt(demo.Day, 23), ct);
        Assert.Equal(("A01", true, "Riley Ramp", 1, true, ""), DemoStandRow(await demo.Stand("A01", Visit(8))));
        Assert.Equal(("A01", true, "Riley Ramp", 0, false, "shift_not_compatible"),
            DemoStandRow(await demo.Stand("A01", Visit(30))));
    }
}
