using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Abstractions.Integrations;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations;
using Elevant.Application.Operations.AirPicture;
using Elevant.Application.Operations.MapFlights;
using Elevant.Domain.Entities.Integration;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>
/// ADR-0042 (contracts 1.3): the ELEVANT flights of the map, against SQL Server. One row per leg of the station's
/// turnarounds and per open proposal of the feed; a flight keeps its key when OCC imports it, and an open departure joins
/// the visit the review of its day suggests; the phase follows the provider's words and the actual times; an aircraft on
/// the ground stays on the map across midnight until it pushes back; and the live aircraft are matched against the same
/// keys. Every answer of the feed here is synthetic, and every test runs on the demo flights' clock, two days ahead of the
/// seed's flights.
/// </summary>
public sealed partial class SqlServerMigrationTests
{
    /// <summary>The feed's synthetic origin: its row keeps the reference point the answer brings.</summary>
    private static readonly FeedAirport MapOrigin =
        new("XQA", "XQAA", "Synthetic Origin", "Origin City", "DO", "America/Santo_Domingo", 18.5m, -69.5m);

    /// <summary>A leg of the paid feed's answer, of Demo Airlines unless said otherwise.</summary>
    private static FeedFlight MapLeg(FlightDirection direction, string number, DateTimeOffset scheduledAt, string? registration,
        string status = "Expected", string model = "Airbus A320", DateTimeOffset? revisedAt = null,
        DateTimeOffset? runwayAt = null, FeedAirport? counterpart = null, string airline = "Demo Airlines", string iata = "ZZ") =>
        new(direction, number, new FeedAirline(airline, iata, null), counterpart ?? MapOrigin, scheduledAt, revisedAt, runwayAt,
            status, registration, model, "A", "3", false, "IsOperator");

    /// <summary>The paid feed answers <paramref name="flights"/> at the clock's time.</summary>
    private static Task<FlightFeedIngestResult> MapFeedAsync(DemoFlights demo, CancellationToken ct,
        params FeedFlight[] flights) =>
        demo.Run(async services =>
        {
            var sync = services.GetRequiredService<IFlightFeedSyncStore>();
            var station = Assert.Single(await sync.ListStationsAsync(demo.Now, ct),
                item => item.StationPublicId == SeededPujStation);
            return await sync.RecordAsync(new FlightFeedCall("AeroDataBox", station, demo.Day.ToDateTime(new TimeOnly(0, 0)),
                    demo.Day.ToDateTime(new TimeOnly(23, 59)), ProviderCallTrigger.Manual, null, demo.Now),
                new AirportFeedResponse(ProviderCallOutcome.Succeeded, 2, 200, null, flights), ct);
        });

    /// <summary>The map's flights of PUJ at the clock's time; by default two hours back and twelve ahead, as the API asks.</summary>
    private static async Task<OccMapFlightsData> MapAsync(DemoFlights demo, CancellationToken ct, double hoursBack = 2,
        double hoursAhead = 12)
    {
        var now = demo.Now;
        var read = await demo.Run(services => services.GetRequiredService<IOccMapFlightStore>()
            .ListAsync(SeededPujStation, now.AddHours(-hoursBack), now.AddHours(hoursAhead), now, ct));
        Assert.NotNull(read);
        return read;
    }

    private static OccMapFlightData MapFlight(OccMapFlightsData read, string flightNumber) =>
        Assert.Single(read.Flights, item => item.FlightNumber == flightNumber);

    /// <summary>The whole row: its milestones in order, and every other field.</summary>
    private static void AssertMapFlight(OccMapFlightData expected, OccMapFlightData actual)
    {
        Assert.Equal(expected.Milestones, actual.Milestones);
        Assert.Equal(expected with { Milestones = actual.Milestones }, actual);
    }

    /// <summary>The public ids of the proposals of <paramref name="numbers"/>, by number.</summary>
    private static async Task<Dictionary<string, Guid>> MapProposalIdsAsync(string connection, CancellationToken ct,
        params string[] numbers)
    {
        await using var context = CreateContext(connection);
        return await context.Set<ExternalFlightProposal>().AsNoTracking().Where(item => numbers.Contains(item.FlightNumber))
            .ToDictionaryAsync(item => item.FlightNumber, item => item.PublicId, ct);
    }

    /// <summary>The public ids of the legs of the turnarounds, by number.</summary>
    private static async Task<Dictionary<string, Guid>> MapLegIdsAsync(string connection, CancellationToken ct,
        params Guid[] turnarounds)
    {
        await using var context = CreateContext(connection);
        return await (from leg in context.FlightLegs.AsNoTracking()
                      join turnaround in context.Turnarounds.AsNoTracking() on leg.TurnaroundId equals turnaround.Id
                      where turnarounds.Contains(turnaround.PublicId)
                      select new { leg.FlightNumber, leg.PublicId }).ToDictionaryAsync(item => item.FlightNumber,
            item => item.PublicId, ct);
    }

    /// <summary>The operation of a turnaround: its public id and its key.</summary>
    private static async Task<(Guid PublicId, long Id)> MapOperationAsync(string connection, Guid turnaroundId,
        CancellationToken ct)
    {
        await using var context = CreateContext(connection);
        var operation = await (from item in context.GroundOperations.AsNoTracking()
                               join turnaround in context.Turnarounds.AsNoTracking() on item.TurnaroundId equals turnaround.Id
                               where turnaround.PublicId == turnaroundId
                               select new { item.PublicId, item.Id }).SingleAsync(ct);
        return (operation.PublicId, operation.Id);
    }

    /// <summary>«Cancelar vuelo» or «Marcar desviado» by OCC, with the version it reads.</summary>
    private static async Task ChangeMapTurnaroundAsync(DemoFlights demo, Guid turnaroundId, string outcome, CancellationToken ct)
    {
        var read = await demo.Run(services => services.GetRequiredService<IOccTurnaroundStore>()
            .ReadAsync(SeededOccAccount, turnaroundId, ct));
        Assert.True(read.Failure is null, read.Code);
        var changed = await demo.Run(services => services.GetRequiredService<IOccTurnaroundStore>().ChangeStatusAsync(
            SeededOccAccount, turnaroundId, new TurnaroundStatusChangeInput(outcome, "Vuelo creado por error", read.Value!.Version),
            Guid.NewGuid(), ct));
        Assert.True(changed.Failure is null, changed.Code);
    }

    /// <summary>
    /// The map merges the feed's open proposals, the legs OCC imported (with their stand and the milestones the operation
    /// recorded), the flights OCC typed and a demo flight before and after its import, each airport with the reference
    /// point its row has or, without one, the demo catalogue's. A cancelled or diverted flight, a flight outside the
    /// window and the proposals of an airline whose contract is suspended are left out.
    /// </summary>
    [Fact]
    public async Task MapFlightsMergeProposalsLegsStandsMilestonesAndTheDemoClock()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var demo = await DemoFlightsAsync(database, ct);
        await using (var setup = CreateContext(database.ConnectionString))
            await CharterAirlineAsync(setup, "C9", "CQZ", "Charter Air", ct);
        var now = demo.Now;

        // The feed reports a pair to review, a pair that already landed, a charter pair, two lone legs whose airports have
        // no row (one the catalogue knows) and an arrival after the window.
        await MapFeedAsync(demo, ct,
            MapLeg(FlightDirection.Arrival, "ZZ161", now.AddMinutes(60), "HI1001"),
            MapLeg(FlightDirection.Departure, "ZZ162", now.AddMinutes(150), "HI1001"),
            MapLeg(FlightDirection.Arrival, "ZZ171", now.AddMinutes(-60), "HI1002", "Arrived", runwayAt: now.AddMinutes(-63)),
            MapLeg(FlightDirection.Departure, "ZZ172", now.AddMinutes(30), "HI1002"),
            MapLeg(FlightDirection.Arrival, "C9100", now.AddMinutes(240), "HI2001", model: "Boeing 737-800",
                airline: "Charter Air", iata: "C9"),
            MapLeg(FlightDirection.Departure, "C9101", now.AddMinutes(330), "HI2001", model: "Boeing 737-800",
                airline: "Charter Air", iata: "C9"),
            MapLeg(FlightDirection.Arrival, "ZZ181", now.AddMinutes(300), "HI1081",
                counterpart: new FeedAirport("MAD", null, "Madrid", "Madrid", "ES", null, null, null)),
            MapLeg(FlightDirection.Departure, "ZZ199", now.AddMinutes(420), "HI1099",
                counterpart: new FeedAirport("XQB", null, "Synthetic B", null, null, null, null, null)),
            MapLeg(FlightDirection.Arrival, "ZZ191", now.AddHours(13), "HI1091"));

        // OCC imports the pair that landed onto A02 with its type. Its operation has BLOCK_ON, the walk-around and PUSHBACK
        // recorded, a milestone without a time and a code the flight report does not have (written with the context: the
        // tablet's commands have their own tests).
        var (zz171Proposal, zz172Proposal) = Proposal(await demo.Feed(), "ZZ171");
        var imported = await demo.Import(new DemoPair(zz171Proposal, zz172Proposal), demo.Stands["A02"]);
        Assert.True(imported.Failure is null, imported.Code);
        var importedOperation = await MapOperationAsync(database.ConnectionString, imported.TurnaroundId!.Value, ct);
        await using (var setup = CreateContext(database.ConnectionString))
        {
            void Milestone(string code, DateTimeOffset? at) => setup.Add(new OperationMilestone
            {
                PublicId = Guid.CreateVersion7(), GroundOperationId = importedOperation.Id, Code = code, ActualAt = at,
                Status = at is null ? MilestoneStatus.Pending : MilestoneStatus.Actual, Source = OperationalDataSource.Manual,
                CreatedAt = now, UpdatedAt = now,
            });
            Milestone(RampEvidenceTimePolicy.Pushback, now.AddMinutes(-5));
            Milestone(RampEvidenceTimePolicy.BlockOn, now.AddMinutes(-57));
            Milestone("WALKAROUND_START", now.AddMinutes(-55));
            Milestone("LOAD_SHEET", null);
            Milestone("LEGACY_STEP", now.AddMinutes(-50));
            await setup.SaveChangesAsync(ct);
        }

        // OCC types a flight by hand, and two more it cancels and diverts.
        var manual = await PlanManualFlightAsync(demo.Provider, demo.Airline, demo.Stands["B01"], demo.Day, "ZZ911",
            now.AddMinutes(35), now.AddMinutes(125), ct);
        Assert.True(manual.IsSuccess, manual.Code);
        var cancelled = await PlanManualFlightAsync(demo.Provider, demo.Airline, demo.Stands["B02"], demo.Day, "ZZ921",
            now.AddMinutes(45), now.AddMinutes(150), ct);
        var diverted = await PlanManualFlightAsync(demo.Provider, demo.Airline, demo.Stands["A01"], demo.Day, "ZZ931",
            now.AddMinutes(50), now.AddMinutes(160), ct);
        await ChangeMapTurnaroundAsync(demo, cancelled.TurnaroundId!.Value, "Cancelled", ct);
        await ChangeMapTurnaroundAsync(demo, diverted.TurnaroundId!.Value, "Diverted", ct);
        var manualOperation = await MapOperationAsync(database.ConnectionString, manual.TurnaroundId!.Value, ct);

        // The superadministrator triggers a demo flight from New York onto A03.
        var flight = await demo.Triggered(minutes: 8, stand: demo.Stands["A03"], origin: "JFK");
        var ids = await MapProposalIdsAsync(database.ConnectionString, ct, "ZZ161", "ZZ162", "ZZ171", "ZZ172", "C9100", "C9101",
            "ZZ181", "ZZ199", flight.DepartureFlightNumber);
        var legs = await MapLegIdsAsync(database.ConnectionString, ct, imported.TurnaroundId.Value, manual.TurnaroundId.Value);
        string Key(string number) => MapFlightKeys.Proposal(ids[number]);

        var map = await MapAsync(demo, ct);
        Assert.Equal((SeededPujStation, "PUJ", now, now.AddHours(-2), now.AddHours(12)),
            (map.StationId, map.StationCode, map.ServerTime, map.WindowFrom, map.WindowTo));
        // Punta Cana's row has no reference point and the catalogue does not know it: nobody does.
        Assert.Equal(new OccMapAirportData("PUJ", "MDPC", "Punta Cana Development Airport", null, null), map.StationAirport);
        // By best time and then number; the cancelled and diverted flights and the arrival after the window are not there.
        Assert.Equal(["ZZ171", flight.ArrivalFlightNumber, "ZZ172", "ZZ911", "ZZ161", flight.DepartureFlightNumber, "ZZ911D",
            "ZZ162", "C9100", "ZZ181", "C9101", "ZZ199"], map.Flights.Select(item => item.FlightNumber));

        var airline = new OccMapAirlineData(demo.Airline, "Demo Airlines", "ZZ", "DZZ");
        var origin = new OccMapAirportData("XQA", "XQAA", "Synthetic Origin", 18.5m, -69.5m);
        // A proposal of the feed: its own key, its visit is its arrival's, the type its model suggests, its row's airport.
        AssertMapFlight(new OccMapFlightData(Key("ZZ161"), Key("ZZ161"), ids["ZZ161"], null, null, "Arrival", "ZZ161", "DZZ161",
            airline, origin, now.AddMinutes(60), null, null, null, MapFlightPhases.Scheduled, "Expected",
            new OccMapAircraftData("HI1001", "A320", "Airbus A320", "Narrowbody"), false, null, null, null, [], false, null),
            MapFlight(map, "ZZ161"));
        Assert.Equal((Key("ZZ162"), Key("ZZ161"), MapFlightPhases.Scheduled),
            (MapFlight(map, "ZZ162").FlightKey, MapFlight(map, "ZZ162").VisitKey, MapFlight(map, "ZZ162").Phase));
        // A charter candidate's pair is shown too; the provider's model matches no type. «C9100» is C9's flight 100.
        var c9100 = MapFlight(map, "C9100");
        Assert.Equal((Key("C9100"), Key("C9100"), "Charter Air", "C9", "CQZ", "CQZ100"),
            (c9100.FlightKey, c9100.VisitKey, c9100.Airline.Name, c9100.Airline.IataCode, c9100.Airline.IcaoCode, c9100.Callsign));
        Assert.Equal(new OccMapAircraftData("HI2001", null, "Boeing 737-800", null), c9100.Aircraft);
        Assert.Equal(Key("C9100"), MapFlight(map, "C9101").VisitKey);
        // Airports without a row: the catalogue completes the one it knows; the other has no reference point. A lone
        // departure is its own visit.
        Assert.Equal(new OccMapAirportData("MAD", "LEMD", "Madrid", 40.4983m, -3.5676m), MapFlight(map, "ZZ181").Counterpart);
        Assert.Equal((Key("ZZ199"), new OccMapAirportData("XQB", null, "Synthetic B", null, null)),
            (MapFlight(map, "ZZ199").VisitKey, MapFlight(map, "ZZ199").Counterpart));

        // The imported pair keeps its proposals' keys and carries its turnaround, its stand (still held after the
        // push-back) and the recorded milestones of the flight report in its order.
        var turnaround = new OccMapTurnaroundData(imported.TurnaroundId.Value, imported.OperationCode!, "Confirmed",
            importedOperation.PublicId, "Planned");
        var a02 = new OccMapStandData(demo.Stands["A02"], "A02", "A");
        OccMapMilestoneData[] recorded =
        [
            new(RampEvidenceTimePolicy.BlockOn, now.AddMinutes(-57)), new("WALKAROUND_START", now.AddMinutes(-55)),
            new(RampEvidenceTimePolicy.Pushback, now.AddMinutes(-5)),
        ];
        var registered = new OccMapAircraftData("HI1002", "A320", "Airbus A320 Development", "Narrowbody");
        AssertMapFlight(new OccMapFlightData(Key("ZZ171"), Key("ZZ171"), ids["ZZ171"], legs["ZZ171"], imported.TurnaroundId,
            "Arrival", "ZZ171", "DZZ171", airline, origin, now.AddMinutes(-60), null, now.AddMinutes(-63),
            MapFlightActualKinds.Runway, MapFlightPhases.Landed, "Arrived", registered, true, turnaround, a02, null, recorded, false,
            null), MapFlight(map, "ZZ171"));
        AssertMapFlight(new OccMapFlightData(Key("ZZ172"), Key("ZZ171"), ids["ZZ172"], legs["ZZ172"], imported.TurnaroundId,
            "Departure", "ZZ172", "DZZ172", airline, origin, now.AddMinutes(30), null, null, null, MapFlightPhases.Scheduled,
            "Expected", registered, true, turnaround, a02, null, recorded, false, null), MapFlight(map, "ZZ172"));

        // A flight OCC typed: leg and turnaround keys, no provider word, and Miami's reference point from the catalogue
        // because its row has none.
        var miami = new OccMapAirportData("MIA", "KMIA", "Miami Development Airport", 25.7959m, -80.2870m);
        var typed = new OccMapTurnaroundData(manual.TurnaroundId.Value, manual.OperationCode!, "Confirmed",
            manualOperation.PublicId, "Planned");
        var b01 = new OccMapStandData(demo.Stands["B01"], "B01", "B");
        AssertMapFlight(new OccMapFlightData(MapFlightKeys.Leg(legs["ZZ911"]), MapFlightKeys.Turnaround(manual.TurnaroundId.Value),
            null, legs["ZZ911"], manual.TurnaroundId, "Arrival", "ZZ911", "DZZ911", airline, miami, now.AddMinutes(35), null,
            null, null, MapFlightPhases.Scheduled, null, null, true, typed, b01, null, [], false, null), MapFlight(map, "ZZ911"));
        AssertMapFlight(new OccMapFlightData(MapFlightKeys.Leg(legs["ZZ911D"]), MapFlightKeys.Turnaround(manual.TurnaroundId.Value),
            null, legs["ZZ911D"], manual.TurnaroundId, "Departure", "ZZ911D", "DZZ911D", airline, miami, now.AddMinutes(125),
            null, null, null, MapFlightPhases.Scheduled, null, null, true, typed, b01, null, [], false, null),
            MapFlight(map, "ZZ911D"));

        // The demo flight before its import: the arrival's key is its demo id, the stand it was triggered for, the clock
        // resolved now and New York's row, which the trigger completed from the catalogue.
        var jfk = new OccMapAirportData("JFK", "KJFK", "John F. Kennedy International Airport", 40.6413m, -73.7781m);
        var demoAircraft = new OccMapAircraftData("HIDM01", "A320", "Airbus A320 Development", "Narrowbody");
        var clock = new OccMapDemoData(flight.Id, "Active", "Approach", flight.AppearAt, flight.TouchdownAt, flight.OnBlockAt,
            flight.ScheduledOffBlockAt, flight.OffBlockAt, flight.TakeoffAt, flight.VanishAt);
        var demoVisit = MapFlightKeys.Proposal(flight.Id);
        var demoCallsign = "DZZ" + flight.ArrivalFlightNumber[2..];
        AssertMapFlight(new OccMapFlightData(demoVisit, demoVisit, flight.Id, null, null, "Arrival", flight.ArrivalFlightNumber,
            demoCallsign, airline, jfk, flight.OnBlockAt, flight.OnBlockAt, null, null, MapFlightPhases.Approaching,
            "Approaching", demoAircraft, false, null, null, "A03", [], true, clock), MapFlight(map, flight.ArrivalFlightNumber));
        AssertMapFlight(new OccMapFlightData(Key(flight.DepartureFlightNumber), demoVisit, ids[flight.DepartureFlightNumber],
            null, null, "Departure", flight.DepartureFlightNumber, "DZZ" + flight.DepartureFlightNumber[2..], airline, jfk,
            flight.ScheduledOffBlockAt, null, null, null, MapFlightPhases.Scheduled, "Expected", demoAircraft, false, null, null,
            "A03", [], true, clock), MapFlight(map, flight.DepartureFlightNumber));

        // The wheels touch the runway. The worker writes nothing on a pair nobody imported: the map reads the landing from
        // the clock.
        demo.Clock.Now = flight.TouchdownAt.AddSeconds(30);
        Assert.Equal(0, await demo.Tick());
        var landed = MapFlight(await MapAsync(demo, ct), flight.ArrivalFlightNumber);
        Assert.Equal(((DateTimeOffset?)flight.TouchdownAt, MapFlightActualKinds.Runway, MapFlightPhases.Landed, "Arrived",
            "TaxiIn"), (landed.ActualAt, landed.ActualKind, landed.Phase, landed.ProviderStatus, landed.Demo!.Phase));

        // OCC imports it onto the stand it was triggered for: the same keys, now legs with their turnaround and stand. The
        // imported aircraft waits for its agent, and its leg has no runway time until the worker's next tick.
        var demoTurnaround = await demo.Imported(flight, demo.Stands["A03"]);
        var demoRows = await demo.Turnaround(demoTurnaround);
        var importedDemo = await MapAsync(demo, ct);
        var waiting = clock with { Phase = "TaxiIn", OffBlockAt = null, TakeoffAt = null, VanishAt = null };
        var demoStand = new OccMapStandData(demo.Stands["A03"], "A03", "A");
        var demoTurnaroundData = new OccMapTurnaroundData(demoTurnaround, demoRows.Turnaround.OperationCode, "Confirmed",
            demoRows.Operation.PublicId, "Planned");
        AssertMapFlight(new OccMapFlightData(demoVisit, demoVisit, flight.Id, demoRows.Arrival.PublicId, demoTurnaround,
            "Arrival", flight.ArrivalFlightNumber, demoCallsign, airline, jfk, flight.OnBlockAt, flight.OnBlockAt, null, null,
            MapFlightPhases.Approaching, "Approaching", demoAircraft, true, demoTurnaroundData, demoStand, null, [], true,
            waiting), MapFlight(importedDemo, flight.ArrivalFlightNumber));
        Assert.Equal((Key(flight.DepartureFlightNumber), demoVisit, true, demoStand, (string?)null, waiting),
            (MapFlight(importedDemo, flight.DepartureFlightNumber).FlightKey,
                MapFlight(importedDemo, flight.DepartureFlightNumber).VisitKey,
                MapFlight(importedDemo, flight.DepartureFlightNumber).Imported,
                MapFlight(importedDemo, flight.DepartureFlightNumber).Stand,
                MapFlight(importedDemo, flight.DepartureFlightNumber).SuggestedStandCode,
                MapFlight(importedDemo, flight.DepartureFlightNumber).Demo));
        demo.Clock.Now += TimeSpan.FromSeconds(5);
        Assert.Equal(1, await demo.Tick());
        var stamped = MapFlight(await MapAsync(demo, ct), flight.ArrivalFlightNumber);
        Assert.Equal(((DateTimeOffset?)flight.TouchdownAt, MapFlightActualKinds.Runway, MapFlightPhases.Landed, "Arrived",
            demoVisit), (stamped.ActualAt, stamped.ActualKind, stamped.Phase, stamped.ProviderStatus, stamped.FlightKey));

        // The seeded contract is suspended at the station: its open proposals leave the map, the flights OCC already has
        // stay, and the charter candidate's are still shown (2-N16).
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var contractId = await SeededContractIdAsync(setup, ct);
            await setup.Contracts.Where(item => item.Id == contractId)
                .ExecuteUpdateAsync(set => set.SetProperty(item => item.Status, ContractStatus.Suspended), ct);
        }
        Assert.Equal(["ZZ171", flight.ArrivalFlightNumber, "ZZ172", "ZZ911", flight.DepartureFlightNumber, "ZZ911D", "C9100",
            "C9101"], (await MapAsync(demo, ct)).Flights.Select(item => item.FlightNumber));

        // An unknown or inactive station has no map.
        Assert.Null(await demo.Run(services => services.GetRequiredService<IOccMapFlightStore>()
            .ListAsync(Guid.NewGuid(), demo.Now.AddHours(-2), demo.Now.AddHours(12), demo.Now, ct)));
        await using (var setup = CreateContext(database.ConnectionString))
            await setup.Stations.Where(item => item.PublicId == SeededPujStation)
                .ExecuteUpdateAsync(set => set.SetProperty(item => item.IsActive, false), ct);
        Assert.Null(await demo.Run(services => services.GetRequiredService<IOccMapFlightStore>()
            .ListAsync(SeededPujStation, demo.Now.AddHours(-2), demo.Now.AddHours(12), demo.Now, ct)));
    }

    /// <summary>
    /// «Importar escala» does not change a flight's keys: the proposal's key becomes its leg's, the visit is still the
    /// arrival's, and neither changes when the provider revises the times or OCC records the arrival on its stand.
    /// </summary>
    [Fact]
    public async Task AProposalKeepsItsFlightKeyAndVisitKeyAcrossTheImport()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var demo = await DemoFlightsAsync(database, ct);
        var now = demo.Now;
        await MapFeedAsync(demo, ct,
            MapLeg(FlightDirection.Arrival, "ZZ161", now.AddMinutes(60), "HI1001"),
            MapLeg(FlightDirection.Departure, "ZZ162", now.AddMinutes(150), "HI1001"),
            MapLeg(FlightDirection.Departure, "ZZ170", now.AddMinutes(400), "HI1070"));
        var ids = await MapProposalIdsAsync(database.ConnectionString, ct, "ZZ161", "ZZ162", "ZZ170");
        string Key(string number) => MapFlightKeys.Proposal(ids[number]);
        (string, string)[] keys = [(Key("ZZ161"), Key("ZZ161")), (Key("ZZ162"), Key("ZZ161")), (Key("ZZ170"), Key("ZZ170"))];

        var before = await MapAsync(demo, ct);
        Assert.Equal(keys, before.Flights.Select(item => (item.FlightKey, item.VisitKey)));
        Assert.All(before.Flights, item => Assert.Equal((false, (Guid?)null, (Guid?)null), (item.Imported, item.LegId, item.TurnaroundId)));

        var (arrival, departure) = Proposal(await demo.Feed(), "ZZ161");
        var imported = await demo.Import(new DemoPair(arrival, departure), demo.Stands["A01"]);
        Assert.True(imported.Failure is null, imported.Code);
        var after = await MapAsync(demo, ct);
        Assert.Equal(keys, after.Flights.Select(item => (item.FlightKey, item.VisitKey)));
        (Guid, bool, Guid?, string?)[] rows =
        [
            (ids["ZZ161"], true, imported.TurnaroundId, "A01"), (ids["ZZ162"], true, imported.TurnaroundId, "A01"),
            (ids["ZZ170"], false, null, null),
        ];
        Assert.Equal(rows, after.Flights.Select(item => (item.ProposalId!.Value, item.Imported, item.TurnaroundId,
            item.Stand?.Code)));

        // The provider revises the arrival and reports it approaching: the leg takes the estimate, the keys stay.
        demo.Clock.Now = now.AddMinutes(1);
        await MapFeedAsync(demo, ct,
            MapLeg(FlightDirection.Arrival, "ZZ161", now.AddMinutes(60), "HI1001", "Approaching", revisedAt: now.AddMinutes(70)),
            MapLeg(FlightDirection.Departure, "ZZ162", now.AddMinutes(150), "HI1001"));
        var revised = MapFlight(await MapAsync(demo, ct), "ZZ161");
        Assert.Equal((Key("ZZ161"), Key("ZZ161"), (DateTimeOffset?)now.AddMinutes(70), MapFlightPhases.Approaching,
            "Approaching"), (revised.FlightKey, revised.VisitKey, revised.EstimatedAt, revised.Phase, revised.ProviderStatus));

        // OCC records the arrival on its stand: an on-block time, the leg is OCC's from now on, and the key is the same.
        demo.Clock.Now = now.AddMinutes(72);
        var recorded = await demo.Run(services => services.GetRequiredService<IOccPositionStore>().RecordArrivalAsync(
            SeededOccAccount, imported.TurnaroundId!.Value, new RecordArrivalInput("HI1001", null), OccPositionCommand.None, ct));
        Assert.Null(recorded.Failure);
        var arrived = await MapAsync(demo, ct);
        var leg = MapFlight(arrived, "ZZ161");
        Assert.Equal((Key("ZZ161"), Key("ZZ161"), (DateTimeOffset?)now.AddMinutes(72), MapFlightActualKinds.OnBlock,
            MapFlightPhases.Arrived, "InProgress"),
            (leg.FlightKey, leg.VisitKey, leg.ActualAt, leg.ActualKind, leg.Phase, leg.Turnaround!.Status));
        Assert.Equal(keys, arrived.Flights.Select(item => (item.FlightKey, item.VisitKey)));
    }

    /// <summary>
    /// An open departure joins the visit of the arrival OCC's review suggests for it, and the review pairs the proposals of
    /// one day: a late arrival never takes the next day's departure from that day's arrivals, and two arrivals at the same
    /// time compete in the review's order, by number. The pair OCC imports keeps the keys the map showed.
    /// </summary>
    [Fact]
    public async Task AnOpenDepartureJoinsTheVisitTheReviewOfItsDaySuggests()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var demo = await DemoFlightsAsync(database, ct, start: day => LocalAt(day, 22));
        var day = demo.Day;
        var nextDay = day.AddDays(1);

        // Nobody reports a registration, so the departure at one in the morning is a turn of any of the three arrivals: the
        // day's last one at eleven, and the next day's two at half past midnight, the higher number reported first.
        await MapFeedAsync(demo, ct,
            MapLeg(FlightDirection.Arrival, "ZZ601", LocalAt(day, 23), null),
            MapLeg(FlightDirection.Arrival, "ZZ631", LocalAt(nextDay, 0, 30), null),
            MapLeg(FlightDirection.Arrival, "ZZ621", LocalAt(nextDay, 0, 30), null),
            MapLeg(FlightDirection.Departure, "ZZ622", LocalAt(nextDay, 1), null));
        var ids = await MapProposalIdsAsync(database.ConnectionString, ct, "ZZ601", "ZZ621", "ZZ631", "ZZ622");
        string Key(string number) => MapFlightKeys.Proposal(ids[number]);

        // OCC's review of each day: the next day's suggests the departure for its first arrival by number, and the late
        // arrival of the day before has none.
        async Task<IReadOnlyList<OccFlightProposalData>> Review(DateOnly date) =>
            (await demo.Run(services => services.GetRequiredService<IOccFlightFeedStore>()
                .ListAsync(SeededOccAccount, SeededPujStation, date, OccFlightFeedView.Contracted, ct)))!.Proposals;
        Assert.Null(Assert.Single(await Review(day), item => item.FlightNumber == "ZZ601").SuggestedDepartureId);
        var (arrival, departure) = Proposal(await Review(nextDay), "ZZ621");
        Assert.Equal((ids["ZZ621"], ids["ZZ622"]), (arrival.ProposalId, departure.ProposalId));
        Assert.Null(Assert.Single(await Review(nextDay), item => item.FlightNumber == "ZZ631").SuggestedDepartureId);

        // The map joins the departure to the visit the review suggests.
        (string, string)[] keys =
            [(Key("ZZ601"), Key("ZZ601")), (Key("ZZ621"), Key("ZZ621")), (Key("ZZ631"), Key("ZZ631")), (Key("ZZ622"), Key("ZZ621"))];
        Assert.Equal(keys, (await MapAsync(demo, ct)).Flights.Select(item => (item.FlightKey, item.VisitKey)));

        // OCC imports that pair: neither key changes.
        var imported = await demo.Import(new DemoPair(arrival, departure), demo.Stands["A01"]);
        Assert.True(imported.Failure is null, imported.Code);
        var after = await MapAsync(demo, ct);
        Assert.Equal(keys, after.Flights.Select(item => (item.FlightKey, item.VisitKey)));
        Assert.Equal([false, true, false, true], after.Flights.Select(item => item.Imported));
    }

    /// <summary>
    /// 3-N07: the feed's pair of a flight OCC planned by hand joins that turnaround. Its legs keep their own keys and name
    /// the proposal that joined them last, so a screen that followed the proposal finds the leg through it; the provider's
    /// words reach the leg, never its times.
    /// </summary>
    [Fact]
    public async Task AFeedPairJoiningAPlannedFlightKeepsTheLegKeyAndNamesTheProposal()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var demo = await DemoFlightsAsync(database, ct);
        var now = demo.Now;
        var planned = await demo.Run(services => services.GetRequiredService<IManualTurnaroundStore>().CreateAsync(
            new ManualTurnaroundWriteRequest(SeededOccAccount, [SeededPujStation], Guid.CreateVersion7(), SeededPujStation,
                demo.Airline, demo.Stands["A02"], demo.Day, "ZZ1234", "MIA", now.AddHours(1), "ZZ1235", "MIA", now.AddHours(3),
                Guid.NewGuid(), "map-flights-link"), ct));
        Assert.True(planned.IsSuccess, planned.Code);
        var turnaroundId = planned.TurnaroundId!.Value;
        var legs = await MapLegIdsAsync(database.ConnectionString, ct, turnaroundId);
        var visit = MapFlightKeys.Turnaround(turnaroundId);
        (string, string)[] legKeys = [(MapFlightKeys.Leg(legs["ZZ1234"]), visit), (MapFlightKeys.Leg(legs["ZZ1235"]), visit)];
        Assert.Equal(legKeys, (await MapAsync(demo, ct)).Flights.Select(item => (item.FlightKey, item.VisitKey)));

        // The provider writes «ZZ 1234»: until OCC decides, its proposals are rows of their own.
        await MapFeedAsync(demo, ct,
            MapLeg(FlightDirection.Arrival, "ZZ 1234", now.AddHours(1), "HI2042"),
            MapLeg(FlightDirection.Departure, "ZZ 1235", now.AddHours(3), "HI2042"));
        var first = await MapProposalIdsAsync(database.ConnectionString, ct, "ZZ 1234", "ZZ 1235");
        var proposed = await MapAsync(demo, ct);
        // Same times: by number, and the provider writes a space.
        Assert.Equal(["ZZ 1234", "ZZ1234", "ZZ 1235", "ZZ1235"], proposed.Flights.Select(item => item.FlightNumber));
        Assert.Equal((MapFlightKeys.Proposal(first["ZZ 1234"]), MapFlightKeys.Proposal(first["ZZ 1234"]), "DZZ1234"),
            (MapFlight(proposed, "ZZ 1234").FlightKey, MapFlight(proposed, "ZZ 1234").VisitKey,
                MapFlight(proposed, "ZZ 1234").Callsign));

        // OCC imports the pair: it joins the planned flight. The proposals leave, the legs keep their keys and name them.
        var (arrival, departure) = Proposal(await demo.Feed(), "ZZ 1234");
        var linked = await demo.Import(new DemoPair(arrival, departure));
        Assert.Equal((turnaroundId, true), (linked.TurnaroundId!.Value, linked.Linked));
        var joined = await MapAsync(demo, ct);
        Assert.Equal(legKeys, joined.Flights.Select(item => (item.FlightKey, item.VisitKey)));
        Assert.Equal([(first["ZZ 1234"], "Expected"), (first["ZZ 1235"], "Expected")],
            joined.Flights.Select(item => (item.ProposalId!.Value, item.ProviderStatus!)));
        // A screen that followed the proposal's key finds its leg through the proposal.
        Assert.Equal("ZZ1234", Assert.Single(joined.Flights, item =>
            MapFlightKeys.Proposal(item.ProposalId!.Value) == MapFlight(proposed, "ZZ 1234").FlightKey).FlightNumber);

        // The provider reports the arrival approaching and then on the ground: the leg shows its word, and the runway time
        // never reaches a leg OCC planned.
        demo.Clock.Now = now.AddMinutes(1);
        await MapFeedAsync(demo, ct,
            MapLeg(FlightDirection.Arrival, "ZZ 1234", now.AddHours(1), "HI2042", "Approaching"),
            MapLeg(FlightDirection.Departure, "ZZ 1235", now.AddHours(3), "HI2042"));
        Assert.Equal((MapFlightPhases.Approaching, "Approaching"),
            (MapFlight(await MapAsync(demo, ct), "ZZ1234").Phase, MapFlight(await MapAsync(demo, ct), "ZZ1234").ProviderStatus));
        demo.Clock.Now = now.AddMinutes(2);
        await MapFeedAsync(demo, ct,
            MapLeg(FlightDirection.Arrival, "ZZ 1234", now.AddHours(1), "HI2042", "Arrived", runwayAt: now.AddMinutes(2)),
            MapLeg(FlightDirection.Departure, "ZZ 1235", now.AddHours(3), "HI2042"));
        var reported = MapFlight(await MapAsync(demo, ct), "ZZ1234");
        Assert.Equal(((DateTimeOffset?)null, (string?)null, MapFlightPhases.Arrived, "Arrived"),
            (reported.ActualAt, reported.ActualKind, reported.Phase, reported.ProviderStatus));

        // The provider moves the flight: a new reference, a new pair. Joined again, the legs name the latest proposals.
        demo.Clock.Now = now.AddMinutes(3);
        await MapFeedAsync(demo, ct,
            MapLeg(FlightDirection.Arrival, "ZZ 1234", now.AddHours(1).AddMinutes(10), "HI2042", "Delayed"),
            MapLeg(FlightDirection.Departure, "ZZ 1235", now.AddHours(3).AddMinutes(10), "HI2042"));
        var review = await demo.Feed();
        var movedArrival = review.Single(item => item.FlightNumber == "ZZ 1234" && item.Status == "Proposed");
        var movedDeparture = review.Single(item => item.ProposalId == movedArrival.SuggestedDepartureId);
        Assert.NotEqual(first["ZZ 1234"], movedArrival.ProposalId);
        Assert.True((await demo.Import(new DemoPair(movedArrival, movedDeparture))).Linked);
        var relinked = await MapAsync(demo, ct);
        Assert.Equal(legKeys, relinked.Flights.Select(item => (item.FlightKey, item.VisitKey)));
        Assert.Equal([(movedArrival.ProposalId, "Delayed"), (movedDeparture.ProposalId, "Expected")],
            relinked.Flights.Select(item => (item.ProposalId!.Value, item.ProviderStatus!)));
    }

    /// <summary>
    /// The phase of every word the provider reports, in any case, and of the actual times: a runway time is a landing or a
    /// take-off whatever the word says; an arrival the provider still expects is en route once its time has come; a
    /// diversion the provider reports on an imported flight shows on its leg while OCC decides.
    /// </summary>
    [Fact]
    public async Task ThePhaseFollowsEveryProviderTextAndTheRunwayTime()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var demo = await DemoFlightsAsync(database, ct);
        var now = demo.Now;
        (string Text, string Phase)[] words =
        [
            ("Expected", MapFlightPhases.Scheduled), ("Unknown", MapFlightPhases.Scheduled), ("CheckIn", MapFlightPhases.Scheduled),
            ("Boarding", MapFlightPhases.Scheduled), ("GateClosed", MapFlightPhases.Scheduled), ("Delayed", MapFlightPhases.Scheduled),
            ("Departed", MapFlightPhases.Departed), ("EnRoute", MapFlightPhases.EnRoute), ("Approaching", MapFlightPhases.Approaching),
            ("Arrived", MapFlightPhases.Arrived), ("Canceled", MapFlightPhases.Cancelled), ("Cancelled", MapFlightPhases.Cancelled),
            ("CanceledUncertain", MapFlightPhases.Cancelled), ("Diverted", MapFlightPhases.Diverted),
            ("arrived", MapFlightPhases.Arrived), ("ENROUTE", MapFlightPhases.EnRoute), ("Landed", MapFlightPhases.Unknown),
        ];
        var reported = words.Select((word, index) => MapLeg(FlightDirection.Arrival, $"ZZ3{index:00}",
            now.AddMinutes(60 + index), $"HI3{index:00}", word.Text)).ToList();
        reported.AddRange(
        [
            // An arrival still expected whose time has come, one whose estimate is ahead, one on the runway, a departure
            // that took off and one that waits.
            MapLeg(FlightDirection.Arrival, "ZZ401", now.AddMinutes(-30), "HI4010"),
            MapLeg(FlightDirection.Arrival, "ZZ402", now.AddMinutes(-30), "HI4020", "Delayed", revisedAt: now.AddMinutes(20)),
            MapLeg(FlightDirection.Arrival, "ZZ403", now.AddMinutes(-15), "HI4030", "Approaching",
                runwayAt: now.AddMinutes(-10)),
            MapLeg(FlightDirection.Departure, "ZZ404", now.AddMinutes(-20), "HI4040", "Expected", runwayAt: now.AddMinutes(-5)),
            MapLeg(FlightDirection.Departure, "ZZ405", now.AddMinutes(-30), "HI4050"),
            // A pair OCC imports below.
            MapLeg(FlightDirection.Arrival, "ZZ501", now.AddMinutes(90), "HI5001"),
            MapLeg(FlightDirection.Departure, "ZZ502", now.AddMinutes(180), "HI5001"),
        ]);
        await MapFeedAsync(demo, ct, [.. reported]);

        var map = await MapAsync(demo, ct);
        foreach (var (word, index) in words.Select((word, index) => (word, index)))
        {
            var row = MapFlight(map, $"ZZ3{index:00}");
            Assert.Equal((word.Phase, word.Text, (DateTimeOffset?)null), (row.Phase, row.ProviderStatus, row.ActualAt));
        }
        Assert.Equal((MapFlightPhases.EnRoute, MapFlightPhases.Scheduled, MapFlightPhases.Landed, MapFlightPhases.Departed,
                MapFlightPhases.Scheduled),
            (MapFlight(map, "ZZ401").Phase, MapFlight(map, "ZZ402").Phase, MapFlight(map, "ZZ403").Phase,
                MapFlight(map, "ZZ404").Phase, MapFlight(map, "ZZ405").Phase));
        Assert.Equal(((DateTimeOffset?)now.AddMinutes(-10), MapFlightActualKinds.Runway, (DateTimeOffset?)now.AddMinutes(-5),
                MapFlightActualKinds.Runway),
            (MapFlight(map, "ZZ403").ActualAt, MapFlight(map, "ZZ403").ActualKind, MapFlight(map, "ZZ404").ActualAt,
                MapFlight(map, "ZZ404").ActualKind));

        // OCC imports a pair; the provider then reports the arrival diverted: OCC decides, the leg says so meanwhile. The
        // departure's runway time reaches its leg, which the feed still owns.
        var (arrival, departure) = Proposal(await demo.Feed(), "ZZ501");
        var imported = await demo.Import(new DemoPair(arrival, departure));
        Assert.True(imported.Failure is null, imported.Code);
        demo.Clock.Now = now.AddMinutes(1);
        await MapFeedAsync(demo, ct,
            MapLeg(FlightDirection.Arrival, "ZZ501", now.AddMinutes(90), "HI5001", "Diverted"),
            MapLeg(FlightDirection.Departure, "ZZ502", now.AddMinutes(180), "HI5001", "Departed", runwayAt: now.AddMinutes(1)));
        var after = await MapAsync(demo, ct);
        Assert.Equal((true, MapFlightPhases.Diverted, "Diverted", "Confirmed"),
            (MapFlight(after, "ZZ501").Imported, MapFlight(after, "ZZ501").Phase, MapFlight(after, "ZZ501").ProviderStatus,
                MapFlight(after, "ZZ501").Turnaround!.Status));
        Assert.Equal((true, (DateTimeOffset?)now.AddMinutes(1), MapFlightActualKinds.Runway, MapFlightPhases.Departed),
            (MapFlight(after, "ZZ502").Imported, MapFlight(after, "ZZ502").ActualAt, MapFlight(after, "ZZ502").ActualKind,
                MapFlight(after, "ZZ502").Phase));
    }

    /// <summary>
    /// An aircraft that landed and has not left stays on the map whatever its times, after midnight too, until it leaves
    /// (its departure has an actual time, or the tablet recorded its push-back), its turnaround is completed or the visit
    /// is older than yesterday. A flight OCC typed never gets a departure time: its push-back says it left.
    /// </summary>
    [Fact]
    public async Task AnAircraftOnTheGroundAcrossMidnightStaysOnTheMap()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var demo = await DemoFlightsAsync(database, ct, start: day => LocalAt(day, 22));
        var day = demo.Day;

        // A late arrival that stays the night, and an evening visit that never landed.
        var overnight = await PlanManualFlightAsync(demo.Provider, demo.Airline, demo.Stands["B01"], day, "ZZ951",
            LocalAt(day, 22, 30), LocalAt(day.AddDays(1), 12), ct);
        Assert.True(overnight.IsSuccess, overnight.Code);
        var evening = await PlanManualFlightAsync(demo.Provider, demo.Airline, demo.Stands["B02"], day, "ZZ961",
            LocalAt(day, 21), LocalAt(day, 23), ct);
        Assert.True(evening.IsSuccess, evening.Code);
        demo.Clock.Now = LocalAt(day, 22, 40);
        var recorded = await demo.Run(services => services.GetRequiredService<IOccPositionStore>().RecordArrivalAsync(
            SeededOccAccount, overnight.TurnaroundId!.Value, new RecordArrivalInput("HI9510", LocalAt(day, 22, 35)),
            OccPositionCommand.None, ct));
        Assert.Null(recorded.Failure);

        // At six the next morning the window is 04:00 to 10:00: neither leg of the overnight visit is in it, but its
        // aircraft is on the ground. The evening visit is not.
        demo.Clock.Now = LocalAt(day.AddDays(1), 6);
        async Task<IReadOnlyList<(string, string)>> OnTheMap() => (await MapAsync(demo, ct, hoursBack: 2, hoursAhead: 4))
            .Flights.Select(item => (item.FlightNumber, item.Phase)).ToArray();
        Assert.Equal([("ZZ951", MapFlightPhases.Arrived), ("ZZ951D", MapFlightPhases.Scheduled)], await OnTheMap());
        var arrivalLeg = MapFlight(await MapAsync(demo, ct, hoursBack: 2, hoursAhead: 4), "ZZ951");
        Assert.Equal(((DateTimeOffset?)LocalAt(day, 22, 35), MapFlightActualKinds.OnBlock, "InProgress"),
            (arrivalLeg.ActualAt, arrivalLeg.ActualKind, arrivalLeg.Turnaround!.Status));

        // A completed turnaround is no longer on the ground.
        await using (var setup = CreateContext(database.ConnectionString))
            await setup.Turnarounds.Where(item => item.PublicId == overnight.TurnaroundId)
                .ExecuteUpdateAsync(set => set.SetProperty(item => item.CurrentStatus, TurnaroundStatus.Completed), ct);
        Assert.Empty(await OnTheMap());
        await using (var setup = CreateContext(database.ConnectionString))
        {
            await setup.Turnarounds.Where(item => item.PublicId == overnight.TurnaroundId)
                .ExecuteUpdateAsync(set => set.SetProperty(item => item.CurrentStatus, TurnaroundStatus.InProgress), ct);
            Assert.Equal(2, (await OnTheMap()).Count);
            var departureId = await (from leg in setup.FlightLegs
                                     join turnaround in setup.Turnarounds on leg.TurnaroundId equals turnaround.Id
                                     where turnaround.PublicId == overnight.TurnaroundId && leg.Direction == FlightDirection.Departure
                                     select leg.Id).SingleAsync(ct);
            // The departure has an actual time, 05:30: the aircraft left. The feed and the demo worker write it on the legs
            // they own (here with the context). The arrival leaves the map, and the departure stays while that time is in
            // the window.
            await setup.FlightLegs.Where(item => item.Id == departureId)
                .ExecuteUpdateAsync(set => set.SetProperty(item => item.ActualAt, LocalAt(day.AddDays(1), 5, 30)), ct);
            Assert.Equal([("ZZ951D", MapFlightPhases.Departed)], await OnTheMap());
            await setup.FlightLegs.Where(item => item.Id == departureId)
                .ExecuteUpdateAsync(set => set.SetProperty(item => item.ActualAt, (DateTimeOffset?)null), ct);
        }
        Assert.Equal(2, (await OnTheMap()).Count);

        // Two mornings later the visit is older than yesterday: it is not on the map, whatever its rows say.
        demo.Clock.Now = LocalAt(day.AddDays(2), 6);
        Assert.Empty(await OnTheMap());

        // Back at six the next morning, the tablet records the push-back at 05:30 (written with the context as the tablet
        // writes it: its commands have their own tests). Nothing writes the actual time of the departure of a flight OCC
        // typed, but the aircraft left its stand (owner decision 23): the visit is no longer on the ground, and neither
        // leg's time is in the window.
        demo.Clock.Now = LocalAt(day.AddDays(1), 6);
        Assert.Equal(2, (await OnTheMap()).Count);
        var pushback = new OccMapMilestoneData(RampEvidenceTimePolicy.Pushback, LocalAt(day.AddDays(1), 5, 30));
        var operation = await MapOperationAsync(database.ConnectionString, overnight.TurnaroundId!.Value, ct);
        await using (var setup = CreateContext(database.ConnectionString))
        {
            setup.Add(new OperationMilestone
            {
                PublicId = Guid.CreateVersion7(), GroundOperationId = operation.Id, Code = pushback.Code,
                ActualAt = pushback.ActualAt, Status = MilestoneStatus.Actual, Source = OperationalDataSource.Manual,
                CreatedAt = demo.Now, UpdatedAt = demo.Now,
            });
            await setup.SaveChangesAsync(ct);
        }
        Assert.Empty(await OnTheMap());
        // The departure is on the map while its own time is: until two in the afternoon, its scheduled noon. It still
        // waits for its time, with the push-back among its milestones.
        var departing = Assert.Single((await MapAsync(demo, ct, hoursBack: 2, hoursAhead: 8)).Flights);
        Assert.Equal(("ZZ951D", MapFlightPhases.Scheduled, (DateTimeOffset?)null),
            (departing.FlightNumber, departing.Phase, departing.ActualAt));
        Assert.Equal([pushback], departing.Milestones);
    }

    /// <summary>
    /// The live aircraft are matched against the map's own flights from two hours back to six ahead, with the same keys,
    /// without the demo flights: their aircraft are not real. Both ports are one store per scope.
    /// </summary>
    [Fact]
    public async Task TheMatchKeysAreTheMapFlightKeysWithoutDemoFlights()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var demo = await DemoFlightsAsync(database, ct);
        var now = demo.Now;
        await MapFeedAsync(demo, ct,
            MapLeg(FlightDirection.Arrival, "ZZ161", now.AddMinutes(60), "HI1001"),
            MapLeg(FlightDirection.Departure, "ZZ162", now.AddMinutes(150), "HI1001"),
            MapLeg(FlightDirection.Arrival, "ZZ171", now.AddMinutes(-60), "HI1002", "Arrived", runwayAt: now.AddMinutes(-63)),
            MapLeg(FlightDirection.Departure, "ZZ172", now.AddMinutes(30), "HI1002"),
            MapLeg(FlightDirection.Arrival, "ZZ181", now.AddHours(7), "HI1081"));
        var (zz171, zz172) = Proposal(await demo.Feed(), "ZZ171");
        var imported = await demo.Import(new DemoPair(zz171, zz172), demo.Stands["A02"]);
        Assert.True(imported.Failure is null, imported.Code);
        var manual = await PlanManualFlightAsync(demo.Provider, demo.Airline, demo.Stands["B01"], demo.Day, "ZZ911",
            now.AddMinutes(35), now.AddMinutes(125), ct);
        Assert.True(manual.IsSuccess, manual.Code);
        var flight = await demo.Triggered(minutes: 8, stand: demo.Stands["A03"]);
        var ids = await MapProposalIdsAsync(database.ConnectionString, ct, "ZZ161", "ZZ162", "ZZ171", "ZZ172");
        var legs = await MapLegIdsAsync(database.ConnectionString, ct, manual.TurnaroundId!.Value);

        async Task<IReadOnlyList<MapFlightMatchKey>> MatchKeys(Guid station) =>
            await demo.Run(services => services.GetRequiredService<IOccMapFlightMatchKeyStore>()
                .ListMatchKeysAsync(station, demo.Now, ct));
        // The map of the same window, without its demo flights, as the matcher reads it.
        async Task<IReadOnlyList<MapFlightMatchKey>> MapKeys() =>
            (await MapAsync(demo, ct, hoursBack: 2, hoursAhead: 6)).Flights.Where(item => !item.IsDemo)
            .Select(item => new MapFlightMatchKey(item.FlightKey, item.Direction, item.FlightNumber, item.Airline.IcaoCode,
                item.Airline.IataCode, item.Aircraft?.Registration, item.ActualAt ?? item.EstimatedAt ?? item.ScheduledAt,
                item.ActualAt is not null, false)).ToArray();

        var keys = await MatchKeys(SeededPujStation);
        Assert.Equal(await MapKeys(), keys);
        Assert.Equal(
        [
            new MapFlightMatchKey(MapFlightKeys.Proposal(ids["ZZ171"]), "Arrival", "ZZ171", "DZZ", "ZZ", "HI1002",
                now.AddMinutes(-63), true, false),
            new MapFlightMatchKey(MapFlightKeys.Proposal(ids["ZZ172"]), "Departure", "ZZ172", "DZZ", "ZZ", "HI1002",
                now.AddMinutes(30), false, false),
            new MapFlightMatchKey(MapFlightKeys.Leg(legs["ZZ911"]), "Arrival", "ZZ911", "DZZ", "ZZ", null, now.AddMinutes(35),
                false, false),
            new MapFlightMatchKey(MapFlightKeys.Proposal(ids["ZZ161"]), "Arrival", "ZZ161", "DZZ", "ZZ", "HI1001",
                now.AddMinutes(60), false, false),
            new MapFlightMatchKey(MapFlightKeys.Leg(legs["ZZ911D"]), "Departure", "ZZ911D", "DZZ", "ZZ", null,
                now.AddMinutes(125), false, false),
            new MapFlightMatchKey(MapFlightKeys.Proposal(ids["ZZ162"]), "Departure", "ZZ162", "DZZ", "ZZ", "HI1001",
                now.AddMinutes(150), false, false),
        ], keys);
        // The demo flight is on the map, never among the keys; the arrival seven hours ahead is on the map's longer window.
        var map = await MapAsync(demo, ct);
        Assert.True(MapFlight(map, flight.ArrivalFlightNumber).IsDemo);
        Assert.False(MapFlight(map, "ZZ181").IsDemo);
        Assert.DoesNotContain(keys, key => key.FlightNumber == flight.ArrivalFlightNumber || key.FlightNumber == "ZZ181");

        // Imported, the demo flight's legs are not among the keys either.
        await demo.Imported(flight, demo.Stands["A03"]);
        Assert.Equal(keys, await MatchKeys(SeededPujStation));
        Assert.Equal(await MapKeys(), await MatchKeys(SeededPujStation));

        // An unknown station has none; both ports are the same store in a scope.
        Assert.Empty(await MatchKeys(Guid.NewGuid()));
        await using var scope = demo.Provider.CreateAsyncScope();
        Assert.Same(scope.ServiceProvider.GetRequiredService<IOccMapFlightStore>(),
            scope.ServiceProvider.GetRequiredService<IOccMapFlightMatchKeyStore>());
    }
}
