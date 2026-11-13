using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Abstractions.Integrations;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Common;
using Elevant.Application.Integration;
using Elevant.Application.Integration.DemoFlights;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Integration;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence;
using Elevant.Persistence.Audit;
using Elevant.Persistence.Identity;
using Elevant.Persistence.Integration;
using Elevant.Persistence.Operations;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>
/// ADR-0041: the demo flights the superadministrator triggers, against SQL Server. A demo flight is two proposals of
/// the provider «Demo» and nothing else: OCC reviews, imports and operates them like any other flight, the paid feed
/// never hears of them, and the progress worker only writes what a provider would report. Every test runs on a clock it
/// moves, two days ahead of the seed's flights.
/// </summary>
public sealed partial class SqlServerMigrationTests
{
    private const string DemoProvider = "Demo";

    private sealed record DemoPair(OccFlightProposalData Arrival, OccFlightProposalData Departure);

    private sealed record DemoRows(ExternalFlightProposal Arrival, ExternalFlightProposal Departure);

    /// <summary>What OCC built from an imported pair, as the database holds it.</summary>
    private sealed record DemoTurnaround(Turnaround Turnaround, FlightLeg Arrival, FlightLeg Departure, GroundOperation Operation);

    /// <summary>
    /// The seeded station with the demo flights on and a clock the test moves. <see cref="Day"/> is the station's local
    /// day the clock starts on (two days after the seed, so nothing seeded is in the way).
    /// </summary>
    private sealed class DemoFlights(ServiceProvider provider, MovableTimeProvider clock, string connection, Guid airline,
        Guid aircraftType, PlanningStands stands, DateOnly day, CancellationToken ct) : IAsyncDisposable
    {
        public ServiceProvider Provider => provider;

        public MovableTimeProvider Clock => clock;

        public string Connection => connection;

        public Guid Airline => airline;

        public Guid AircraftType => aircraftType;

        public PlanningStands Stands => stands;

        public DateOnly Day => day;

        public DateTimeOffset Now => clock.Now;

        public ValueTask DisposeAsync() => provider.DisposeAsync();

        public async Task<T> Run<T>(Func<IServiceProvider, Task<T>> action)
        {
            await using var scope = provider.CreateAsyncScope();
            return await action(scope.ServiceProvider);
        }

        public CreateDemoFlightCommand Command(int minutes = 8, int ground = 60, Guid? stand = null, string origin = "MIA",
            string? destination = null) =>
            new(SeededPujStation, airline, origin, destination, aircraftType, stand is null ? "None" : "Specific", stand,
                minutes, ground);

        public Task<MasterDataResult<DemoFlightData>> Trigger(CreateDemoFlightCommand command, Guid? key = null,
            Guid? actor = null) =>
            Run(services => services.GetRequiredService<DemoFlightHandler>().CreateAsync(actor ?? SuperAdministratorAccount,
                command, key ?? Guid.NewGuid(), ct));

        /// <summary>A demo flight the trigger accepted.</summary>
        public async Task<DemoFlightData> Triggered(int minutes = 8, int ground = 60, Guid? stand = null, string origin = "MIA")
        {
            var result = await Trigger(Command(minutes, ground, stand, origin));
            Assert.True(result.Failure is null, result.Code);
            return result.Value!;
        }

        public Task<MasterDataResult<DemoFlightData>> End(Guid demoId, string intent, Guid? key = null, Guid? actor = null) =>
            Run(services => services.GetRequiredService<DemoFlightHandler>().CancelAsync(actor ?? SuperAdministratorAccount,
                demoId, intent, key ?? Guid.NewGuid(), ct));

        /// <summary>One tick of the progress worker at the clock's time.</summary>
        public Task<int> Tick() =>
            Run(services => services.GetRequiredService<IDemoFlightStore>().AdvanceAsync(clock.Now, ct));

        public async Task<IReadOnlyList<DemoFlightData>> Listed() =>
            (await Run(services => services.GetRequiredService<DemoFlightHandler>()
                .ListAsync(SuperAdministratorAccount, SeededPujStation, ct)))!.Flights;

        /// <summary>The flight as the superadministrator's list shows it now.</summary>
        public async Task<DemoFlightData> Flight(Guid demoId) => (await Listed()).Single(flight => flight.Id == demoId);

        public async Task<DemoFlightOptionsData> Options(Guid? station = null) =>
            (await Run(services => services.GetRequiredService<DemoFlightHandler>()
                .OptionsAsync(SuperAdministratorAccount, station, ct)))!;

        /// <summary>OCC's review of the flight's day.</summary>
        public async Task<IReadOnlyList<OccFlightProposalData>> Feed(OccFlightFeedView view = OccFlightFeedView.Contracted) =>
            (await Run(services => services.GetRequiredService<IOccFlightFeedStore>()
                .ListAsync(SeededOccAccount, SeededPujStation, day, view, ct)))!.Proposals;

        /// <summary>The two legs of the flight as OCC's review lists them.</summary>
        public async Task<DemoPair> Pair(DemoFlightData flight, OccFlightFeedView view = OccFlightFeedView.Contracted)
        {
            var feed = await Feed(view);
            return new DemoPair(feed.Single(item => item.FlightNumber == flight.ArrivalFlightNumber),
                feed.Single(item => item.FlightNumber == flight.DepartureFlightNumber));
        }

        /// <summary>«Importar escala» with the versions of <paramref name="pair"/> and the flight's aircraft type.</summary>
        public Task<OccFlightImportResult> Import(DemoPair pair, Guid? stand = null) =>
            Run(services => services.GetRequiredService<IOccFlightFeedStore>().ImportAsync(SeededOccAccount,
                new OccFlightImportInput(pair.Arrival.ProposalId, pair.Departure.ProposalId, aircraftType, stand, false,
                    pair.Arrival.Version, pair.Departure.Version), Guid.NewGuid(), ct));

        /// <summary>The flight imported by OCC as it reads it now; the turnaround it created.</summary>
        public async Task<Guid> Imported(DemoFlightData flight, Guid? stand = null)
        {
            var imported = await Import(await Pair(flight), stand);
            Assert.True(imported.Failure is null, imported.Code);
            return imported.TurnaroundId!.Value;
        }

        public async Task<DemoRows> Rows(Guid demoId)
        {
            await using var context = CreateContext(connection);
            var prefix = demoId.ToString("N");
            var rows = await context.Set<ExternalFlightProposal>().AsNoTracking()
                .Where(item => item.Provider == DemoProvider && item.ExternalReference.StartsWith(prefix)).ToArrayAsync(ct);
            return new DemoRows(rows.Single(item => item.Direction == FlightDirection.Arrival),
                rows.Single(item => item.Direction == FlightDirection.Departure));
        }

        public async Task<DemoTurnaround> Turnaround(Guid turnaroundId)
        {
            await using var context = CreateContext(connection);
            var turnaround = await context.Turnarounds.AsNoTracking().SingleAsync(item => item.PublicId == turnaroundId, ct);
            var legs = await context.FlightLegs.AsNoTracking().Where(item => item.TurnaroundId == turnaround.Id).ToArrayAsync(ct);
            return new DemoTurnaround(turnaround, legs.Single(item => item.Direction == FlightDirection.Arrival),
                legs.Single(item => item.Direction == FlightDirection.Departure),
                await context.GroundOperations.AsNoTracking().SingleAsync(item => item.TurnaroundId == turnaround.Id, ct));
        }

        /// <summary>The <c>occ_planning</c> announcements queued for the station's OCC accounts.</summary>
        public async Task<int> PlanningHints()
        {
            await using var context = CreateContext(connection);
            return (await context.OutboxMessages.AsNoTracking().Where(item => item.EventType == "account.changed.v1")
                    .ToArrayAsync(ct)).Select(AccountChangeOutboxWriter.Decode)
                .Count(item => item.Resource == "occ_planning" && item.ResourceId == SeededPujStation);
        }

        /// <summary>The OCC accounts that have the station in scope: each announcement and notice reaches every one.</summary>
        public async Task<int> OccAccounts()
        {
            await using var context = CreateContext(connection);
            var station = await context.Stations.AsNoTracking().Where(item => item.PublicId == SeededPujStation)
                .Select(item => item.Id).SingleAsync(ct);
            return (await OperationalNotificationWriter.OccRecipientsAsync(context, station, clock.Now, null, ct)).Length;
        }

        public async Task<AuditEntry[]> Audits(Guid demoId)
        {
            await using var context = CreateContext(connection);
            return await context.AuditEntries.AsNoTracking()
                .Where(item => item.EntityPublicId == demoId && item.Action.StartsWith("governance.demo_flight."))
                .OrderBy(item => item.Id).ToArrayAsync(ct);
        }

        /// <summary>
        /// The seeded agent assigned to the operation as OCC would leave it, written with the context: the assignment's
        /// rules (shift, documents, mentor) have their own tests.
        /// </summary>
        public async Task AssignAgent(Guid turnaroundId)
        {
            await using var context = CreateContext(connection);
            var operation = await (from item in context.GroundOperations
                                   join turnaround in context.Turnarounds on item.TurnaroundId equals turnaround.Id
                                   where turnaround.PublicId == turnaroundId
                                   select item).SingleAsync(ct);
            var agent = await (from item in context.RampAgents
                               join account in context.Users on item.PersonId equals account.PersonId
                               where account.PublicId == SeededRampAgentAccount
                               select item.Id).SingleAsync(ct);
            var occ = await context.Users.Where(user => user.PublicId == SeededOccAccount).Select(user => user.Id).SingleAsync(ct);
            operation.CurrentStatus = GroundOperationStatus.Assigned;
            context.OperationAgentAssignments.Add(new OperationAgentAssignment
            {
                PublicId = Guid.CreateVersion7(), GroundOperationId = operation.Id, RampAgentId = agent,
                AssignmentRole = "primary", AssignedAt = clock.Now, AssignedByAccountId = occ, CreatedAt = clock.Now,
                UpdatedAt = clock.Now,
            });
            await context.SaveChangesAsync(ct);
        }
    }

    private static async Task<DemoFlights> DemoFlightsAsync(TemporaryDatabase database, CancellationToken ct,
        Func<DateOnly, DateTimeOffset>? start = null, IAirportFlightFeed? feed = null)
    {
        await using (await SeededFinanceProviderAsync(database, ct)) { }
        var (airline, stands) = await PlanningFixtureAsync(database.ConnectionString, ct);
        var day = BusinessCalendar.Today(DateTimeOffset.UtcNow, StationZone).AddDays(2);
        var clock = new MovableTimeProvider(start?.Invoke(day) ?? LocalAt(day, 10));
        var services = new ServiceCollection().AddLogging()
            .AddSingleton<TimeProvider>(clock)
            .AddSingleton(DemoFlightAvailability.On)
            .AddScoped<DemoFlightHandler>();
        if (feed is not null) services.AddSingleton(feed);
        var provider = services.AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString,
        }).Build()).BuildServiceProvider(new ServiceProviderOptions { ValidateOnBuild = true, ValidateScopes = true });
        return new DemoFlights(provider, clock, database.ConnectionString, airline,
            await AircraftTypeAsync(database.ConnectionString, "A320", ct), stands, day, ct);
    }

    /// <summary>
    /// The trigger writes two proposals of the provider «Demo» with everything the import needs, the origin airport with
    /// its coordinates, one audit entry and one announcement to OCC. The same key replays the first flight; the fourth
    /// active flight of a station is refused.
    /// </summary>
    [Fact]
    public async Task DemoFlightCreateWritesTwoProposalsReplaysAndStopsAtThreeActive()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var demo = await DemoFlightsAsync(database, ct);
        var now = demo.Now;
        var occAccounts = await demo.OccAccounts();
        Assert.True(occAccounts > 0);
        var hints = await demo.PlanningHints();

        var key = Guid.NewGuid();
        var command = demo.Command(minutes: 8, ground: 60, stand: demo.Stands["A03"]);
        var created = await demo.Trigger(command, key);
        Assert.Null(created.Failure);
        Assert.False(created.Replayed);
        var flight = created.Value!;
        var onBlock = now.AddMinutes(8);
        // 45 % of the eight minutes on the ground: touchdown 3 min 36 s before the stand.
        Assert.Equal(("ZZ9001", "ZZ9002", "HIDM01", "Airbus A320 Development", "MIA", "MIA", "A03"),
            (flight.ArrivalFlightNumber, flight.DepartureFlightNumber, flight.AircraftRegistration, flight.AircraftModel,
                flight.OriginIata, flight.DestinationIata, flight.SuggestedStandCode));
        Assert.Equal((SeededPujStation, "PUJ", demo.Airline, "Demo Airlines"),
            (flight.StationId, flight.StationCode, flight.AirlineId, flight.AirlineName));
        Assert.Equal(("Active", "Approach", false), (flight.State, flight.Phase, flight.Imported));
        Assert.Equal((now, onBlock.AddSeconds(-216), onBlock, onBlock.AddMinutes(60)),
            (flight.AppearAt, flight.TouchdownAt, flight.OnBlockAt, flight.ScheduledOffBlockAt));
        // Nobody imported it yet: it would leave on schedule, take off five minutes later and stay in sight ten more.
        Assert.Equal(((DateTimeOffset?)onBlock.AddMinutes(60), (DateTimeOffset?)onBlock.AddMinutes(65),
                (DateTimeOffset?)onBlock.AddMinutes(75)), (flight.OffBlockAt, flight.TakeoffAt, flight.VanishAt));
        Assert.Equal((null, null, null, null), (flight.TurnaroundId, flight.OperationCode, flight.StandCode, flight.OperationStatus));

        var rows = await demo.Rows(flight.Id);
        long miami;
        await using (var check = CreateContext(database.ConnectionString))
        {
            // The seed's Miami had neither a time zone nor coordinates: the catalogue fills what it lacks and nothing else.
            var airport = await check.Airports.AsNoTracking().SingleAsync(item => item.IataCode == "MIA", ct);
            miami = airport.Id;
            Assert.Equal(("Miami Development Airport", "America/New_York", 25.7959m, -80.287m),
                (airport.Name, airport.IanaTimeZone, airport.Latitude, airport.Longitude));
        }
        // The arrival carries the demo id as its own id; both share it in their references.
        Assert.Equal((flight.Id, $"{flight.Id:N}|Arrival", $"{flight.Id:N}|Departure"),
            (rows.Arrival.PublicId, rows.Arrival.ExternalReference, rows.Departure.ExternalReference));
        Assert.Equal((onBlock, (DateTimeOffset?)onBlock, "Approaching"),
            (rows.Arrival.ScheduledAt, rows.Arrival.RevisedAt, rows.Arrival.ProviderStatus));
        Assert.Equal((onBlock.AddMinutes(60), (DateTimeOffset?)null, "Expected"),
            (rows.Departure.ScheduledAt, rows.Departure.RevisedAt, rows.Departure.ProviderStatus));
        Assert.All(new[] { rows.Arrival, rows.Departure }, row =>
        {
            Assert.Equal((DemoProvider, demo.Day, ExternalFlightProposalStatus.Proposed), (row.Provider, row.OperationDate, row.Status));
            Assert.Equal(((long?)miami, "MIA", "Miami Development Airport"),
                (row.CounterpartAirportId, row.CounterpartIata, row.CounterpartName));
            Assert.Equal(("HIDM01", "Airbus A320 Development", "A", "A03"),
                (row.AircraftRegistration, row.AircraftModel, row.Terminal, row.Gate));
            Assert.Equal((now, now, now, now), (row.FirstSeenAt, row.LastSeenAt, row.CreatedAt, row.UpdatedAt));
            Assert.Null(row.RunwayAt);
            Assert.Null(row.DecidedAt);
            Assert.Null(row.TurnaroundId);
        });
        // Every OCC account of the station is told once, in the same transaction.
        Assert.Equal(hints + occAccounts, await demo.PlanningHints());
        Assert.Equal("governance.demo_flight.created", Assert.Single(await demo.Audits(flight.Id)).Action);

        // The same key and request answer the first flight; nothing is written twice.
        var replay = await demo.Trigger(command, key);
        Assert.Equal((flight.Id, true), (replay.Value!.Id, replay.Replayed));
        Assert.Equal("idempotency_conflict", (await demo.Trigger(command with { GroundMinutes = 45 }, key)).Code);
        Assert.Single(await demo.Listed());
        Assert.Single(await demo.Audits(flight.Id));
        Assert.Equal(hints + occAccounts, await demo.PlanningHints());

        // The next flights of the day take the next numbers and registration; an airport the database does not know
        // comes from the catalogue with its coordinates.
        var second = await demo.Triggered(minutes: 5, origin: "JFK");
        Assert.Equal(("ZZ9003", "ZZ9004", "HIDM02", "JFK", (string?)null),
            (second.ArrivalFlightNumber, second.DepartureFlightNumber, second.AircraftRegistration, second.OriginIata,
                second.SuggestedStandCode));
        await using (var check = CreateContext(database.ConnectionString))
        {
            var kennedy = await check.Airports.AsNoTracking().SingleAsync(item => item.IataCode == "JFK", ct);
            Assert.Equal(("KJFK", "US", "America/New_York", 40.6413m, -73.7781m),
                (kennedy.IcaoCode, kennedy.CountryCode, kennedy.IanaTimeZone, kennedy.Latitude, kennedy.Longitude));
        }
        // The destination of the departure may be another airport.
        var third = (await demo.Trigger(demo.Command(minutes: 30, ground: 240, origin: "JFK", destination: "MAD"))).Value!;
        Assert.Equal(("ZZ9005", "ZZ9006", "HIDM03", "JFK", "MAD"),
            (third.ArrivalFlightNumber, third.DepartureFlightNumber, third.AircraftRegistration, third.OriginIata,
                third.DestinationIata));
        Assert.Equal([third.Id, second.Id, flight.Id], (await demo.Listed()).Select(item => item.Id));

        // Three active flights are the station's limit.
        Assert.Equal(3, (await demo.Options()).Limits.Active);
        var fourth = await demo.Trigger(demo.Command());
        Assert.Equal((MasterDataFailure.Conflict, "demo_flight_limit_reached"), (fourth.Failure, fourth.Code));
        Assert.Equal(3, (await demo.Listed()).Count);
        await using (var check = CreateContext(database.ConnectionString))
            Assert.Equal(6, await check.Set<ExternalFlightProposal>().CountAsync(item => item.Provider == DemoProvider, ct));
    }

    /// <summary>
    /// A paid feed that counts its calls: the synchronizer reads it exactly as it reads AeroDataBox, and it reports no
    /// flights. Nothing here reaches a provider.
    /// </summary>
    private sealed class CountingPaidFeed : IAirportFlightFeed
    {
        public int Calls { get; private set; }

        public string Provider => "AeroDataBox";

        public bool IsConfigured => true;

        public int UnitsPerCall => 2;

        public TimeSpan MaxWindow => TimeSpan.FromHours(12);

        public Task<AirportFeedResponse> GetFlightsAsync(string airportIataCode, DateTime fromLocal, DateTime toLocal,
            CancellationToken cancellationToken = default)
        {
            Calls++;
            return Task.FromResult(new AirportFeedResponse(ProviderCallOutcome.Succeeded, UnitsPerCall, 200, null, []));
        }
    }

    /// <summary>
    /// A demo flight never brings a paid read forward: neither its proposals nor, once OCC imported them, its legs count
    /// as flights of the day for AeroDataBox, so the planner keeps skipping. A flight typed by hand, which has no
    /// provider either, still counts.
    /// </summary>
    [Fact]
    public async Task ADemoFlightNeverChangesThePaidPlannersCadence()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        var paid = new CountingPaidFeed();
        await using var demo = await DemoFlightsAsync(database, ct, feed: paid);
        Task<int> Scheduled() => demo.Run(services => new FlightFeedSynchronizer(
            services.GetRequiredService<IFlightFeedSyncStore>(), paid, demo.Clock, FlightFeedBudget.Default).RunScheduledAsync(ct));
        async Task<IReadOnlyList<DateTimeOffset>> FlightsOfTheDay()
        {
            return await demo.Run(async services =>
            {
                var sync = services.GetRequiredService<IFlightFeedSyncStore>();
                var station = Assert.Single(await sync.ListStationsAsync(demo.Now, ct), item => item.StationPublicId == SeededPujStation);
                return (await sync.GetActivityAsync("AeroDataBox", station, demo.Now, ct)).ContractedFlightTimesToday
                    .Order().ToArray();
            });
        }

        // The day's two halves are read once; with no flight of a contracted airline nothing else is.
        Assert.Equal(1, await Scheduled());
        Assert.Equal(1, await Scheduled());
        Assert.Equal(0, await Scheduled());
        var before = await FlightsOfTheDay();
        Assert.Empty(before);

        // A demo flight eight minutes away: a provider's flight this close would be re-read every fifteen minutes.
        var flight = await demo.Triggered(minutes: 8, stand: demo.Stands["A03"]);
        demo.Clock.Now += TimeSpan.FromMinutes(16);
        Assert.Equal(before, await FlightsOfTheDay());
        Assert.Equal(0, await Scheduled());

        // Imported, its legs belong to a turnaround whose provider is «Demo»: still nothing to read.
        var turnaroundId = await demo.Imported(flight, demo.Stands["A03"]);
        Assert.Equal(DemoProvider, (await demo.Turnaround(turnaroundId)).Turnaround.ExternalProvider);
        demo.Clock.Now += TimeSpan.FromMinutes(16);
        Assert.Equal(before, await FlightsOfTheDay());
        Assert.Equal(0, await Scheduled());
        Assert.Equal(2, paid.Calls);

        // A flight OCC typed by hand has no provider at all: it counts, and the planner refreshes for it.
        var arrival = demo.Now.AddMinutes(30);
        var manual = await PlanManualFlightAsync(demo.Provider, demo.Airline, demo.Stands["A01"], demo.Day, "ZZ905", arrival,
            arrival.AddMinutes(90), ct);
        Assert.True(manual.IsSuccess, manual.Code);
        Assert.Null((await demo.Turnaround(manual.TurnaroundId!.Value)).Turnaround.ExternalProvider);
        Assert.Equal([arrival, arrival.AddMinutes(90)], await FlightsOfTheDay());
        Assert.Equal(1, await Scheduled());
        Assert.Equal(3, paid.Calls);
        await using var check = CreateContext(database.ConnectionString);
        Assert.Equal(6, await check.Set<ProviderUsageEntry>().AsNoTracking().Where(item => item.Provider == "AeroDataBox")
            .SumAsync(item => item.Units, ct));
        Assert.False(await check.Set<ProviderUsageEntry>().AsNoTracking().AnyAsync(item => item.Provider == DemoProvider, ct));
    }

    /// <summary>
    /// The worker never writes a pair nobody imported, so the versions OCC read before the aircraft landed still import
    /// it afterwards; until then the review derives «Arrived» and the runway time from the clock. The first tick after
    /// the import stamps the landing on the proposal and on the leg.
    /// </summary>
    [Fact]
    public async Task AnImportWithTheVersionReadBeforeTouchdownSucceedsAfterTouchdown()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var demo = await DemoFlightsAsync(database, ct);
        var flight = await demo.Triggered(minutes: 8, stand: demo.Stands["A03"]);

        // OCC opens the import dialog while the aircraft is on approach.
        var read = await demo.Pair(flight);
        Assert.Equal(("Approaching", null, "A", "A03", true), (read.Arrival.ProviderStatus, read.Arrival.RunwayAt,
            read.Arrival.Terminal, read.Arrival.Gate, read.Arrival.IsDemo));
        Assert.Equal(("Expected", null, true), (read.Departure.ProviderStatus, read.Departure.RunwayAt, read.Departure.IsDemo));
        Assert.Equal((read.Departure.ProposalId, demo.AircraftType),
            (read.Arrival.SuggestedDepartureId, read.Arrival.SuggestedAircraftTypeId));

        // The aircraft lands. The worker ticks and writes nothing: the review tells the landing from the clock.
        demo.Clock.Now = flight.TouchdownAt.AddSeconds(30);
        Assert.Equal(0, await demo.Tick());
        var landed = await demo.Pair(flight);
        Assert.Equal(("Arrived", flight.TouchdownAt), (landed.Arrival.ProviderStatus, landed.Arrival.RunwayAt));
        Assert.Equal(("Expected", null), (landed.Departure.ProviderStatus, landed.Departure.RunwayAt));
        Assert.Equal((read.Arrival.Version, read.Departure.Version), (landed.Arrival.Version, landed.Departure.Version));
        var untouched = await demo.Rows(flight.Id);
        Assert.Equal(("Approaching", null, flight.AppearAt),
            (untouched.Arrival.ProviderStatus, untouched.Arrival.RunwayAt, untouched.Arrival.UpdatedAt));
        Assert.Equal("TaxiIn", (await demo.Flight(flight.Id)).Phase);

        // «Importar escala» with what the dialog read before the landing.
        var hints = await demo.PlanningHints();
        var imported = await demo.Import(read, demo.Stands["A03"]);
        Assert.Null(imported.Failure);
        var turnaround = await demo.Turnaround(imported.TurnaroundId!.Value);
        Assert.Equal((DemoProvider, $"{flight.Id:N}|Arrival", TurnaroundStatus.Confirmed, "HIDM01"),
            (turnaround.Turnaround.ExternalProvider, turnaround.Turnaround.ExternalReference,
                turnaround.Turnaround.CurrentStatus, turnaround.Turnaround.AircraftRegistration));
        // The import copies what the proposal holds: no runway time yet, and the on-block time as the estimate.
        Assert.Equal((null, flight.OnBlockAt, OperationalDataSource.ExternalProvider),
            (turnaround.Arrival.ActualAt, turnaround.Arrival.EstimatedAt, turnaround.Arrival.Source));

        // The worker's next tick reports the landing, at the instant the clock planned and not at the tick's.
        demo.Clock.Now += TimeSpan.FromSeconds(5);
        var occAccounts = await demo.OccAccounts();
        Assert.Equal(1, await demo.Tick());
        var stamped = await demo.Rows(flight.Id);
        Assert.Equal(("Arrived", flight.TouchdownAt, demo.Now, demo.Now, ExternalFlightProposalStatus.Confirmed),
            (stamped.Arrival.ProviderStatus, stamped.Arrival.RunwayAt, stamped.Arrival.LastSeenAt, stamped.Arrival.UpdatedAt,
                stamped.Arrival.Status));
        Assert.Equal(("Expected", null), (stamped.Departure.ProviderStatus, stamped.Departure.RunwayAt));
        turnaround = await demo.Turnaround(imported.TurnaroundId!.Value);
        Assert.Equal((flight.TouchdownAt, demo.Now, OperationalDataSource.ExternalProvider),
            (turnaround.Arrival.ActualAt, turnaround.Arrival.SourceObservedAt, turnaround.Arrival.Source));
        Assert.Null(turnaround.Departure.ActualAt);
        // Like the feed, the worker leaves the turnaround's status to OCC, and tells its screens once.
        Assert.Equal(TurnaroundStatus.Confirmed, turnaround.Turnaround.CurrentStatus);
        Assert.Equal(hints + 2 * occAccounts, await demo.PlanningHints());
        Assert.Equal(0, await demo.Tick());

        // The superadministrator sees who imported it and where it parks.
        var followed = await demo.Flight(flight.Id);
        Assert.Equal(("Active", "TaxiIn", true, imported.TurnaroundId, imported.OperationCode, "A03", "Planned"),
            (followed.State, followed.Phase, followed.Imported, followed.TurnaroundId, followed.OperationCode,
                followed.StandCode, followed.OperationStatus));
        // An imported aircraft waits for its agent: no departure is known yet.
        Assert.Equal((null, null, null), (followed.OffBlockAt, followed.TakeoffAt, followed.VanishAt));
    }

    /// <summary>
    /// OCC may import the pair when the aircraft already reached its stand: the leg is created without a runway time
    /// (the proposal has none) and the next tick writes the touchdown the clock planned.
    /// </summary>
    [Fact]
    public async Task AnImportAfterOnBlockGetsItsLandingStampOnTheNextTick()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var demo = await DemoFlightsAsync(database, ct);
        var flight = await demo.Triggered(minutes: 2);
        // Two minutes to the stand: the 90-second floor of the taxi applies.
        Assert.Equal(flight.OnBlockAt.AddSeconds(-90), flight.TouchdownAt);

        demo.Clock.Now = flight.OnBlockAt.AddMinutes(3);
        Assert.Equal(0, await demo.Tick());
        Assert.Equal("Parked", (await demo.Flight(flight.Id)).Phase);
        var pair = await demo.Pair(flight);
        Assert.Equal(("Arrived", flight.TouchdownAt), (pair.Arrival.ProviderStatus, pair.Arrival.RunwayAt));

        var turnaroundId = await demo.Imported(flight);
        Assert.Null((await demo.Turnaround(turnaroundId)).Arrival.ActualAt);
        // Imported, the list shows what the rows hold until the worker's next tick.
        Assert.Equal(("Approaching", null, "Confirmed"), ((await demo.Pair(flight)).Arrival.ProviderStatus,
            (await demo.Pair(flight)).Arrival.RunwayAt, (await demo.Pair(flight)).Arrival.Status));

        demo.Clock.Now += TimeSpan.FromSeconds(5);
        Assert.Equal(1, await demo.Tick());
        var turnaround = await demo.Turnaround(turnaroundId);
        Assert.Equal((flight.TouchdownAt, demo.Now), (turnaround.Arrival.ActualAt, turnaround.Arrival.SourceObservedAt));
        var rows = await demo.Rows(flight.Id);
        Assert.Equal(("Arrived", flight.TouchdownAt), (rows.Arrival.ProviderStatus, rows.Arrival.RunwayAt));
        Assert.Equal(("Arrived", flight.TouchdownAt), ((await demo.Pair(flight)).Arrival.ProviderStatus,
            (await demo.Pair(flight)).Arrival.RunwayAt));
        var followed = await demo.Flight(flight.Id);
        Assert.Equal(("Active", "Parked", true, null), (followed.State, followed.Phase, followed.Imported, followed.StandCode));
        Assert.Equal(0, await demo.Tick());

        // A time OCC recorded by hand is never rewritten: only the proposal takes the departure.
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var departure = await setup.FlightLegs.SingleAsync(item => item.Id == turnaround.Departure.Id, ct);
            departure.Source = OperationalDataSource.Manual;
            await setup.SaveChangesAsync(ct);
        }
        var finished = await demo.End(flight.Id, "Finish");
        Assert.Null(finished.Failure);
        demo.Clock.Now += DemoFlightTimeline.TaxiOut;
        Assert.Equal(1, await demo.Tick());
        turnaround = await demo.Turnaround(turnaroundId);
        Assert.Equal((null, null, OperationalDataSource.Manual),
            (turnaround.Departure.ActualAt, turnaround.Departure.EstimatedAt, turnaround.Departure.Source));
        Assert.Equal(("Departed", finished.Value!.TakeoffAt), ((await demo.Rows(flight.Id)).Departure.ProviderStatus,
            (await demo.Rows(flight.Id)).Departure.RunwayAt));
    }

    /// <summary>
    /// The agent taps PUSHBACK on the tablet while the aircraft still taxis in: it reaches its stand first and leaves
    /// from there, and the worker reports the departure five minutes later. The tablet's stores are the real ones.
    /// </summary>
    [Fact]
    public async Task PushbackBeforeOnBlockParksTheDemoAircraftAndThenReleasesIt()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var demo = await DemoFlightsAsync(database, ct);
        var flight = await demo.Triggered(minutes: 8, stand: demo.Stands["A03"]);
        var turnaroundId = await demo.Imported(flight, demo.Stands["A03"]);
        await demo.AssignAgent(turnaroundId);
        var operationId = (await demo.Turnaround(turnaroundId)).Operation.PublicId;
        var installation = Guid.Parse("81000000-0000-7000-8000-0000000000d1");
        Assert.True((await demo.Run(services => services.GetRequiredService<IMobileDeviceCommandStore>().RegisterAsync(
            new MobileDeviceRegistrationWriteRequest(SeededRampAgentAccount, installation, MobilePlatform.Android, "1.2.3",
                "Demo flight SQL test tablet", "Android 16"), ct))).IsSuccess);

        // The aircraft lands and the worker reports it; the agent starts the operation and taps PUSHBACK by mistake.
        demo.Clock.Now = flight.TouchdownAt.AddSeconds(20);
        Assert.Equal(1, await demo.Tick());
        var startKey = Guid.NewGuid();
        var started = await demo.Run(services => services.GetRequiredService<IRampOperationsCommandStore>().StartOperationAsync(
            new RampOperationStartWriteRequest(SeededRampAgentAccount, [SeededPujStation], operationId, installation, startKey,
                startKey, "demo-start", demo.Now), ct));
        Assert.True(started.IsSuccess, started.Failure?.ToString());
        demo.Clock.Now += TimeSpan.FromSeconds(30);
        var pushbackAt = demo.Now;
        Assert.True(pushbackAt < flight.OnBlockAt);
        var pushback = await demo.Run(services => services.GetRequiredService<IRampExecutionCommandStore>().RecordMilestoneAsync(
            new RampMilestoneWriteRequest(SeededRampAgentAccount, [SeededPujStation], operationId, "PUSHBACK", pushbackAt,
                installation, Guid.NewGuid(), "demo-pushback"), ct));
        Assert.True(pushback.IsSuccess, pushback.Code ?? pushback.Failure?.ToString());

        // It still parks: the off-block is the on-block instant, never earlier.
        var taxiing = await demo.Flight(flight.Id);
        Assert.Equal(("Active", "TaxiIn", "InProgress"), (taxiing.State, taxiing.Phase, taxiing.OperationStatus));
        Assert.Equal((flight.OnBlockAt, flight.OnBlockAt.AddMinutes(5), flight.OnBlockAt.AddMinutes(15)),
            (taxiing.OffBlockAt, taxiing.TakeoffAt, taxiing.VanishAt));
        Assert.Equal(0, await demo.Tick());
        demo.Clock.Now = flight.OnBlockAt;
        Assert.Equal("TaxiOut", (await demo.Flight(flight.Id)).Phase);
        Assert.Equal(0, await demo.Tick());

        // Five minutes later it takes off: the proposal and the provider's leg carry the planned instant.
        demo.Clock.Now = flight.OnBlockAt.AddMinutes(5).AddSeconds(3);
        Assert.Equal(1, await demo.Tick());
        var rows = await demo.Rows(flight.Id);
        Assert.Equal(("Departed", flight.OnBlockAt.AddMinutes(5), demo.Now),
            (rows.Departure.ProviderStatus, rows.Departure.RunwayAt, rows.Departure.LastSeenAt));
        var turnaround = await demo.Turnaround(turnaroundId);
        Assert.Equal((flight.OnBlockAt.AddMinutes(5), flight.TouchdownAt),
            (turnaround.Departure.ActualAt, turnaround.Arrival.ActualAt));
        var departed = await demo.Flight(flight.Id);
        Assert.Equal(("Finished", "Departed", flight.OnBlockAt, flight.OnBlockAt.AddMinutes(5)),
            (departed.State, departed.Phase, departed.OffBlockAt, departed.TakeoffAt));
        Assert.Equal(0, await demo.Tick());
        // The departure is decided: there is nothing for «Terminar demo» to bring forward.
        Assert.Equal("demo_flight_closed", (await demo.End(flight.Id, "Finish")).Code);
        demo.Clock.Now = flight.OnBlockAt.AddMinutes(15);
        Assert.Equal(("Finished", "Gone"), ((await demo.Flight(flight.Id)).State, (await demo.Flight(flight.Id)).Phase));
        Assert.Equal(0, await demo.Tick());
    }

    /// <summary>
    /// An agent may hand the operation off without ever tapping PUSHBACK: the aircraft leaves at the hand-off, and a
    /// flight whose departure is already decided no longer takes «Terminar demo».
    /// </summary>
    [Fact]
    public async Task AHandOffWithoutPushbackReleasesTheDemoAircraft()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var demo = await DemoFlightsAsync(database, ct);
        var flight = await demo.Triggered(minutes: 2, ground: 60);
        var turnaroundId = await demo.Imported(flight);
        demo.Clock.Now = flight.OnBlockAt.AddMinutes(10);
        Assert.Equal(1, await demo.Tick());
        var waiting = await demo.Flight(flight.Id);
        Assert.Equal(("Parked", null), (waiting.Phase, waiting.OffBlockAt));

        // The hand-off closes the operation (its rules have their own tests): the rows as the submission leaves them.
        var handedOffAt = demo.Now;
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var operation = await setup.GroundOperations.SingleAsync(item =>
                item.Id == setup.Turnarounds.Where(turnaround => turnaround.PublicId == turnaroundId)
                    .Select(turnaround => setup.GroundOperations.Where(candidate => candidate.TurnaroundId == turnaround.Id)
                        .Select(candidate => candidate.Id).Single()).Single(), ct);
            operation.CurrentStatus = GroundOperationStatus.PendingReview;
            operation.ActualStartAt = flight.OnBlockAt;
            operation.ActualEndAt = handedOffAt;
            await setup.SaveChangesAsync(ct);
        }
        var leaving = await demo.Flight(flight.Id);
        Assert.Equal(("Active", "TaxiOut", "PendingReview", handedOffAt, handedOffAt.AddMinutes(5)),
            (leaving.State, leaving.Phase, leaving.OperationStatus, leaving.OffBlockAt, leaving.TakeoffAt));
        // A decided departure closes both actions, whatever the phase a screen read: the flight is closed, not stale.
        Assert.Equal("demo_flight_closed", (await demo.End(flight.Id, "Finish")).Code);
        Assert.Equal("demo_flight_closed", (await demo.End(flight.Id, "Cancel")).Code);
        Assert.Equal(0, await demo.Tick());

        demo.Clock.Now = handedOffAt.AddMinutes(5);
        Assert.Equal(1, await demo.Tick());
        var rows = await demo.Rows(flight.Id);
        Assert.Equal(("Departed", handedOffAt.AddMinutes(5)), (rows.Departure.ProviderStatus, rows.Departure.RunwayAt));
        Assert.Equal(handedOffAt.AddMinutes(5), (await demo.Turnaround(turnaroundId)).Departure.ActualAt);
        Assert.Equal(("Finished", "Departed"), ((await demo.Flight(flight.Id)).State, (await demo.Flight(flight.Id)).Phase));
        Assert.Equal(0, await demo.Tick());
    }

    /// <summary>
    /// «Cancelar vuelo» on a flight OCC already imported is a provider cancellation: both legs read cancelled, every
    /// OCC account gets the existing notice once and the turnaround stays as it is, for OCC to decide.
    /// </summary>
    [Fact]
    public async Task CancellingAnImportedDemoFlightAlertsOccOnce()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var demo = await DemoFlightsAsync(database, ct);
        var flight = await demo.Triggered(minutes: 8, stand: demo.Stands["A03"]);
        var turnaroundId = await demo.Imported(flight, demo.Stands["A03"]);
        var occAccounts = await demo.OccAccounts();
        var hints = await demo.PlanningHints();
        async Task<int> Notices()
        {
            await using var context = CreateContext(database.ConnectionString);
            var operation = (await demo.Turnaround(turnaroundId)).Operation.Id;
            return await context.OperationalNotifications.AsNoTracking().CountAsync(item =>
                item.GroundOperationId == operation && item.Kind == "flight_cancelled_by_provider", ct);
        }
        Assert.Equal(0, await Notices());

        demo.Clock.Now += TimeSpan.FromMinutes(1);
        var key = Guid.NewGuid();
        var cancelled = await demo.End(flight.Id, "Cancel", key);
        Assert.Null(cancelled.Failure);
        Assert.False(cancelled.Replayed);
        // The aircraft is gone at the cancel instant and has no departure.
        Assert.Equal(("Cancelled", "Gone", null, null, demo.Now, true),
            (cancelled.Value!.State, cancelled.Value.Phase, cancelled.Value.OffBlockAt, cancelled.Value.TakeoffAt,
                cancelled.Value.VanishAt, cancelled.Value.Imported));
        var rows = await demo.Rows(flight.Id);
        Assert.All(new[] { rows.Arrival, rows.Departure }, row =>
            Assert.Equal(("Canceled", ExternalFlightProposalStatus.Confirmed, demo.Now), (row.ProviderStatus, row.Status, row.UpdatedAt)));
        Assert.Equal(occAccounts, await Notices());
        Assert.Equal(hints + occAccounts, await demo.PlanningHints());
        // OCC decides: the turnaround, its legs and its stand are untouched.
        var turnaround = await demo.Turnaround(turnaroundId);
        Assert.Equal((TurnaroundStatus.Confirmed, GroundOperationStatus.Planned, null),
            (turnaround.Turnaround.CurrentStatus, turnaround.Operation.CurrentStatus, turnaround.Arrival.ActualAt));
        Assert.Equal("A03", (await demo.Flight(flight.Id)).StandCode);
        Assert.Equal(["Canceled", "Canceled"], new[] { (await demo.Pair(flight)).Arrival.ProviderStatus,
            (await demo.Pair(flight)).Departure.ProviderStatus });

        // The same key answers the same flight; a new command finds it closed. Nobody is told twice.
        var replay = await demo.End(flight.Id, "Cancel", key);
        Assert.Equal((flight.Id, true), (replay.Value!.Id, replay.Replayed));
        Assert.Equal("idempotency_conflict", (await demo.End(flight.Id, "Finish", key)).Code);
        var again = await demo.End(flight.Id, "Cancel");
        Assert.Equal((MasterDataFailure.Conflict, "demo_flight_closed"), (again.Failure, again.Code));
        Assert.Equal("demo_flight_closed", (await demo.End(flight.Id, "Finish")).Code);
        Assert.Equal(occAccounts, await Notices());

        // A cancelled flight never lands: the worker writes nothing, whatever the clock says.
        demo.Clock.Now = flight.OnBlockAt.AddMinutes(90);
        Assert.Equal(0, await demo.Tick());
        Assert.Null((await demo.Rows(flight.Id)).Arrival.RunwayAt);
        Assert.Null((await demo.Turnaround(turnaroundId)).Arrival.ActualAt);
        Assert.Equal(("Cancelled", "Gone"), ((await demo.Flight(flight.Id)).State, (await demo.Flight(flight.Id)).Phase));
        Assert.Equal(["governance.demo_flight.created", "governance.demo_flight.cancelled"],
            (await demo.Audits(flight.Id)).Select(item => item.Action));
        // It no longer counts toward the station's limit.
        Assert.Equal(0, (await demo.Options()).Limits.Active);
    }

    /// <summary>
    /// An imported aircraft waits at its stand for its agent, however late: no departure is written past its scheduled
    /// off-block and no «Delayed» mark either. A pair nobody imported leaves on schedule meanwhile, and after two hours
    /// of waiting the imported one leaves by itself.
    /// </summary>
    [Fact]
    public async Task AnImportedDemoFlightNobodyStartsKeepsWaitingPastItsScheduledOffBlock()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var demo = await DemoFlightsAsync(database, ct);
        var imported = await demo.Triggered(minutes: 2, ground: 20, stand: demo.Stands["A03"]);
        var alone = await demo.Triggered(minutes: 2, ground: 20);
        // OCC puts it on another stand than the one the trigger suggested.
        var turnaroundId = await demo.Imported(imported, demo.Stands["A02"]);

        demo.Clock.Now = imported.ScheduledOffBlockAt.AddMinutes(30);
        var hints = await demo.PlanningHints();
        // The landing of the imported one, and the pair nobody imported is over: both in one tick, and the station's
        // OCC is told once for the two.
        Assert.Equal(2, await demo.Tick());
        Assert.Equal(hints + await demo.OccAccounts(), await demo.PlanningHints());
        Assert.Equal(0, await demo.Tick());
        Assert.Equal(hints + await demo.OccAccounts(), await demo.PlanningHints());
        var waiting = await demo.Flight(imported.Id);
        Assert.Equal(("Active", "Parked", "Planned", null, null, null),
            (waiting.State, waiting.Phase, waiting.OperationStatus, waiting.OffBlockAt, waiting.TakeoffAt, waiting.VanishAt));
        Assert.Equal(("A03", "A02"), (waiting.SuggestedStandCode, waiting.StandCode));
        var rows = await demo.Rows(imported.Id);
        Assert.Equal(("Expected", null, null), (rows.Departure.ProviderStatus, rows.Departure.RunwayAt, rows.Departure.RevisedAt));
        Assert.Null((await demo.Turnaround(turnaroundId)).Departure.ActualAt);
        var gone = await demo.Flight(alone.Id);
        Assert.Equal(("Finished", "Gone", alone.ScheduledOffBlockAt), (gone.State, gone.Phase, gone.OffBlockAt));
        Assert.Equal(1, (await demo.Options()).Limits.Active);

        // The aircraft still holds the stand OCC gave it, although the window OCC planned is over; the stand the
        // trigger had suggested is free for the next demo flight.
        var free = (await demo.Options()).Stands.ToDictionary(item => item.Code, item => item.Free);
        Assert.Equal((false, true), (free["A02"], free["A03"]));
        var held = await demo.Trigger(demo.Command(stand: demo.Stands["A02"]));
        Assert.Equal((MasterDataFailure.Conflict, "stand_unavailable"), (held.Failure, held.Code));
        Assert.Contains("stand_taken", held.Reasons!);
        var next = await demo.Triggered(stand: demo.Stands["A03"]);
        Assert.Null((await demo.End(next.Id, "Cancel")).Failure);

        // Just before the two hours it still waits; then it leaves, and the worker reports the take-off.
        var release = imported.ScheduledOffBlockAt + DemoFlightTimeline.MaxHold;
        demo.Clock.Now = release.AddSeconds(-1);
        Assert.Equal(0, await demo.Tick());
        Assert.Null((await demo.Flight(imported.Id)).OffBlockAt);
        demo.Clock.Now = release.AddMinutes(5);
        Assert.Equal(1, await demo.Tick());
        var left = await demo.Flight(imported.Id);
        Assert.Equal(("Finished", "Departed", release, release.AddMinutes(5)), (left.State, left.Phase, left.OffBlockAt, left.TakeoffAt));
        Assert.Equal(("Departed", release.AddMinutes(5)), ((await demo.Rows(imported.Id)).Departure.ProviderStatus,
            (await demo.Rows(imported.Id)).Departure.RunwayAt));
        Assert.Equal(release.AddMinutes(5), (await demo.Turnaround(turnaroundId)).Departure.ActualAt);
    }

    /// <summary>
    /// OCC dismissing one leg of a demo flight nobody imported cancels the flight: it stops counting toward the limit at
    /// once, its other leg reads cancelled until the worker closes it, and neither leg ever comes back.
    /// </summary>
    [Fact]
    public async Task OccDismissingADemoProposalCancelsTheFlightAndFreesTheLimit()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var demo = await DemoFlightsAsync(database, ct);
        var first = await demo.Triggered(minutes: 20);
        await demo.Triggered(minutes: 20);
        await demo.Triggered(minutes: 20);
        Assert.Equal("demo_flight_limit_reached", (await demo.Trigger(demo.Command())).Code);

        demo.Clock.Now += TimeSpan.FromMinutes(1);
        var pair = await demo.Pair(first);
        var occ = (IServiceProvider services) => services.GetRequiredService<IOccFlightFeedStore>();
        var dismissal = await demo.Run(services => occ(services).DismissAsync(SeededOccAccount, pair.Arrival.ProposalId,
            pair.Arrival.Version, Guid.NewGuid(), ct));
        Assert.Null(dismissal.Failure);
        var cancelled = await demo.Flight(first.Id);
        Assert.Equal(("Cancelled", "Gone", demo.Now, null), (cancelled.State, cancelled.Phase, cancelled.VanishAt, cancelled.TakeoffAt));
        Assert.Equal(2, (await demo.Options()).Limits.Active);

        // The other leg is still open in the review, shown as cancelled with the version OCC read; it cannot be
        // imported without its arrival.
        var open = Assert.Single(await demo.Feed(), item => item.ProposalId == pair.Departure.ProposalId);
        Assert.Equal(("Canceled", "Proposed", pair.Departure.Version, true), (open.ProviderStatus, open.Status, open.Version, open.IsDemo));
        Assert.Equal("flight_proposal_closed", (await demo.Import(pair)).Code);
        var dismissed = Assert.Single(await demo.Feed(OccFlightFeedView.Dismissed));
        Assert.Equal((pair.Arrival.ProposalId, "Approaching", true), (dismissed.ProposalId, dismissed.ProviderStatus, dismissed.IsDemo));
        // A dismissed demo leg never comes back, although its time is still ahead.
        Assert.True(first.OnBlockAt > demo.Now);
        var restore = await demo.Run(services => occ(services).RestoreAsync(SeededOccAccount, dismissed.ProposalId,
            dismissed.Version, Guid.NewGuid(), ct));
        Assert.Equal((OccFlightFeedFailure.Conflict, "flight_proposal_passed"), (restore.Failure, restore.Code));

        // The slot is free again.
        var fourth = await demo.Trigger(demo.Command(minutes: 20));
        Assert.Null(fourth.Failure);
        Assert.Equal(3, (await demo.Options()).Limits.Active);

        // The worker closes what OCC left open and writes nothing else on the flight.
        demo.Clock.Now += TimeSpan.FromSeconds(5);
        Assert.Equal(1, await demo.Tick());
        var rows = await demo.Rows(first.Id);
        Assert.Equal((ExternalFlightProposalStatus.Dismissed, demo.Now, null, "Expected", null),
            (rows.Departure.Status, rows.Departure.DecidedAt, rows.Departure.DecidedByAccountId, rows.Departure.ProviderStatus,
                rows.Departure.RunwayAt));
        Assert.Equal((ExternalFlightProposalStatus.Dismissed, "Approaching", null),
            (rows.Arrival.Status, rows.Arrival.ProviderStatus, rows.Arrival.RunwayAt));
        Assert.NotNull(rows.Arrival.DecidedByAccountId);
        Assert.Equal(0, await demo.Tick());
        // Still cancelled, at the instant OCC dismissed it: the worker's dismissal does not make it «finished».
        var after = await demo.Flight(first.Id);
        Assert.Equal(("Cancelled", cancelled.VanishAt), (after.State, after.VanishAt));
        var closed = (await demo.Feed(OccFlightFeedView.Dismissed)).Single(item => item.ProposalId == pair.Departure.ProposalId);
        Assert.Equal("flight_proposal_passed", (await demo.Run(services => occ(services).RestoreAsync(SeededOccAccount,
            closed.ProposalId, closed.Version, Guid.NewGuid(), ct))).Code);
        // The command of the superadministrator finds it closed too.
        Assert.Equal("demo_flight_closed", (await demo.End(first.Id, "Cancel")).Code);
        var expired = (await demo.Audits(first.Id)).Last();
        Assert.Equal(("governance.demo_flight.expired", AuditActorType.System, AuditSource.BackgroundJob),
            (expired.Action, expired.ActorType, expired.Source));
        Assert.Equal(new AuditFieldChangeData("demo_flight.state", "Active", "Cancelled"),
            Assert.Single(SafeAuditChanges.Parse(expired.MetadataJson)));
    }

    /// <summary>
    /// Every audit entry of a demo flight says what happened: the closed list of audit fields knows the
    /// <c>demo_flight.*</c> names, so the metadata is never empty.
    /// </summary>
    [Fact]
    public async Task DemoFlightAuditsCarryTheirMetadata()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var demo = await DemoFlightsAsync(database, ct);
        long superAdministrator;
        await using (var lookup = CreateContext(database.ConnectionString))
            superAdministrator = await lookup.Users.AsNoTracking().Where(user => user.PublicId == SuperAdministratorAccount)
                .Select(user => user.Id).SingleAsync(ct);
        static Dictionary<string, (string? Before, string? After)> Changes(AuditEntry entry)
        {
            Assert.NotNull(entry.MetadataJson);
            return SafeAuditChanges.Parse(entry.MetadataJson).ToDictionary(change => change.Field,
                change => (change.Before, change.After));
        }

        // Triggered with a stand, then cancelled before touchdown.
        var cancelled = (await demo.Trigger(demo.Command(minutes: 8, ground: 45, stand: demo.Stands["A03"], origin: "MIA",
            destination: "BOG"))).Value!;
        var created = Assert.Single(await demo.Audits(cancelled.Id));
        Assert.Equal(("governance.demo_flight.created", "integration.external_flight_proposals", AuditActorType.Account,
                (long?)superAdministrator, AuditSource.Api),
            (created.Action, created.EntityType, created.ActorType, created.ActorAccountId, created.Source));
        Assert.NotNull(created.StationId);
        Assert.Equal(new Dictionary<string, (string?, string?)>
        {
            ["demo_flight.arrival"] = (null, "ZZ9001"), ["demo_flight.departure"] = (null, "ZZ9002"),
            ["demo_flight.airline"] = (null, "Demo Airlines"), ["demo_flight.origin"] = (null, "MIA"),
            ["demo_flight.destination"] = (null, "BOG"), ["demo_flight.registration"] = (null, "HIDM01"),
            ["demo_flight.minutes_to_on_block"] = (null, "8"), ["demo_flight.ground_minutes"] = (null, "45"),
            ["demo_flight.stand"] = (null, "A03"), ["demo_flight.state"] = (null, "Active"),
        }, Changes(created));
        Assert.Null((await demo.End(cancelled.Id, "Cancel")).Failure);
        var cancellation = (await demo.Audits(cancelled.Id)).Last();
        Assert.Equal(("governance.demo_flight.cancelled", (long?)superAdministrator), (cancellation.Action, cancellation.ActorAccountId));
        Assert.Equal(new Dictionary<string, (string?, string?)> { ["demo_flight.state"] = ("Active", "Cancelled") },
            Changes(cancellation));

        // Triggered without a stand (no stand to record), then ended after touchdown while nobody had imported it.
        var ended = await demo.Triggered(minutes: 2);
        Assert.DoesNotContain("demo_flight.stand", Changes((await demo.Audits(ended.Id)).Single()).Keys);
        var imported = await demo.Triggered(minutes: 2);
        var turnaroundId = await demo.Imported(imported);
        demo.Clock.Now = ended.TouchdownAt.AddSeconds(10);
        Assert.Null((await demo.End(ended.Id, "Finish")).Failure);
        var finish = (await demo.Audits(ended.Id)).Last();
        Assert.Equal(("governance.demo_flight.finished", AuditActorType.Account, (long?)superAdministrator),
            (finish.Action, finish.ActorType, finish.ActorAccountId));
        Assert.Equal(new Dictionary<string, (string?, string?)> { ["demo_flight.state"] = ("Active", "Finished") }, Changes(finish));

        // «Terminar demo» on an imported flight brings the off-block forward: the worker ends it afterwards.
        Assert.Null((await demo.End(imported.Id, "Finish")).Failure);
        var finishing = (await demo.Audits(imported.Id)).Last();
        Assert.Equal("governance.demo_flight.finished", finishing.Action);
        Assert.Equal(new Dictionary<string, (string?, string?)> { ["demo_flight.state"] = ("Active", "Finishing") }, Changes(finishing));
        Assert.NotEqual(Guid.Empty, turnaroundId);

        // A flight nobody imported expires by itself: the system's entry.
        var expiring = await demo.Triggered(minutes: 2, ground: 20);
        demo.Clock.Now = expiring.VanishAt!.Value;
        Assert.True(await demo.Tick() >= 1);
        var expired = (await demo.Audits(expiring.Id)).Last();
        Assert.Equal(("governance.demo_flight.expired", AuditActorType.System, null, "Sistema", AuditSource.BackgroundJob),
            (expired.Action, expired.ActorType, expired.ActorAccountId, expired.ActorDisplay, expired.Source));
        Assert.Equal(new Dictionary<string, (string?, string?)> { ["demo_flight.state"] = ("Active", "Finished") }, Changes(expired));

        await using var check = CreateContext(database.ConnectionString);
        var entries = await check.AuditEntries.AsNoTracking().Where(item => item.Action.StartsWith("governance.demo_flight."))
            .ToArrayAsync(ct);
        Assert.Equal(["governance.demo_flight.cancelled", "governance.demo_flight.created", "governance.demo_flight.expired",
            "governance.demo_flight.finished"], entries.Select(item => item.Action).Distinct().Order());
        Assert.All(entries, entry => Assert.NotEmpty(SafeAuditChanges.Parse(entry.MetadataJson)));
    }

    /// <summary>
    /// A pair nobody imported is written once in its life: when it vanishes the worker dismisses both legs. Until then
    /// every tick leaves the rows as they are, and the superadministrator and OCC read the phase from the clock.
    /// </summary>
    [Fact]
    public async Task ADemoFlightNobodyImportedIsDismissedWhenItVanishesAndTheWorkerWritesNothingBefore()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var demo = await DemoFlightsAsync(database, ct);
        var flight = await demo.Triggered(minutes: 2, ground: 20);
        var created = await demo.Rows(flight.Id);
        var hints = await demo.PlanningHints();
        var takeoffAt = flight.TakeoffAt!.Value;
        var vanishAt = flight.VanishAt!.Value;
        Assert.Equal((flight.ScheduledOffBlockAt.AddMinutes(5), flight.ScheduledOffBlockAt.AddMinutes(15)), (takeoffAt, vanishAt));

        foreach (var (at, phase, arrival, departure) in new[]
                 {
                     (flight.TouchdownAt.AddSeconds(-1), "Approach", "Approaching", "Expected"),
                     (flight.TouchdownAt, "TaxiIn", "Arrived", "Expected"),
                     (flight.OnBlockAt, "Parked", "Arrived", "Expected"),
                     (flight.ScheduledOffBlockAt, "TaxiOut", "Arrived", "Expected"),
                     (takeoffAt, "Departed", "Arrived", "Departed"),
                     (vanishAt.AddSeconds(-1), "Departed", "Arrived", "Departed"),
                 })
        {
            demo.Clock.Now = at;
            Assert.Equal(0, await demo.Tick());
            var rows = await demo.Rows(flight.Id);
            Assert.Equal(created.Arrival.RowVersion, rows.Arrival.RowVersion);
            Assert.Equal(created.Departure.RowVersion, rows.Departure.RowVersion);
            var shown = await demo.Flight(flight.Id);
            Assert.Equal(("Active", phase), (shown.State, shown.Phase));
            var pair = await demo.Pair(flight);
            Assert.Equal((arrival, departure), (pair.Arrival.ProviderStatus, pair.Departure.ProviderStatus));
            Assert.Equal((arrival == "Arrived" ? flight.TouchdownAt : (DateTimeOffset?)null,
                    departure == "Departed" ? takeoffAt : (DateTimeOffset?)null), (pair.Arrival.RunwayAt, pair.Departure.RunwayAt));
        }
        Assert.Equal(hints, await demo.PlanningHints());

        // It vanishes: finished for the superadministrator even before the worker runs, then dismissed by the system.
        demo.Clock.Now = vanishAt;
        Assert.Equal(("Finished", "Gone"), ((await demo.Flight(flight.Id)).State, (await demo.Flight(flight.Id)).Phase));
        Assert.Equal(0, (await demo.Options()).Limits.Active);
        var occAccounts = await demo.OccAccounts();
        Assert.Equal(1, await demo.Tick());
        var closed = await demo.Rows(flight.Id);
        Assert.All(new[] { closed.Arrival, closed.Departure }, row =>
        {
            Assert.Equal((ExternalFlightProposalStatus.Dismissed, vanishAt, null), (row.Status, row.DecidedAt, row.DecidedByAccountId));
            // Nothing else: the runway times stay as the provider «left» them.
            Assert.Null(row.RunwayAt);
        });
        Assert.Equal(("Approaching", "Expected"), (closed.Arrival.ProviderStatus, closed.Departure.ProviderStatus));
        Assert.Equal(hints + occAccounts, await demo.PlanningHints());
        Assert.Empty(await demo.Feed());
        Assert.Equal(2, (await demo.Feed(OccFlightFeedView.Dismissed)).Count);
        Assert.Equal(0, await demo.Tick());
        var finished = await demo.Flight(flight.Id);
        Assert.Equal(("Finished", "Gone", false), (finished.State, finished.Phase, finished.Imported));
        Assert.Equal(["governance.demo_flight.created", "governance.demo_flight.expired"],
            (await demo.Audits(flight.Id)).Select(item => item.Action));
        // A day later the list no longer shows it.
        demo.Clock.Now = flight.AppearAt.AddHours(24).AddSeconds(1);
        Assert.Empty(await demo.Listed());
    }

    /// <summary>
    /// «Terminar demo» on a pair nobody imported brings the off-block forward as it does on an imported one, never
    /// before the aircraft parks, and closes the pair at once without an account. Neither leg gets a runway time, so the
    /// departure the superadministrator follows always comes after the arrival, and the worker never writes the closed
    /// pair again.
    /// </summary>
    [Fact]
    public async Task FinishingADemoFlightNobodyImportedLeavesAfterTheArrival()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var demo = await DemoFlightsAsync(database, ct);
        // Triggered together: when they are ended the first one still taxies in and the second one is parked.
        var taxiing = await demo.Triggered(minutes: 8);
        var parked = await demo.Triggered(minutes: 2);
        demo.Clock.Now = taxiing.TouchdownAt.AddSeconds(30);
        var finishedAt = demo.Now;
        Assert.Equal(("TaxiIn", "Parked"), ((await demo.Flight(taxiing.Id)).Phase, (await demo.Flight(parked.Id)).Phase));
        var hints = await demo.PlanningHints();
        var occAccounts = await demo.OccAccounts();

        foreach (var (flight, offBlockAt, phase) in new[]
                 {
                     (taxiing, taxiing.OnBlockAt, "TaxiIn"),
                     (parked, finishedAt, "TaxiOut"),
                 })
        {
            var ended = await demo.End(flight.Id, "Finish");
            Assert.True(ended.Failure is null, ended.Code);
            var shown = ended.Value!;
            Assert.Equal(("Finished", phase, offBlockAt, offBlockAt.AddMinutes(5), offBlockAt.AddMinutes(15)),
                (shown.State, shown.Phase, shown.OffBlockAt, shown.TakeoffAt, shown.VanishAt));
            Assert.True(shown.AppearAt <= shown.TouchdownAt && shown.TouchdownAt <= shown.OnBlockAt &&
                shown.OnBlockAt <= shown.OffBlockAt);
            // The departure says when the aircraft leaves its stand; neither leg says it used the runway.
            var rows = await demo.Rows(flight.Id);
            Assert.Equal(("GateClosed", offBlockAt, null, finishedAt),
                (rows.Departure.ProviderStatus, rows.Departure.RevisedAt, rows.Departure.RunwayAt, rows.Departure.LastSeenAt));
            Assert.Equal(("Approaching", null), (rows.Arrival.ProviderStatus, rows.Arrival.RunwayAt));
            Assert.All(new[] { rows.Arrival, rows.Departure }, row => Assert.Equal(
                (ExternalFlightProposalStatus.Dismissed, finishedAt, null), (row.Status, row.DecidedAt, row.DecidedByAccountId)));
        }
        // Both leave OCC's review and the station's limit at once, and OCC heard of each end.
        Assert.Empty(await demo.Feed());
        var dismissed = await demo.Feed(OccFlightFeedView.Dismissed);
        Assert.Equal(4, dismissed.Count);
        Assert.All(dismissed, item => Assert.Null(item.RunwayAt));
        Assert.Equal(0, (await demo.Options()).Limits.Active);
        Assert.Equal(hints + 2 * occAccounts, await demo.PlanningHints());

        // Each aircraft goes on in order until it vanishes, and the worker never writes the closed pairs.
        var closed = (Taxiing: await demo.Rows(taxiing.Id), Parked: await demo.Rows(parked.Id));
        foreach (var (at, first, second) in new[]
                 {
                     (taxiing.OnBlockAt, "TaxiOut", "TaxiOut"),
                     (finishedAt.AddMinutes(5), "TaxiOut", "Departed"),
                     (taxiing.OnBlockAt.AddMinutes(5), "Departed", "Departed"),
                     (finishedAt.AddMinutes(15), "Departed", "Gone"),
                     (taxiing.OnBlockAt.AddMinutes(15), "Gone", "Gone"),
                 })
        {
            demo.Clock.Now = at;
            Assert.Equal(0, await demo.Tick());
            var (one, two) = (await demo.Flight(taxiing.Id), await demo.Flight(parked.Id));
            Assert.Equal(("Finished", first, "Finished", second), (one.State, one.Phase, two.State, two.Phase));
            foreach (var (before, flight) in new[] { (closed.Taxiing, taxiing), (closed.Parked, parked) })
            {
                var rows = await demo.Rows(flight.Id);
                Assert.Equal(before.Arrival.RowVersion, rows.Arrival.RowVersion);
                Assert.Equal(before.Departure.RowVersion, rows.Departure.RowVersion);
            }
        }
        Assert.Equal(hints + 2 * occAccounts, await demo.PlanningHints());
    }

    /// <summary>Every refusal of the demo commands has its stable code, and none of them writes anything.</summary>
    [Fact]
    public async Task DemoFlightRefusalsHaveTheirCodes()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var demo = await DemoFlightsAsync(database, ct);
        static (MasterDataFailure?, string?) Refusal(MasterDataResult<DemoFlightData> result) => (result.Failure, result.Code);
        var store = (IServiceProvider services) => services.GetRequiredService<IDemoFlightStore>();
        var input = new CreateDemoFlightInput(SeededPujStation, demo.Airline, "MIA", "MIA", demo.AircraftType,
            DemoStandChoice.None, null, 8, 60);

        // Only the superadministrator: the store checks it by itself, whoever calls it.
        Assert.Null(await demo.Run(services => store(services).OptionsAsync(SeededOccAccount, null, ct)));
        Assert.Null(await demo.Run(services => store(services).ListAsync(SeededOccAccount, null, ct)));
        Assert.Equal((MasterDataFailure.Forbidden, "forbidden"),
            Refusal(await demo.Run(services => store(services).CreateAsync(SeededOccAccount, input, Guid.NewGuid(), ct))));
        Assert.Equal((MasterDataFailure.Forbidden, "forbidden"), Refusal(await demo.Run(services =>
            store(services).CancelAsync(SeededOccAccount, Guid.NewGuid(), DemoFlightIntent.Cancel, Guid.NewGuid(), ct))));
        Assert.Equal((MasterDataFailure.Forbidden, "forbidden"), Refusal(await demo.Trigger(demo.Command(), actor: SeededOccAccount)));

        // The key and the request's own rules, in the handler and again in the store.
        Assert.Equal((MasterDataFailure.Invalid, "idempotency_key_required"), Refusal(await demo.Trigger(demo.Command(), Guid.Empty)));
        Assert.Equal((MasterDataFailure.Invalid, "idempotency_key_required"),
            Refusal(await demo.Run(services => store(services).CreateAsync(SuperAdministratorAccount, input, Guid.Empty, ct))));
        foreach (var invalid in new[]
                 {
                     demo.Command(minutes: 1), demo.Command(minutes: 31), demo.Command(ground: 19), demo.Command(ground: 241),
                     demo.Command(origin: "MIAM"), demo.Command(destination: "M1A"),
                     demo.Command() with { StandChoice = "Random", StandId = demo.Stands["A03"] },
                     demo.Command() with { StandChoice = "Specific" }, demo.Command() with { StandId = demo.Stands["A03"] },
                 })
            Assert.Equal((MasterDataFailure.Invalid, "invalid_demo_flight"), Refusal(await demo.Trigger(invalid)));
        Assert.Equal((MasterDataFailure.Invalid, "invalid_demo_flight"), Refusal(await demo.Run(services =>
            store(services).CreateAsync(SuperAdministratorAccount, input with { MinutesToOnBlock = 45 }, Guid.NewGuid(), ct))));

        // The station, and the airports of the legs: never the station's own.
        Assert.Equal((MasterDataFailure.NotFound, "station_unavailable"),
            Refusal(await demo.Trigger(demo.Command() with { StationId = Guid.NewGuid() })));
        Assert.Equal((MasterDataFailure.Invalid, "invalid_demo_flight"), Refusal(await demo.Trigger(demo.Command(origin: "PUJ"))));
        Assert.Equal((MasterDataFailure.Invalid, "invalid_demo_flight"),
            Refusal(await demo.Trigger(demo.Command(destination: "puj"))));

        // The airline: active, with exactly one contract in force that day.
        Assert.Equal((MasterDataFailure.Conflict, "airline_inactive"),
            Refusal(await demo.Trigger(demo.Command() with { AirlineId = Guid.NewGuid() })));
        Guid charter;
        long seededAirline;
        long puj;
        await using (var setup = CreateContext(database.ConnectionString))
        {
            await CharterAirlineAsync(setup, "C9", "CQZ", "Charter Air", ct);
            charter = await setup.Airlines.AsNoTracking().Where(item => item.IcaoCode == "CQZ").Select(item => item.PublicId)
                .SingleAsync(ct);
            seededAirline = await setup.Airlines.AsNoTracking().Where(item => item.PublicId == demo.Airline)
                .Select(item => item.Id).SingleAsync(ct);
            puj = await setup.Stations.AsNoTracking().Where(item => item.PublicId == SeededPujStation).Select(item => item.Id)
                .SingleAsync(ct);
        }
        Assert.Equal((MasterDataFailure.Conflict, "contract_not_in_force"),
            Refusal(await demo.Trigger(demo.Command() with { AirlineId = charter })));
        async Task SetAirlineActive(bool active)
        {
            await using var setup = CreateContext(database.ConnectionString);
            await setup.Airlines.Where(item => item.Id == seededAirline)
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.IsActive, active), ct);
        }
        await SetAirlineActive(false);
        Assert.Equal((MasterDataFailure.Conflict, "airline_inactive"), Refusal(await demo.Trigger(demo.Command())));
        await SetAirlineActive(true);
        // A second contract covering the station that day: nobody could say which one the flight is operated under.
        long second;
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var contract = new Contract
            {
                PublicId = Guid.CreateVersion7(), AirlineId = seededAirline, ContractCode = "DEMO-SECOND-CONTRACT",
                Status = ContractStatus.Active, CreatedAt = demo.Now, UpdatedAt = demo.Now,
            };
            setup.Contracts.Add(contract);
            await setup.SaveChangesAsync(ct);
            var version = new ContractVersion
            {
                PublicId = Guid.CreateVersion7(), ContractId = contract.Id, VersionNumber = 1, Status = ContractVersionStatus.Approved,
                ValidFrom = demo.Day.AddDays(-30), CurrencyCode = "USD", ApprovedAt = demo.Now, CreatedAt = demo.Now,
                UpdatedAt = demo.Now,
            };
            setup.ContractVersions.Add(version);
            await setup.SaveChangesAsync(ct);
            setup.Set<ContractVersionStation>().Add(new ContractVersionStation { ContractVersionId = version.Id, StationId = puj });
            await setup.SaveChangesAsync(ct);
            second = contract.Id;
        }
        Assert.Equal((MasterDataFailure.Conflict, "contract_ambiguous"), Refusal(await demo.Trigger(demo.Command())));
        await using (var setup = CreateContext(database.ConnectionString))
            await setup.Contracts.Where(item => item.Id == second)
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.Status, ContractStatus.Suspended), ct);

        // The aircraft type, the airports and the stand.
        Assert.Equal((MasterDataFailure.Conflict, "aircraft_type_unavailable"),
            Refusal(await demo.Trigger(demo.Command() with { AircraftTypeId = Guid.NewGuid() })));
        Assert.Equal((MasterDataFailure.Conflict, "demo_origin_unknown"), Refusal(await demo.Trigger(demo.Command(origin: "XQA"))));
        Assert.Equal((MasterDataFailure.Conflict, "demo_origin_unknown"),
            Refusal(await demo.Trigger(demo.Command(destination: "XQA"))));
        await using (var setup = CreateContext(database.ConnectionString))
        {
            // Another airport already holds the ICAO code the catalogue has for Toronto.
            setup.Airports.Add(new Airport
            {
                PublicId = Guid.CreateVersion7(), IataCode = "XYZ", IcaoCode = "CYYZ", Name = "Synthetic Toronto", City = "Toronto",
                CountryCode = "CA", CreatedAt = demo.Now, UpdatedAt = demo.Now,
            });
            await setup.SaveChangesAsync(ct);
        }
        Assert.Equal((MasterDataFailure.Conflict, "demo_origin_unknown"), Refusal(await demo.Trigger(demo.Command(origin: "YYZ"))));
        Assert.Equal((MasterDataFailure.Conflict, "stand_unavailable"),
            Refusal(await demo.Trigger(demo.Command(stand: Guid.NewGuid()))));
        // A flight holds A01 while the demo aircraft would be there.
        var planned = await PlanManualFlightAsync(demo.Provider, demo.Airline, demo.Stands["A01"], demo.Day, "ZZ907",
            demo.Now.AddMinutes(5), demo.Now.AddMinutes(50), ct);
        Assert.True(planned.IsSuccess, planned.Code);
        var taken = await demo.Trigger(demo.Command(stand: demo.Stands["A01"]));
        Assert.Equal((MasterDataFailure.Conflict, "stand_unavailable"), Refusal(taken));
        Assert.Contains("stand_taken", taken.Reasons!);
        // None of the refusals wrote a row, an airport or an audit entry.
        await using (var check = CreateContext(database.ConnectionString))
        {
            Assert.False(await check.Set<ExternalFlightProposal>().AnyAsync(item => item.Provider == DemoProvider, ct));
            Assert.False(await check.AuditEntries.AnyAsync(item => item.Action.StartsWith("governance.demo_flight."), ct));
            Assert.Null((await check.Airports.AsNoTracking().SingleAsync(item => item.IataCode == "MIA", ct)).Latitude);
        }

        // A stand another demo aircraft is on its way to is taken too, even though nothing occupies it yet.
        var flight = await demo.Triggered(minutes: 8, stand: demo.Stands["A03"]);
        var clash = await demo.Trigger(demo.Command(stand: demo.Stands["A03"]));
        Assert.Equal((MasterDataFailure.Conflict, "stand_unavailable"), Refusal(clash));
        Assert.Contains("stand_taken", clash.Reasons!);

        // Ending a flight: it must exist, the intent must be a known one and fit the phase the flight is in.
        Assert.Equal((MasterDataFailure.NotFound, "not_found"), Refusal(await demo.End(Guid.NewGuid(), "Cancel")));
        Assert.Equal((MasterDataFailure.Invalid, "invalid_demo_flight"), Refusal(await demo.End(flight.Id, "cancel")));
        Assert.Equal((MasterDataFailure.Invalid, "invalid_demo_flight"), Refusal(await demo.End(Guid.Empty, "Cancel")));
        Assert.Equal((MasterDataFailure.Invalid, "idempotency_key_required"), Refusal(await demo.End(flight.Id, "Cancel", Guid.Empty)));
        Assert.Equal((MasterDataFailure.Forbidden, "forbidden"), Refusal(await demo.End(flight.Id, "Cancel", actor: SeededOccAccount)));
        // «Terminar demo» before the wheels touch the runway, «Cancelar vuelo» after: the screen read an earlier phase.
        Assert.Equal((MasterDataFailure.Conflict, "version_conflict"), Refusal(await demo.End(flight.Id, "Finish")));
        demo.Clock.Now = flight.TouchdownAt;
        Assert.Equal((MasterDataFailure.Conflict, "version_conflict"), Refusal(await demo.End(flight.Id, "Cancel")));
        var rows = await demo.Rows(flight.Id);
        Assert.Equal((ExternalFlightProposalStatus.Proposed, "Approaching"), (rows.Arrival.Status, rows.Arrival.ProviderStatus));

        // «Terminar demo» while nobody imported it: the pair leaves OCC's review at once, and the aircraft, which still
        // taxies in, parks before it leaves.
        var key = Guid.NewGuid();
        var finished = await demo.End(flight.Id, "Finish", key);
        Assert.Null(finished.Failure);
        Assert.Equal(("Finished", "TaxiIn", flight.OnBlockAt, flight.OnBlockAt.AddMinutes(5), flight.OnBlockAt.AddMinutes(15)),
            (finished.Value!.State, finished.Value.Phase, finished.Value.OffBlockAt, finished.Value.TakeoffAt,
                finished.Value.VanishAt));
        rows = await demo.Rows(flight.Id);
        Assert.Equal(("GateClosed", flight.OnBlockAt, null),
            (rows.Departure.ProviderStatus, rows.Departure.RevisedAt, rows.Departure.RunwayAt));
        Assert.All(new[] { rows.Arrival, rows.Departure }, row =>
            Assert.Equal((ExternalFlightProposalStatus.Dismissed, demo.Now, null), (row.Status, row.DecidedAt, row.DecidedByAccountId)));
        Assert.True((await demo.End(flight.Id, "Finish", key)).Replayed);
        Assert.Equal((MasterDataFailure.Conflict, "idempotency_conflict"), Refusal(await demo.End(flight.Id, "Cancel", key)));
        Assert.Equal((MasterDataFailure.Conflict, "demo_flight_closed"), Refusal(await demo.End(flight.Id, "Finish")));
        Assert.Equal(0, await demo.Tick());
    }

    /// <summary>
    /// What the form «Disparar vuelo demo» offers: the airlines with exactly one contract in force today, the airports
    /// with coordinates (or the catalogue's), the active aircraft types, the active stands of active terminals with
    /// whether they are free for the visit, the limits and the warnings that never block.
    /// </summary>
    [Fact]
    public async Task DemoOptionsListAirlinesAirportsFreeStandsAndWarnings()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var demo = await DemoFlightsAsync(database, ct);
        await AddPujStandAsync(database.ConnectionString, "A9", "A", ct);
        await AddPujStandAsync(database.ConnectionString, "A10", "A", ct);
        Guid inactiveStation;
        await using (var setup = CreateContext(database.ConnectionString))
        {
            await CharterAirlineAsync(setup, "C9", "CQZ", "Charter Air", ct);
            var puj = await setup.Stations.SingleAsync(item => item.PublicId == SeededPujStation, ct);
            var terminalA = await setup.Terminals.SingleAsync(item => item.StationId == puj.Id && item.Code == "A", ct);
            // An inactive stand, and a stand of an inactive terminal: neither is offered.
            setup.Stands.Add(new Stand
            {
                PublicId = Guid.CreateVersion7(), StationId = puj.Id, TerminalId = terminalA.Id, Code = "A20", StandType = "Contact",
                IsActive = false, CreatedAt = demo.Now, UpdatedAt = demo.Now,
            });
            var closed = new Terminal
            {
                PublicId = Guid.CreateVersion7(), StationId = puj.Id, Code = "Z", Name = "Terminal cerrada", IsActive = false,
                CreatedAt = demo.Now, UpdatedAt = demo.Now,
            };
            setup.Terminals.Add(closed);
            await setup.SaveChangesAsync(ct);
            setup.Stands.Add(new Stand
            {
                PublicId = Guid.CreateVersion7(), StationId = puj.Id, TerminalId = closed.Id, Code = "Z1", StandType = "Remote",
                IsActive = true, CreatedAt = demo.Now, UpdatedAt = demo.Now,
            });
            // An inactive aircraft type; an airport with coordinates outside the catalogue and one without them.
            setup.AircraftTypes.Add(new AircraftType
            {
                PublicId = Guid.CreateVersion7(), IcaoCode = "B752", Manufacturer = "Boeing", Model = "757-200", IsActive = false,
                CreatedAt = demo.Now, UpdatedAt = demo.Now,
            });
            setup.Airports.AddRange(
                new Airport
                {
                    PublicId = Guid.CreateVersion7(), IataCode = "XQA", IcaoCode = "XQAA", Name = "Synthetic Located", City = "Located",
                    CountryCode = "DO", Latitude = 18.5m, Longitude = -69.5m, CreatedAt = demo.Now, UpdatedAt = demo.Now,
                },
                new Airport
                {
                    PublicId = Guid.CreateVersion7(), IataCode = "XQB", IcaoCode = "XQBB", Name = "Synthetic Unlocated", City = "Nowhere",
                    CountryCode = "DO", CreatedAt = demo.Now, UpdatedAt = demo.Now,
                },
                // It holds the ICAO code the catalogue has for Toronto: that one cannot be inserted.
                new Airport
                {
                    PublicId = Guid.CreateVersion7(), IataCode = "XYZ", IcaoCode = "CYYZ", Name = "Synthetic Toronto", City = "Toronto",
                    CountryCode = "CA", CreatedAt = demo.Now, UpdatedAt = demo.Now,
                });
            var miami = await setup.Airports.SingleAsync(item => item.IataCode == "MIA", ct);
            var station = new Station
            {
                PublicId = Guid.CreateVersion7(), AirportId = miami.Id, Code = "MIA", Name = "Miami", IanaTimeZone = "America/New_York",
                IsActive = false, CreatedAt = demo.Now, UpdatedAt = demo.Now,
            };
            setup.Stations.Add(station);
            await setup.SaveChangesAsync(ct);
            inactiveStation = station.PublicId;
        }
        // A flight on A01 during the visit the form proposes by default, and a demo aircraft on its way to A03.
        var planned = await PlanManualFlightAsync(demo.Provider, demo.Airline, demo.Stands["A01"], demo.Day, "ZZ909",
            demo.Now.AddMinutes(20), demo.Now.AddMinutes(90), ct);
        Assert.True(planned.IsSuccess, planned.Code);
        await demo.Triggered(minutes: 8, stand: demo.Stands["A03"]);

        var options = await demo.Options();
        Assert.True(options.Enabled);
        Assert.Equal((demo.Now, (Guid?)SeededPujStation, (DateOnly?)demo.Day), (options.ServerTime, options.StationId, options.OperationDate));
        Assert.Equal(new DemoStationOptionData(SeededPujStation, "PUJ", "AVIAM PUJ Development"),
            Assert.Single(options.Stations));
        // Only the airline with exactly one contract in force: the carrier without one is a charter, not a demo.
        Assert.Equal(new DemoAirlineOptionData(demo.Airline, "Demo Airlines", "ZZ", "DZZ"), Assert.Single(options.Airlines));
        // The seed's Miami (the catalogue will complete it), the catalogue's other airports and the located one; never
        // the station's own airport, an airport without coordinates or the one whose ICAO code is taken.
        Assert.Equal(["BOG", "JFK", "MAD", "MIA", "SDQ", "XQA"], options.Airports.Select(item => item.IataCode));
        Assert.Equal(new DemoAirportOptionData("MIA", "KMIA", "Miami Development Airport", "Miami", "US"),
            options.Airports.Single(item => item.IataCode == "MIA"));
        Assert.Equal(new DemoAirportOptionData("MAD", "LEMD", "Adolfo Suárez Madrid-Barajas Airport", "Madrid", "ES"),
            options.Airports.Single(item => item.IataCode == "MAD"));
        Assert.Equal(["A320", "A333"], options.AircraftTypes.Select(item => item.IcaoCode));
        Assert.Equal(new DemoAircraftTypeOptionData(demo.AircraftType, "A320", "Airbus", "A320 Development", "Narrowbody"),
            options.AircraftTypes[0]);
        // By terminal and then as people count them: A9 before A10.
        Assert.Equal([("A", "A01", false), ("A", "A02", true), ("A", "A03", false), ("A", "A9", true), ("A", "A10", true),
                ("B", "B01", true), ("B", "B02", true), ("B", "B03", true)],
            options.Stands.Select(item => (item.TerminalCode, item.Code, item.Free)));
        Assert.Equal(demo.Stands["A03"], options.Stands.Single(item => item.Code == "A03").StandId);
        Assert.Equal(new DemoFlightLimitsData(2, 30, 8, 20, 240, 60, 3, 1), options.Limits);
        Assert.Empty(options.Warnings);

        // A station that is not active (or unknown) falls back to Punta Cana.
        Assert.Equal(SeededPujStation, (await demo.Options(inactiveStation)).StationId);
        Assert.Equal(SeededPujStation, (await demo.Options(Guid.NewGuid())).StationId);
        Assert.Equal(SeededPujStation, (await demo.Options(SeededPujStation)).StationId);
        var listed = await demo.Run(services => services.GetRequiredService<DemoFlightHandler>()
            .ListAsync(SuperAdministratorAccount, null, ct));
        Assert.Equal((true, demo.Now, (Guid?)SeededPujStation, 1), (listed!.Enabled, listed.ServerTime, listed.StationId, listed.Flights.Count));

        // Within half an hour of local midnight the arrival may fall on tomorrow's operation date.
        demo.Clock.Now = LocalAt(demo.Day, 23, 29);
        Assert.Empty((await demo.Options()).Warnings);
        demo.Clock.Now = LocalAt(demo.Day, 23, 30);
        var late = await demo.Options();
        Assert.Equal(["crosses_local_midnight"], late.Warnings.Select(item => item.Code));
        Assert.All(late.Warnings, item => Assert.Empty(item.Reasons));
        Assert.Equal(demo.Day, late.OperationDate);
        // And the flight triggered then belongs to tomorrow: the review of that day lists it.
        var midnight = await demo.Triggered(minutes: 30);
        var rows = await demo.Rows(midnight.Id);
        Assert.Equal((demo.Day.AddDays(1), demo.Day.AddDays(1)), (rows.Arrival.OperationDate, rows.Departure.OperationDate));

        // With no OCC account that has the station in scope nobody would see the flight.
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var puj = await setup.Stations.AsNoTracking().Where(item => item.PublicId == SeededPujStation).Select(item => item.Id)
                .SingleAsync(ct);
            await setup.AccountStationScopes.Where(item => item.StationId == puj && item.RevokedAt == null)
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.RevokedAt, demo.Now), ct);
        }
        Assert.Equal(["no_occ_accounts", "crosses_local_midnight"], (await demo.Options()).Warnings.Select(item => item.Code));
    }

    /// <summary>
    /// OCC's screens tell a demo flight from any other: the review, the planning snapshot and the positions board mark
    /// it (true or nothing, never false), its legs only pair with each other and never with the paid feed's, and while
    /// nobody imported it the review reads its status from the clock.
    /// </summary>
    [Fact]
    public async Task TheFeedPlanningAndPositionsMarkDemoFlightsAndDeriveTheirStatusFromTheClock()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var demo = await DemoFlightsAsync(database, ct);
        var occ = (IServiceProvider services) => services.GetRequiredService<IOccFlightFeedStore>();

        // The paid feed reported a pair of the same airline for the same day (a synthetic answer).
        var origin = new FeedAirport("XQA", "XQAA", "Synthetic Origin", "Origin City", "DO", "America/Santo_Domingo", 18.5m, -69.5m);
        await demo.Run(async services =>
        {
            var sync = services.GetRequiredService<IFlightFeedSyncStore>();
            var station = Assert.Single(await sync.ListStationsAsync(demo.Now, ct), item => item.StationPublicId == SeededPujStation);
            FeedFlight Leg(FlightDirection direction, string number, DateTimeOffset at) =>
                new(direction, number, new FeedAirline("Demo Airlines", "ZZ", null), origin, at, null, null, "Expected", null,
                    "Airbus A320", "A", "3", false, "IsOperator");
            return await sync.RecordAsync(new FlightFeedCall("AeroDataBox", station, demo.Day.ToDateTime(new TimeOnly(6, 0)),
                    demo.Day.ToDateTime(new TimeOnly(18, 0)), ProviderCallTrigger.Manual, null, demo.Now),
                new AirportFeedResponse(ProviderCallOutcome.Succeeded, 2, 200, null,
                [
                    Leg(FlightDirection.Arrival, "ZZ161", demo.Now.AddMinutes(12)),
                    Leg(FlightDirection.Departure, "ZZ162", demo.Now.AddMinutes(80)),
                ]), ct);
        });
        var first = await demo.Triggered(minutes: 8, stand: demo.Stands["A03"]);
        var second = await demo.Triggered(minutes: 10);

        // The review marks the demo legs and only them; each arrival suggests its own departure.
        var feed = await demo.Feed();
        Assert.Equal(6, feed.Count);
        Assert.All(feed, item => Assert.Equal(item.FlightNumber.StartsWith("ZZ90", StringComparison.Ordinal) ? true : null, item.IsDemo));
        var paid = Proposal(feed, "ZZ161");
        var firstPair = await demo.Pair(first);
        var secondPair = await demo.Pair(second);
        Assert.Equal("ZZ162", paid.Departure.FlightNumber);
        Assert.Equal((firstPair.Departure.ProposalId, secondPair.Departure.ProposalId),
            (firstPair.Arrival.SuggestedDepartureId, secondPair.Arrival.SuggestedDepartureId));

        // A demo leg never pairs with the paid feed's, nor with the leg of another demo flight.
        foreach (var (arrival, departure) in new[]
                 {
                     (firstPair.Arrival, paid.Departure), (paid.Arrival, firstPair.Departure),
                     (firstPair.Arrival, secondPair.Departure), (secondPair.Arrival, firstPair.Departure),
                 })
        {
            var refused = await demo.Import(new DemoPair(arrival, departure));
            Assert.Equal((OccFlightFeedFailure.Conflict, "flight_proposals_not_pairable"), (refused.Failure, refused.Code));
        }

        // While nobody imported it the status comes from the clock, with the versions OCC read.
        demo.Clock.Now = first.TouchdownAt;
        Assert.Equal(0, await demo.Tick());
        var landed = await demo.Pair(first);
        Assert.Equal(("Arrived", first.TouchdownAt, firstPair.Arrival.Version, "Proposed"),
            (landed.Arrival.ProviderStatus, landed.Arrival.RunwayAt, landed.Arrival.Version, landed.Arrival.Status));
        Assert.Equal(("Approaching", null), ((await demo.Pair(second)).Arrival.ProviderStatus, (await demo.Pair(second)).Arrival.RunwayAt));
        // The paid feed's legs are shown as the provider reported them.
        Assert.Equal(("Expected", null, null), (Proposal(await demo.Feed(), "ZZ161").Arrival.ProviderStatus,
            Proposal(await demo.Feed(), "ZZ161").Arrival.RunwayAt, Proposal(await demo.Feed(), "ZZ161").Arrival.IsDemo));

        // OCC imports the demo flight on A03, the provider's on A02 and types a third flight by hand on A01.
        var demoTurnaround = await demo.Imported(first, demo.Stands["A03"]);
        var paidImport = await demo.Run(services => occ(services).ImportAsync(SeededOccAccount,
            new OccFlightImportInput(paid.Arrival.ProposalId, paid.Departure.ProposalId, demo.AircraftType, demo.Stands["A02"], false,
                paid.Arrival.Version, paid.Departure.Version), Guid.NewGuid(), ct));
        Assert.Null(paidImport.Failure);
        var manual = await PlanManualFlightAsync(demo.Provider, demo.Airline, demo.Stands["A01"], demo.Day, "ZZ911",
            demo.Now.AddMinutes(30), demo.Now.AddMinutes(120), ct);
        Assert.True(manual.IsSuccess, manual.Code);

        var snapshot = await demo.Run(services => services.GetRequiredService<IOccPlanningReadStore>()
            .GetSnapshotAsync(SeededPujStation, demo.Day, ct));
        Assert.Equal(3, snapshot!.Turnarounds.Count);
        Assert.Equal(new Dictionary<Guid, bool?>
        {
            [demoTurnaround] = true, [paidImport.TurnaroundId!.Value] = null, [manual.TurnaroundId!.Value] = null,
        }, snapshot.Turnarounds.ToDictionary(item => item.Id, item => item.IsDemo));

        var board = (await demo.Run(services => services.GetRequiredService<IOccPositionStore>()
            .ReadAsync(SeededOccAccount, SeededPujStation, demo.Day, ct))).Board!;
        Assert.Equal(new Dictionary<string, (Guid, bool?)>
        {
            ["A01"] = (manual.TurnaroundId.Value, null), ["A02"] = (paidImport.TurnaroundId.Value, null),
            ["A03"] = (demoTurnaround, true),
        }, board.Positions.Where(item => item.Turnarounds.Count > 0)
            .ToDictionary(item => item.Code, item => (item.Turnarounds.Single().TurnaroundId, item.Turnarounds.Single().IsDemo)));
        Assert.Empty(board.Unassigned);

        // Released from its stand, the demo flight is still marked among the flights without one.
        var released = await demo.Run(services => services.GetRequiredService<IOccPositionStore>()
            .ReleaseAsync(SeededOccAccount, demoTurnaround, OccPositionCommand.None, ct));
        Assert.Null(released.Failure);
        Assert.Equal((demoTurnaround, true), (Assert.Single(released.Board!.Unassigned).TurnaroundId,
            Assert.Single(released.Board.Unassigned).IsDemo));
        Assert.Null((await demo.Flight(first.Id)).StandCode);

        // The other demo flight leaves without anybody importing it: the review shows its departure at take-off.
        demo.Clock.Now = second.TakeoffAt!.Value;
        var departed = await demo.Pair(second);
        Assert.Equal(("Arrived", second.TouchdownAt, "Departed", second.TakeoffAt),
            (departed.Arrival.ProviderStatus, departed.Arrival.RunwayAt, departed.Departure.ProviderStatus, departed.Departure.RunwayAt));
        Assert.Equal((secondPair.Arrival.Version, secondPair.Departure.Version), (departed.Arrival.Version, departed.Departure.Version));
    }

    /// <summary>Runs a command of someone else once, right before the save that holds the rows it is told to watch.</summary>
    private sealed class RaceBeforeSaving(Func<DbContext, bool> watched, Func<Task> race) : SaveChangesInterceptor
    {
        public int Runs { get; private set; }

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData,
            InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (Runs == 0 && watched(eventData.Context!))
            {
                Runs++;
                await race();
            }
            return await base.SavingChangesAsync(eventData, result, cancellationToken);
        }
    }

    /// <summary>
    /// OCC imports a pair in the very moment the worker dismisses it for having vanished: the worker's write finds a
    /// newer row version, leaves that flight for the next tick and goes on with the others. The next tick reads the
    /// flight as OCC left it and reports its landing.
    /// </summary>
    [Fact]
    public async Task TheWorkerLeavesADemoFlightOccDecidedInTheSameMomentForItsNextTick()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var demo = await DemoFlightsAsync(database, ct);
        var raced = await demo.Triggered(minutes: 2, ground: 20);
        var other = await demo.Triggered(minutes: 2, ground: 20);
        // Both vanish at the same instant; OCC's dialog still shows the first one.
        demo.Clock.Now = raced.VanishAt!.Value;
        Assert.Equal(raced.VanishAt, other.VanishAt);
        var pair = await demo.Pair(raced);
        var hints = await demo.PlanningHints();
        var occAccounts = await demo.OccAccounts();

        OccFlightImportResult? imported = null;
        var race = new RaceBeforeSaving(
            context => context.ChangeTracker.Entries<ExternalFlightProposal>().Any(entry => entry.Entity.PublicId == raced.Id),
            async () => imported = await demo.Import(pair));
        await using (var racing = new ElevantDbContext(new DbContextOptionsBuilder<ElevantDbContext>()
                         .UseSqlServer(database.ConnectionString, ElevantSqlServerOptions.Configure).AddInterceptors(race).Options))
        {
            var worker = new EfDemoFlightStore(racing, new EfActorContextResolver(racing, demo.Clock), demo.Clock);
            // Only the other flight changed in this tick.
            Assert.Equal(1, await worker.AdvanceAsync(demo.Now, ct));
        }
        Assert.Equal(1, race.Runs);
        Assert.Null(imported!.Failure);

        // OCC's import stands: the pair is confirmed, never dismissed, and nothing says it expired.
        var rows = await demo.Rows(raced.Id);
        Assert.All(new[] { rows.Arrival, rows.Departure }, row =>
        {
            Assert.Equal(ExternalFlightProposalStatus.Confirmed, row.Status);
            Assert.NotNull(row.DecidedByAccountId);
            Assert.Null(row.RunwayAt);
        });
        Assert.Equal("governance.demo_flight.created", Assert.Single(await demo.Audits(raced.Id)).Action);
        // The other flight was dismissed in the same tick, with its own announcement (and the import's).
        var closed = await demo.Rows(other.Id);
        Assert.All(new[] { closed.Arrival, closed.Departure }, row =>
            Assert.Equal((ExternalFlightProposalStatus.Dismissed, null), (row.Status, row.DecidedByAccountId)));
        Assert.Equal(hints + 2 * occAccounts, await demo.PlanningHints());

        // Imported, the aircraft is back at its stand waiting for its agent; the next tick reports its landing.
        var waiting = await demo.Flight(raced.Id);
        Assert.Equal(("Active", "Parked", true, imported.TurnaroundId), (waiting.State, waiting.Phase, waiting.Imported, waiting.TurnaroundId));
        Assert.Equal(1, await demo.Tick());
        Assert.Equal(("Arrived", raced.TouchdownAt), ((await demo.Rows(raced.Id)).Arrival.ProviderStatus,
            (await demo.Rows(raced.Id)).Arrival.RunwayAt));
        Assert.Equal(raced.TouchdownAt, (await demo.Turnaround(imported.TurnaroundId!.Value)).Arrival.ActualAt);
        Assert.Equal(0, await demo.Tick());

        // A leg whose sibling does not exist (nothing ever deletes one) stops no tick and no read: it is no flight.
        var orphan = await demo.Triggered(minutes: 2, ground: 20);
        await using (var setup = CreateContext(database.ConnectionString))
            Assert.Equal(1, await setup.Set<ExternalFlightProposal>()
                .Where(item => item.ExternalReference == $"{orphan.Id:N}|Departure").ExecuteDeleteAsync(ct));
        demo.Clock.Now = orphan.VanishAt!.Value;
        Assert.Equal(0, await demo.Tick());
        Assert.DoesNotContain(await demo.Listed(), item => item.Id == orphan.Id);
        Assert.Equal(1, (await demo.Options()).Limits.Active);
        var left = Assert.Single(await demo.Feed(), item => item.FlightNumber == orphan.ArrivalFlightNumber);
        Assert.Equal(("Approaching", "Proposed", true), (left.ProviderStatus, left.Status, left.IsDemo));
    }
}
