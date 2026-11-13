using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;
using Elevant.Application.Integration.DemoFlights;
using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

/// <summary>
/// ADR-0041 through the real HTTP pipeline: the superadministrator's demo flights under governance. Only the
/// superadministrator reaches them; where <c>DemoFlights:Mode</c> is off the commands answer
/// <c>demo_flights_unavailable</c> and the reads <c>enabled: false</c>; every command takes its Idempotency-Key and every
/// refusal carries its code and a Spanish title. The OCC reads mark a demo flight with <c>isDemo</c> only when true.
/// </summary>
public sealed class DemoFlightEndpointsTests(ElevantApiFactory factory) : IClassFixture<ElevantApiFactory>
{
    private static readonly DateTimeOffset Now = new(2026, 11, 12, 14, 0, 0, TimeSpan.Zero);
    private static readonly DateOnly Today = new(2026, 11, 12);
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000041");
    private static readonly Guid StationId = Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly Guid AirlineId = Guid.Parse("21000000-0000-7000-8000-000000000001");
    private static readonly Guid AircraftTypeId = Guid.Parse("22000000-0000-7000-8000-000000000001");
    private static readonly Guid StandId = Guid.Parse("23000000-0000-7000-8000-000000000001");
    private static readonly Guid DemoFlightId = Guid.Parse("0193a6f2-5c1e-7d3a-9b44-1f2e3d4c5b6a");

    private const string ForbiddenTitle = "Solo el superadministrador dispara vuelos demo.";
    private const string UnavailableTitle = "Los vuelos demo no están disponibles en este entorno.";
    private const string NotFoundTitle = "La estación o el vuelo demo ya no existe.";
    private const string InvalidTitle = "Los datos del vuelo demo no son válidos.";
    private const string ConflictTitle = "El vuelo demo no se puede crear o cambió. Vuelva a cargar los datos.";

    private static readonly string[] FlightNames = ["id", "stationId", "stationCode", "airlineId", "airlineName",
        "arrivalFlightNumber", "departureFlightNumber", "aircraftRegistration", "aircraftModel", "originIata",
        "destinationIata", "suggestedStandCode", "state", "phase", "appearAt", "touchdownAt", "onBlockAt",
        "scheduledOffBlockAt", "offBlockAt", "takeoffAt", "vanishAt", "imported", "turnaroundId", "operationCode",
        "standCode", "operationStatus"];

    private static readonly ActorContext Superadministrator = new(AccountId, "superadmin@dev.elevant.test", "Sam Admin",
        [new ActorRole(Guid.Parse("41000000-0000-7000-8000-000000000009"), "SUPERADMIN", "Superadmin", PortalKind.BackOffice,
            "superadmin")],
        [new ActorMembership(Guid.Parse("42000000-0000-7000-8000-000000000001"),
            Guid.Parse("10000000-0000-7000-8000-000000000001"), "AVIAM", "AVIAM Development", OrganizationType.AviamOperator,
            MembershipKind.InternalStaff)],
        []);

    private static readonly ActorContext OccAdministrator = Superadministrator with
    {
        Email = "admin.occ@dev.elevant.test",
        Roles = [new ActorRole(Guid.Parse("41000000-0000-7000-8000-000000000001"), "ADMIN_OCC", "Admin OCC",
            PortalKind.BackOffice, "admin_occ")],
        StationScopes = [new ActorStationScope(StationId, "PUJ")],
    };

    private static readonly DemoFlightData Flight = new(DemoFlightId, StationId, "PUJ", AirlineId, "Demo Airlines", "ZZ9001",
        "ZZ9002", "HIDM01", "Airbus A320", "MIA", "MIA", "A01", "Active", "Approach", Now, Now.AddSeconds(264),
        Now.AddMinutes(8), Now.AddMinutes(68), null, null, null, false, null, null, null, null);

    private static readonly DemoFlightOptionsData Options = new(true, Now, [new(StationId, "PUJ", "Punta Cana")], StationId,
        Today, [new(AirlineId, "Demo Airlines", "ZZ", "DZZ")],
        [new("MIA", "KMIA", "Miami International Airport", "Miami", "US")],
        [new(AircraftTypeId, "A320", "Airbus", "A320", "Narrowbody")], [new(StandId, "A01", "A", true)],
        new DemoFlightLimitsData(2, 30, 8, 20, 240, 60, 3, 1), [new("crosses_local_midnight", [])]);

    private static object Create(string standChoice = "None", Guid? standId = null, int minutes = 8, int ground = 60,
        string origin = " mia ") => new
    {
        stationId = StationId, airlineId = AirlineId, originIata = origin, destinationIata = (string?)null,
        aircraftTypeId = AircraftTypeId, standChoice, standId, minutesToOnBlock = minutes, groundMinutes = ground,
    };

    [Fact]
    public async Task DemoFlightRoutesNeedAuthentication()
    {
        var store = new DemoStore();
        await using var application = Application(store, Superadministrator);
        using var anonymous = application.CreateClient();
        var ct = TestContext.Current.CancellationToken;

        using var options = await anonymous.GetAsync("/api/v1/governance/demo-flights/options", ct);
        using var list = await anonymous.GetAsync("/api/v1/governance/demo-flights", ct);
        using var create = await SendAsync(anonymous, "governance/demo-flights", Guid.NewGuid(), Create());
        using var cancel = await SendAsync(anonymous, $"governance/demo-flights/{DemoFlightId}/cancel", Guid.NewGuid(),
            new { intent = "Cancel" });

        Assert.All(new[] { options, list, create, cancel }, response =>
        {
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
            Assert.Contains(response.Headers.WwwAuthenticate, header => header.Scheme == "Bearer");
        });
        Assert.Empty(store.Calls);
    }

    [Fact]
    public async Task OnlyTheSuperadministratorReachesDemoFlights()
    {
        var store = new DemoStore();
        await using var application = Application(store, OccAdministrator);
        using var client = Authorized(application);
        var ct = TestContext.Current.CancellationToken;

        using var options = await client.GetAsync($"/api/v1/governance/demo-flights/options?stationId={StationId}", ct);
        using var list = await client.GetAsync($"/api/v1/governance/demo-flights?stationId={StationId}", ct);
        using var create = await SendAsync(client, "governance/demo-flights", Guid.NewGuid(), Create());
        using var cancel = await SendAsync(client, $"governance/demo-flights/{DemoFlightId}/cancel", Guid.NewGuid(),
            new { intent = "Cancel" });

        foreach (var response in new[] { options, list, create, cancel })
        {
            Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
            var problem = await ProblemAsync(response);
            Assert.Equal(("forbidden", ForbiddenTitle), (problem.Code, problem.Title));
            Assert.Contains("no-store", response.Headers.CacheControl?.ToString(), StringComparison.Ordinal);
        }
        Assert.Empty(store.Calls);
    }

    [Fact]
    public async Task ADisabledEnvironmentAnswersUnavailableAndOptionsSayDisabled()
    {
        var store = new DemoStore();
        // Testing sets no DemoFlights:Mode: the default is Disabled.
        await using var application = Application(store, Superadministrator, mode: null);
        using var client = Authorized(application);
        var ct = TestContext.Current.CancellationToken;
        Assert.False(application.Services.GetRequiredService<DemoFlightAvailability>().Enabled);

        using var options = await client.GetAsync($"/api/v1/governance/demo-flights/options?stationId={StationId}", ct);
        Assert.Equal(HttpStatusCode.OK, options.StatusCode);
        using (var answer = await JsonAsync(options))
        {
            var root = answer.RootElement;
            Assert.Equal(["enabled", "serverTime", "stations", "stationId", "operationDate", "airlines", "airports",
                "aircraftTypes", "stands", "limits", "warnings"], Names(root));
            Assert.False(root.GetProperty("enabled").GetBoolean());
            Assert.Equal(JsonValueKind.Null, root.GetProperty("stationId").ValueKind);
            Assert.Equal(JsonValueKind.Null, root.GetProperty("operationDate").ValueKind);
            foreach (var empty in new[] { "stations", "airlines", "airports", "aircraftTypes", "stands", "warnings" })
                Assert.Equal(0, root.GetProperty(empty).GetArrayLength());
            // The form still knows its ranges: 2 to 30 minutes to the stand, 20 to 240 on the ground.
            Assert.Equal("""{"minMinutesToOnBlock":2,"maxMinutesToOnBlock":30,"defaultMinutesToOnBlock":8,"minGroundMinutes":20,"maxGroundMinutes":240,"defaultGroundMinutes":60,"maxActive":3,"active":0}""",
                root.GetProperty("limits").GetRawText());
        }

        using var list = await client.GetAsync("/api/v1/governance/demo-flights", ct);
        Assert.Equal(HttpStatusCode.OK, list.StatusCode);
        using (var answer = await JsonAsync(list))
        {
            Assert.Equal(["enabled", "serverTime", "stationId", "flights"], Names(answer.RootElement));
            Assert.False(answer.RootElement.GetProperty("enabled").GetBoolean());
            Assert.Equal(0, answer.RootElement.GetProperty("flights").GetArrayLength());
        }

        // Unavailable comes before the request is even read: an invalid body or a missing stand answers the same.
        using var create = await SendAsync(client, "governance/demo-flights", Guid.NewGuid(), Create(minutes: 99));
        using var cancel = await SendAsync(client, $"governance/demo-flights/{DemoFlightId}/cancel", Guid.NewGuid(),
            new { intent = "Finish" });
        foreach (var refused in new[] { create, cancel })
        {
            Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
            var problem = await ProblemAsync(refused);
            Assert.Equal(("demo_flights_unavailable", UnavailableTitle), (problem.Code, problem.Title));
        }
        Assert.Empty(store.Calls);
    }

    [Fact]
    public async Task DemoFlightCommandsNeedTheirKeyAndAnswerCodedProblems()
    {
        var store = new DemoStore();
        await using var application = Application(store, Superadministrator);
        using var client = Authorized(application);
        var ct = TestContext.Current.CancellationToken;

        // Without the header the request never reaches the handler.
        using var keyless = await client.PostAsJsonAsync("/api/v1/governance/demo-flights", Create(), ct);
        using var keylessCancel = await client.PostAsJsonAsync($"/api/v1/governance/demo-flights/{DemoFlightId}/cancel",
            new { intent = "Cancel" }, ct);
        Assert.Equal((HttpStatusCode.BadRequest, HttpStatusCode.BadRequest), (keyless.StatusCode, keylessCancel.StatusCode));
        using var empty = await SendAsync(client, "governance/demo-flights", Guid.Empty, Create());
        Assert.Equal((HttpStatusCode.BadRequest, "idempotency_key_required", InvalidTitle),
            await StatusCodeAndTitleAsync(empty));

        // The rules of the form, checked before the store: minutes, ground time, airports, stand choice and intent.
        foreach (var body in new[]
                 {
                     Create(minutes: 1), Create(minutes: 31), Create(ground: 19), Create(ground: 241), Create(origin: "MI"),
                     Create(standChoice: "Random"), Create(standChoice: "Specific"), Create(standChoice: "none"),
                     Create(standChoice: "None", standId: StandId),
                 })
        {
            using var invalid = await SendAsync(client, "governance/demo-flights", Guid.NewGuid(), body);
            Assert.Equal((HttpStatusCode.BadRequest, "invalid_demo_flight", InvalidTitle), await StatusCodeAndTitleAsync(invalid));
        }
        // Only the exact names: «Cancel» or «Finish».
        foreach (var intent in new[] { "Dismiss", "cancel", "Cancel ", "0" })
        {
            using var invalid = await SendAsync(client, $"governance/demo-flights/{DemoFlightId}/cancel", Guid.NewGuid(),
                new { intent });
            Assert.Equal((HttpStatusCode.BadRequest, "invalid_demo_flight", InvalidTitle), await StatusCodeAndTitleAsync(invalid));
        }
        Assert.Empty(store.Calls);

        // The store's refusals keep their code; the title says the cause in Spanish.
        foreach (var (failure, code, status, title) in new[]
                 {
                     (MasterDataFailure.NotFound, "station_unavailable", HttpStatusCode.NotFound, NotFoundTitle),
                     (MasterDataFailure.Conflict, "airline_inactive", HttpStatusCode.Conflict, ConflictTitle),
                     (MasterDataFailure.Conflict, "contract_not_in_force", HttpStatusCode.Conflict, ConflictTitle),
                     (MasterDataFailure.Conflict, "contract_ambiguous", HttpStatusCode.Conflict, ConflictTitle),
                     (MasterDataFailure.Conflict, "aircraft_type_unavailable", HttpStatusCode.Conflict, ConflictTitle),
                     (MasterDataFailure.Conflict, "demo_origin_unknown", HttpStatusCode.Conflict, ConflictTitle),
                     (MasterDataFailure.Conflict, "demo_flight_limit_reached", HttpStatusCode.Conflict, ConflictTitle),
                     (MasterDataFailure.Conflict, "idempotency_conflict", HttpStatusCode.Conflict, ConflictTitle),
                     (MasterDataFailure.Conflict, "version_conflict", HttpStatusCode.Conflict, ConflictTitle),
                     (MasterDataFailure.Invalid, "invalid_demo_flight", HttpStatusCode.BadRequest, InvalidTitle),
                     (MasterDataFailure.Forbidden, "forbidden", HttpStatusCode.Forbidden, ForbiddenTitle),
                 })
        {
            store.CreateResult = MasterDataResult<DemoFlightData>.Failed(failure, code);
            using var refused = await SendAsync(client, "governance/demo-flights", Guid.NewGuid(), Create());
            Assert.Equal((status, code, title), await StatusCodeAndTitleAsync(refused));
        }

        // A refused stand names the rules it breaks, as the import does.
        store.CreateResult = MasterDataResult<DemoFlightData>.Failed(MasterDataFailure.Conflict, "stand_unavailable",
            ["stand_taken"]);
        using var taken = await SendAsync(client, "governance/demo-flights", Guid.NewGuid(),
            Create(standChoice: "Specific", standId: StandId));
        Assert.Equal((HttpStatusCode.Conflict, "stand_unavailable", ConflictTitle), await StatusCodeAndTitleAsync(taken));
        using (var problem = await JsonAsync(taken))
            Assert.Equal("""["stand_taken"]""", problem.RootElement.GetProperty("reasons").GetRawText());
        Assert.Equal(12, store.Calls.Count(call => call == "create"));
    }

    [Fact]
    public async Task TheCreateAnswers201AndTheReplay200()
    {
        var store = new DemoStore();
        await using var application = Application(store, Superadministrator);
        using var client = Authorized(application);
        var key = Guid.NewGuid();

        using var created = await SendAsync(client, "governance/demo-flights", key, Create());
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal("application/json", created.Content.Headers.ContentType?.MediaType);
        var body = await created.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
        using (var answer = JsonDocument.Parse(body))
        {
            Assert.Equal(FlightNames, Names(answer.RootElement));
            Assert.Equal(DemoFlightId, answer.RootElement.GetProperty("id").GetGuid());
            Assert.Equal(("ZZ9001", "ZZ9002", "Active", "Approach"),
                (answer.RootElement.GetProperty("arrivalFlightNumber").GetString(),
                    answer.RootElement.GetProperty("departureFlightNumber").GetString(),
                    answer.RootElement.GetProperty("state").GetString(), answer.RootElement.GetProperty("phase").GetString()));
            Assert.Equal(Now.AddSeconds(264), answer.RootElement.GetProperty("touchdownAt").GetDateTimeOffset());
            Assert.False(answer.RootElement.GetProperty("imported").GetBoolean());
            Assert.Equal(JsonValueKind.Null, answer.RootElement.GetProperty("turnaroundId").ValueKind);
        }
        // The handler hands the store the request normalized: IATA in capitals, no destination = the origin.
        Assert.Equal((key, new CreateDemoFlightInput(StationId, AirlineId, "MIA", "MIA", AircraftTypeId, DemoStandChoice.None,
            null, 8, 60)), (store.LastKey, store.LastCreate));

        store.CreateResult = MasterDataResult<DemoFlightData>.Success(Flight, replayed: true);
        using var replayed = await SendAsync(client, "governance/demo-flights", key, Create());
        Assert.Equal(HttpStatusCode.OK, replayed.StatusCode);
        Assert.Equal(body, await replayed.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.Equal(key, store.LastKey);

        store.CreateResult = MasterDataResult<DemoFlightData>.Success(Flight);
        using var specific = await SendAsync(client, "governance/demo-flights", Guid.NewGuid(), new
        {
            stationId = StationId, airlineId = AirlineId, originIata = "MIA", destinationIata = "jfk",
            aircraftTypeId = AircraftTypeId, standChoice = "Specific", standId = StandId, minutesToOnBlock = 2,
            groundMinutes = 240,
        });
        Assert.Equal(HttpStatusCode.Created, specific.StatusCode);
        Assert.Equal(new CreateDemoFlightInput(StationId, AirlineId, "MIA", "JFK", AircraftTypeId, DemoStandChoice.Specific,
            StandId, 2, 240), store.LastCreate);
    }

    [Fact]
    public async Task TheCancelTakesItsIntentAndNoVersion()
    {
        var store = new DemoStore();
        await using var application = Application(store, Superadministrator);
        using var client = Authorized(application);
        var key = Guid.NewGuid();

        store.CancelResult = MasterDataResult<DemoFlightData>.Success(Flight with { State = "Cancelled", Phase = "Gone",
            VanishAt = Now.AddMinutes(1) });
        using var cancelled = await SendAsync(client, $"governance/demo-flights/{DemoFlightId}/cancel", key,
            new { intent = "Cancel" });
        Assert.Equal(HttpStatusCode.OK, cancelled.StatusCode);
        using (var answer = await JsonAsync(cancelled))
        {
            Assert.Equal(FlightNames, Names(answer.RootElement));
            Assert.Equal(("Cancelled", "Gone"), (answer.RootElement.GetProperty("state").GetString(),
                answer.RootElement.GetProperty("phase").GetString()));
        }
        Assert.Equal((DemoFlightId, DemoFlightIntent.Cancel, key), store.LastCancel);

        store.CancelResult = MasterDataResult<DemoFlightData>.Success(Flight with { Phase = "Parked" });
        var finishKey = Guid.NewGuid();
        using var finished = await SendAsync(client, $"governance/demo-flights/{DemoFlightId}/cancel", finishKey,
            new { intent = "Finish" });
        Assert.Equal(HttpStatusCode.OK, finished.StatusCode);
        Assert.Equal((DemoFlightId, DemoFlightIntent.Finish, finishKey), store.LastCancel);

        // No expected version: the worker's stamps make it stale by design, so the body refuses one.
        using var versioned = await SendAsync(client, $"governance/demo-flights/{DemoFlightId}/cancel", Guid.NewGuid(),
            new { intent = "Cancel", expectedVersion = "AAAAAAAAB9E=" });
        Assert.Equal(HttpStatusCode.BadRequest, versioned.StatusCode);
        Assert.Equal(2, store.Calls.Count(call => call == "cancel"));

        foreach (var (failure, code, status, title) in new[]
                 {
                     (MasterDataFailure.Conflict, "demo_flight_closed", HttpStatusCode.Conflict, ConflictTitle),
                     (MasterDataFailure.Conflict, "version_conflict", HttpStatusCode.Conflict, ConflictTitle),
                     (MasterDataFailure.NotFound, "not_found", HttpStatusCode.NotFound, NotFoundTitle),
                 })
        {
            store.CancelResult = MasterDataResult<DemoFlightData>.Failed(failure, code);
            using var refused = await SendAsync(client, $"governance/demo-flights/{DemoFlightId}/cancel", Guid.NewGuid(),
                new { intent = "Finish" });
            Assert.Equal((status, code, title), await StatusCodeAndTitleAsync(refused));
        }
    }

    [Fact]
    public async Task DemoWriteContractsRejectUnknownMembers()
    {
        var store = new DemoStore();
        await using var application = Application(store, Superadministrator);
        using var client = Authorized(application);

        // The flight numbers and the registration are generated: a body that names them is refused.
        foreach (var body in new object[]
                 {
                     new { stationId = StationId, airlineId = AirlineId, originIata = "MIA", destinationIata = (string?)null,
                         aircraftTypeId = AircraftTypeId, standChoice = "None", standId = (Guid?)null, minutesToOnBlock = 8,
                         groundMinutes = 60, arrivalFlightNumber = "ZZ9001" },
                     new { stationId = StationId, airlineId = AirlineId, originIata = "MIA", destinationIata = (string?)null,
                         aircraftTypeId = AircraftTypeId, standChoice = "None", standId = (Guid?)null, minutesToOnBlock = 8,
                         groundMinutes = 60, aircraftRegistration = "HIDM01" },
                 })
        {
            using var refused = await SendAsync(client, "governance/demo-flights", Guid.NewGuid(), body);
            Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        }
        using var cancel = await SendAsync(client, $"governance/demo-flights/{DemoFlightId}/cancel", Guid.NewGuid(),
            new { intent = "Cancel", reason = "Ensayo" });
        Assert.Equal(HttpStatusCode.BadRequest, cancel.StatusCode);
        Assert.Empty(store.Calls);
    }

    [Fact]
    public async Task TheReadsAnswerTheStationTheStoreChose()
    {
        var store = new DemoStore();
        await using var application = Application(store, Superadministrator);
        using var client = Authorized(application);
        var ct = TestContext.Current.CancellationToken;

        using var options = await client.GetAsync($"/api/v1/governance/demo-flights/options?stationId={StationId}", ct);
        Assert.Equal(HttpStatusCode.OK, options.StatusCode);
        using (var answer = await JsonAsync(options))
        {
            var root = answer.RootElement;
            Assert.True(root.GetProperty("enabled").GetBoolean());
            Assert.Equal("2026-11-12", root.GetProperty("operationDate").GetString());
            Assert.Equal(["standId", "code", "terminalCode", "free"], Names(root.GetProperty("stands")[0]));
            Assert.Equal(["id", "name", "iataCode", "icaoCode"], Names(root.GetProperty("airlines")[0]));
            Assert.Equal(["iataCode", "icaoCode", "name", "city", "countryCode"], Names(root.GetProperty("airports")[0]));
            Assert.Equal(["id", "icaoCode", "manufacturer", "model", "sizeCategory"],
                Names(root.GetProperty("aircraftTypes")[0]));
            Assert.Equal("""[{"code":"crosses_local_midnight","reasons":[]}]""", root.GetProperty("warnings").GetRawText());
            Assert.Equal(1, root.GetProperty("limits").GetProperty("active").GetInt32());
        }
        using var list = await client.GetAsync("/api/v1/governance/demo-flights", ct);
        using (var answer = await JsonAsync(list))
        {
            Assert.Equal(StationId, answer.RootElement.GetProperty("stationId").GetGuid());
            Assert.Equal(FlightNames, Names(answer.RootElement.GetProperty("flights")[0]));
        }
        Assert.Equal([$"options {StationId}", "list any"], store.Calls);
        // Only the names of the query are accepted: a malformed station is a 400 before the handler.
        using var malformed = await client.GetAsync("/api/v1/governance/demo-flights?stationId=PUJ", ct);
        Assert.Equal(HttpStatusCode.BadRequest, malformed.StatusCode);
        Assert.Equal(2, store.Calls.Count);
    }

    [Fact]
    public async Task TheProgressWorkerTicksWhereDemoFlightsAreOn()
    {
        var store = new DemoStore();
        await using var application = Application(store, Superadministrator);
        using var client = Authorized(application);
        Assert.True(application.Services.GetRequiredService<DemoFlightAvailability>().Enabled);
        // The hosted worker reads the store at start-up and every five seconds after.
        await store.Advanced.Task.WaitAsync(TimeSpan.FromSeconds(30), TestContext.Current.CancellationToken);
        Assert.True(store.Advances >= 1);
    }

    [Fact]
    public void TheDevelopmentImageTurnsDemoFlightsOnAndProductionKeepsThemOff()
    {
        static string? Mode(string file) => new ConfigurationBuilder()
            .AddJsonFile(Path.Combine(AppContext.BaseDirectory, file), optional: false).Build()[
                Elevant.Infrastructure.DependencyInjection.DemoFlightsModeKey];

        Assert.Equal("Enabled", Mode("appsettings.Development.json"));
        Assert.Equal("Disabled", Mode("appsettings.Production.json"));
        // The shared and the test settings never turn them on: absent means Disabled.
        Assert.Null(Mode("appsettings.json"));
        Assert.Null(Mode("appsettings.Testing.json"));
    }

    [Fact]
    public async Task TheFeedPlanningAndPositionsCarryIsDemoOnlyWhenTrue()
    {
        var store = new DemoStore();
        await using var application = Application(store, OccAdministrator, configure: services =>
        {
            Replace<IOccFlightFeedStore>(services, new FeedStub());
            Replace<IOccPlanningReadStore>(services, new PlanningStub());
            Replace<IOccPositionStore>(services, new PositionsStub());
        });
        using var client = Authorized(application);
        var ct = TestContext.Current.CancellationToken;

        using var feed = await client.GetAsync($"/api/v1/occ/flight-feed?stationId={StationId}&date=2026-11-12", ct);
        Assert.Equal(HttpStatusCode.OK, feed.StatusCode);
        using (var answer = await JsonAsync(feed))
            AssertMarks(answer.RootElement.GetProperty("proposals"), "suggestedAircraftTypeId");

        using var planning = await client.GetAsync($"/api/v1/occ/planning?stationId={StationId}&date=2026-11-12", ct);
        Assert.Equal(HttpStatusCode.OK, planning.StatusCode);
        using (var answer = await JsonAsync(planning))
            AssertMarks(answer.RootElement.GetProperty("turnarounds"), "services");

        using var positions = await client.GetAsync($"/api/v1/occ/positions?stationId={StationId}&date=2026-11-12", ct);
        Assert.Equal(HttpStatusCode.OK, positions.StatusCode);
        using (var answer = await JsonAsync(positions))
        {
            var root = answer.RootElement;
            var all = root.GetProperty("positions")[0].GetProperty("turnarounds").EnumerateArray()
                .Concat(root.GetProperty("unassigned").EnumerateArray()).ToArray();
            AssertMarks(all, "status");
        }
    }

    /// <summary>
    /// Three rows: an ordinary one (no mark), a demo one (<c>isDemo: true</c>, written last) and one whose data said
    /// false, which is never written.
    /// </summary>
    private static void AssertMarks(JsonElement rows, string lastOrdinaryName) => AssertMarks(rows.EnumerateArray().ToArray(),
        lastOrdinaryName);

    private static void AssertMarks(JsonElement[] rows, string lastOrdinaryName)
    {
        Assert.Equal(3, rows.Length);
        Assert.Equal(lastOrdinaryName, Names(rows[0])[^1]);
        Assert.False(rows[0].TryGetProperty("isDemo", out _));
        Assert.Equal([.. Names(rows[0]), "isDemo"], Names(rows[1]));
        Assert.True(rows[1].GetProperty("isDemo").GetBoolean());
        Assert.Equal(Names(rows[0]), Names(rows[2]));
    }

    private WebApplicationFactory<Program> Application(DemoStore store, ActorContext actor, string? mode = "Enabled",
        Action<IServiceCollection>? configure = null) =>
        factory.WithWebHostBuilder(builder =>
        {
            if (mode is not null) builder.UseSetting(Elevant.Infrastructure.DependencyInjection.DemoFlightsModeKey, mode);
            builder.ConfigureTestServices(services =>
            {
                Replace<IDemoFlightStore>(services, store);
                Replace<IActorContextResolver>(services, new Actors(actor));
                configure?.Invoke(services);
            });
        });

    private static async Task<HttpResponseMessage> SendAsync(HttpClient client, string path, Guid key, object body)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/{path}") { Content = JsonContent.Create(body) };
        request.Headers.Add("Idempotency-Key", key.ToString("D"));
        return await client.SendAsync(request, TestContext.Current.CancellationToken);
    }

    private static async Task<JsonDocument> JsonAsync(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));

    private static string[] Names(JsonElement element) => element.EnumerateObject().Select(item => item.Name).ToArray();

    private static async Task<(string? Code, string Title)> ProblemAsync(HttpResponseMessage response)
    {
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var problem = await JsonAsync(response);
        return (problem.RootElement.TryGetProperty("code", out var code) ? code.GetString() : null,
            problem.RootElement.GetProperty("title").GetString() ?? string.Empty);
    }

    private static async Task<(HttpStatusCode Status, string? Code, string Title)> StatusCodeAndTitleAsync(
        HttpResponseMessage response)
    {
        var (code, title) = await ProblemAsync(response);
        return (response.StatusCode, code, title);
    }

    private static void Replace<T>(IServiceCollection services, T implementation) where T : class
    {
        services.RemoveAll<T>();
        services.AddSingleton(implementation);
    }

    private static HttpClient Authorized(WebApplicationFactory<Program> application)
    {
        var client = application.CreateClient();
        var now = DateTimeOffset.UtcNow;
        var token = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Audience = ElevantApiFactory.AuthenticationAudience,
            Expires = now.AddMinutes(15).UtcDateTime,
            IssuedAt = now.UtcDateTime,
            Issuer = ElevantApiFactory.AuthenticationIssuer,
            NotBefore = now.AddSeconds(-5).UtcDateTime,
            SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(
                Convert.FromBase64String(ElevantApiFactory.AuthenticationSigningKeyBase64)), SecurityAlgorithms.HmacSha256),
            Subject = new System.Security.Claims.ClaimsIdentity(
            [
                new System.Security.Claims.Claim(JwtRegisteredClaimNames.Sub, AccountId.ToString("D")),
                new System.Security.Claims.Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("D")),
                new System.Security.Claims.Claim(Elevant.Infrastructure.Authentication.SessionSecurityVersion.ClaimType,
                    Elevant.Infrastructure.Authentication.SessionSecurityVersion.Fingerprint(ElevantApiFactory.TestSecurityStamp)),
            ]),
            TokenType = "at+jwt",
        });
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private sealed class Actors(ActorContext actor) : IActorContextResolver
    {
        public Task<ActorContext?> ResolveAsync(Guid accountId, CancellationToken cancellationToken = default) =>
            Task.FromResult<ActorContext?>(accountId == actor.AccountId ? actor : null);
    }

    /// <summary>What the store answers when it is reached, and what reached it. The worker only counts its ticks.</summary>
    private sealed class DemoStore : IDemoFlightStore
    {
        private int advances;

        public List<string> Calls { get; } = [];

        public MasterDataResult<DemoFlightData> CreateResult { get; set; } = MasterDataResult<DemoFlightData>.Success(Flight);

        public MasterDataResult<DemoFlightData> CancelResult { get; set; } = MasterDataResult<DemoFlightData>.Success(Flight);

        public CreateDemoFlightInput? LastCreate { get; private set; }

        public Guid? LastKey { get; private set; }

        public (Guid DemoFlightId, DemoFlightIntent Intent, Guid Key)? LastCancel { get; private set; }

        public int Advances => Volatile.Read(ref advances);

        public TaskCompletionSource Advanced { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public Task<DemoFlightOptionsData?> OptionsAsync(Guid actorId, Guid? stationId,
            CancellationToken cancellationToken = default)
        {
            Calls.Add($"options {stationId?.ToString() ?? "any"}");
            return Task.FromResult<DemoFlightOptionsData?>(Options);
        }

        public Task<DemoFlightListData?> ListAsync(Guid actorId, Guid? stationId, CancellationToken cancellationToken = default)
        {
            Calls.Add($"list {stationId?.ToString() ?? "any"}");
            return Task.FromResult<DemoFlightListData?>(new DemoFlightListData(true, Now, StationId, [Flight]));
        }

        public Task<MasterDataResult<DemoFlightData>> CreateAsync(Guid actorId, CreateDemoFlightInput input,
            Guid idempotencyKey, CancellationToken cancellationToken = default)
        {
            Calls.Add("create");
            (LastCreate, LastKey) = (input, idempotencyKey);
            return Task.FromResult(CreateResult);
        }

        public Task<MasterDataResult<DemoFlightData>> CancelAsync(Guid actorId, Guid demoFlightId, DemoFlightIntent intent,
            Guid idempotencyKey, CancellationToken cancellationToken = default)
        {
            Calls.Add("cancel");
            LastCancel = (demoFlightId, intent, idempotencyKey);
            return Task.FromResult(CancelResult);
        }

        public Task<int> AdvanceAsync(DateTimeOffset now, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref advances);
            Advanced.TrySetResult();
            return Task.FromResult(0);
        }
    }

    private sealed class FeedStub : IOccFlightFeedStore
    {
        private static OccFlightProposalData Proposal(int number, bool? isDemo) => new(Guid.NewGuid(), "Arrival",
            $"ZZ{9000 + number}", AirlineId, "Demo Airlines", "ZZ", "MIA", "Miami International Airport", true, Now, null,
            null, "Expected", "HIDM01", "Airbus A320", "A", "A01", "Proposed", null, null, Now, "AAAAAAAAB9E=", null, isDemo);

        public Task<OccFlightFeedData?> ListAsync(Guid actorId, Guid stationId, DateOnly date,
            OccFlightFeedView view = OccFlightFeedView.Contracted, CancellationToken cancellationToken = default) =>
            Task.FromResult<OccFlightFeedData?>(new OccFlightFeedData(stationId, "PUJ", date,
                new OccFlightFeedBudgetData(true, "AeroDataBox", 2, 1200, 2, 38000, null, null), null, null, true,
                [Proposal(1, null), Proposal(3, true), Proposal(5, false)]));

        public Task<OccFlightImportResult> ImportAsync(Guid actorId, OccFlightImportInput input, Guid? idempotencyKey,
            CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<OccFlightProposalDismissResult> DismissAsync(Guid actorId, Guid proposalId, string? expectedVersion = null,
            Guid? idempotencyKey = null, CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<OccFlightProposalRestoreResult> RestoreAsync(Guid actorId, Guid proposalId, string? expectedVersion,
            Guid idempotencyKey, CancellationToken cancellationToken = default) => throw new NotSupportedException();
    }

    private sealed class PlanningStub : IOccPlanningReadStore
    {
        private static OccTurnaroundData Turnaround(int number, bool? isDemo) => new(Guid.NewGuid(),
            $"PUJ-20261112-00{number}", Today, "Confirmed",
            new OccAirlineData(AirlineId, "ZZ", "DZZ", "Demo Airlines"), null, null, null, null, null, [], [], [], isDemo);

        public Task<string?> GetStationTimeZoneAsync(Guid stationId, CancellationToken cancellationToken = default) =>
            Task.FromResult<string?>("America/Santo_Domingo");

        public Task<OccPlanningSnapshotData?> GetSnapshotAsync(Guid stationId, DateOnly operationDate,
            CancellationToken cancellationToken = default) =>
            Task.FromResult<OccPlanningSnapshotData?>(new OccPlanningSnapshotData(
                new OccStationData(stationId, "PUJ", "AVIAM PUJ Development", "America/Santo_Domingo"), operationDate,
                [Turnaround(1, null), Turnaround(2, true), Turnaround(3, false)]));

        public Task<OccPlanningOptionsReadResult> GetOptionsAsync(IReadOnlyCollection<Guid> allowedStationIds,
            Guid turnaroundId, CancellationToken cancellationToken = default) => throw new NotSupportedException();
    }

    private sealed class PositionsStub : IOccPositionStore
    {
        private static OccPositionTurnaroundData Turnaround(int number, bool? isDemo) => new(Guid.NewGuid(),
            $"PUJ-20261112-00{number}", "Demo Airlines", "HIDM01", "ZZ9001", "ZZ9002", Now, null, Now.AddHours(1), Now,
            "planned", isDemo);

        public Task<OccPositionResult> ReadAsync(Guid actorId, Guid stationId, DateOnly operationDate,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(new OccPositionResult(new OccPositionBoardData(stationId, "PUJ", operationDate, Now,
                [new OccPositionData(StandId, "A01", "A", "Contact", "planned", [Turnaround(1, null), Turnaround(2, true)])],
                [Turnaround(3, false)], true), null));

        public Task<OccPositionResult> RecordArrivalAsync(Guid actorId, Guid turnaroundId, RecordArrivalInput input,
            OccPositionCommand command, CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<OccPositionResult> LocateStandAsync(Guid actorId, Guid standId, decimal? latitude, decimal? longitude,
            DateOnly operationDate, CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<OccPositionResult> AssignAsync(Guid actorId, Guid turnaroundId, Guid standId, string? reason,
            OccPositionCommand command, CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<OccPositionResult> ReleaseAsync(Guid actorId, Guid turnaroundId, OccPositionCommand command,
            CancellationToken cancellationToken = default) => throw new NotSupportedException();
    }
}
