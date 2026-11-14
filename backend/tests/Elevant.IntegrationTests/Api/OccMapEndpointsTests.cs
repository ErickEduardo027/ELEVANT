using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;
using Elevant.Application.Operations.AirPicture;
using Elevant.Application.Operations.MapFlights;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure;
using Elevant.Infrastructure.Integrations.AirTraffic;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

/// <summary>
/// ADR-0042 (contracts 1.3) through the real HTTP pipeline: the three reads of the OCC map under <c>occ/map</c>. They
/// validate the station, the window and the address and answer coded Spanish problems; any map reader reads them, a
/// planner alone too; the air picture and the track belong to the station with live traffic, and the picture's failures
/// come in its 200. The networks and the stores are stubs: no test reaches a database or the network.
/// </summary>
public sealed class OccMapEndpointsTests(ElevantApiFactory factory) : IClassFixture<ElevantApiFactory>
{
    private static readonly DateTimeOffset Now = new(2026, 11, 13, 15, 0, 0, TimeSpan.Zero);
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000044");
    private static readonly Guid PuntaCana = Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly Guid SantoDomingo = Guid.Parse("20000000-0000-7000-8000-000000000004");
    private static readonly Guid Elsewhere = Guid.Parse("20000000-0000-7000-8000-000000000099");
    private static readonly Guid AirlineId = Guid.Parse("21000000-0000-7000-8000-000000000001");
    private static readonly Guid ProposalId = Guid.Parse("0193a6f2-5c1e-7d3a-9b44-1f2e3d4c5b60");
    private static readonly Guid OpenProposalId = Guid.Parse("0193a6f2-5c1e-7d3a-9b44-1f2e3d4c5b61");
    private static readonly Guid LegId = Guid.Parse("70000000-0000-7000-8000-000000000021");
    private static readonly Guid TurnaroundId = Guid.Parse("70000000-0000-7000-8000-000000000012");
    private static readonly Guid OperationId = Guid.Parse("70000000-0000-7000-8000-000000000031");
    private static readonly Guid StandId = Guid.Parse("23000000-0000-7000-8000-000000000001");
    private static readonly Guid DemoFlightId = Guid.Parse("0193a6f2-5c1e-7d3a-9b44-1f2e3d4c5b6a");
    private static readonly AirTrafficAttribution Credit = new("adsb.fi", "https://adsb.fi", "Uso personal y no comercial", null);

    private const string InvalidTitle = "La consulta del mapa no es válida.";
    private const string ForbiddenTitle = "No tiene acceso a los mapas de esta estación.";
    private const string NotFoundTitle = "La estación o el avión no está disponible en el mapa.";

    private static readonly string[] PictureNames = ["stationId", "status", "reason", "serverTime", "observedAt",
        "ageSeconds", "refreshAfterSeconds", "source", "center", "aircraft"];

    private static readonly string[] AircraftNames = ["hex", "callsign", "registration", "typeIcaoCode", "category",
        "latitude", "longitude", "altitudeFeet", "onGround", "groundSpeedKnots", "trackDegrees", "verticalRateFeetPerMinute",
        "squawk", "positionAt", "matchedFlightKey", "matchedBy", "trail"];

    private static readonly string[] PointNames = ["at", "latitude", "longitude", "altitudeFeet", "onGround"];

    private static readonly string[] FlightNames = ["flightKey", "visitKey", "proposalId", "legId", "turnaroundId",
        "direction", "flightNumber", "callsign", "airline", "counterpart", "scheduledAt", "estimatedAt", "actualAt",
        "actualKind", "phase", "providerStatus", "aircraft", "imported", "turnaround", "stand", "suggestedStandCode",
        "milestones", "isDemo", "demo"];

    private static readonly string[] AirportNames = ["iataCode", "icaoCode", "name", "latitude", "longitude"];

    private static readonly string[] MapPermissions =
    [
        "operations.dashboard.read", "operations.flight_monitoring.read", "operations.positions_map.read",
        "operations.planning.read",
    ];

    [Fact]
    public async Task MapReadsValidateTheStationTheWindowAndTheHex()
    {
        var flights = new FlightStore();
        var (picture, network) = await LivePictureAsync(Plane("0c0001"));
        await using var application = Application(Reader("operations.dashboard.read"), flights, picture);
        using var client = Authorized(application);
        var ct = TestContext.Current.CancellationToken;

        // A missing, malformed or empty station, an unknown trail choice, a window out of range or not a whole number and
        // an address that is not six hexadecimal digits: 400 invalid_map_query, before any store or network.
        foreach (var path in new[]
                 {
                     "air-picture", "air-picture?stationId=PUJ", $"air-picture?stationId={Guid.Empty}",
                     $"air-picture?stationId={PuntaCana}&trails=long", $"air-picture?stationId={PuntaCana}&trails=SHORT",
                     "flights", "flights?stationId=PUJ", $"flights?stationId={Guid.Empty}",
                     $"flights?stationId={PuntaCana}&hoursBack=-1", $"flights?stationId={PuntaCana}&hoursBack=25",
                     $"flights?stationId={PuntaCana}&hoursAhead=0", $"flights?stationId={PuntaCana}&hoursAhead=37",
                     $"flights?stationId={PuntaCana}&hoursBack=two", $"flights?stationId={PuntaCana}&hoursAhead=1.5",
                     $"aircraft/0c001/track?stationId={PuntaCana}", $"aircraft/0c00011/track?stationId={PuntaCana}",
                     $"aircraft/0c000g/track?stationId={PuntaCana}", $"aircraft/%7E0c001/track?stationId={PuntaCana}",
                     "aircraft/0c0001/track", $"aircraft/0c0001/track?stationId={Guid.Empty}",
                 })
        {
            using var response = await client.GetAsync($"/api/v1/occ/map/{path}", ct);
            Assert.True(await StatusCodeAndTitleAsync(response) == (HttpStatusCode.BadRequest, "invalid_map_query",
                InvalidTitle), path);
        }
        Assert.Empty(flights.Requests);
        Assert.Equal((0, 1), (flights.KeyCalls, network.Reads));

        // The window: two hours back and twelve ahead by default (also when a value is empty), the limits included.
        foreach (var (query, back, ahead) in new[]
                 {
                     ("", 2, 12), ("&hoursBack=&hoursAhead=", 2, 12), ("&hoursBack=0&hoursAhead=1", 0, 1),
                     ("&hoursBack=24&hoursAhead=36", 24, 36), ("&hoursAhead=3", 2, 3),
                 })
        {
            using var response = await client.GetAsync($"/api/v1/occ/map/flights?stationId={PuntaCana}{query}", ct);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var request = flights.Requests[^1];
            Assert.Equal((PuntaCana, TimeSpan.FromHours(back), TimeSpan.FromHours(ahead)),
                (request.StationId, request.Now - request.From, request.To - request.Now));
        }

        // A known address in any case is answered in lower case; one no read saw is not found.
        using (var track = await client.GetAsync($"/api/v1/occ/map/aircraft/0C0001/track?stationId={PuntaCana}", ct))
        {
            Assert.Equal(HttpStatusCode.OK, track.StatusCode);
            using var body = await JsonAsync(track);
            Assert.Equal(["hex", "serverTime", "source", "points"], Names(body.RootElement));
            Assert.Equal("0c0001", body.RootElement.GetProperty("hex").GetString());
            Assert.Equal(PointNames, Names(body.RootElement.GetProperty("points")[0]));
            Assert.Equal(["name", "homeUrl", "licenseName", "licenseUrl"], Names(body.RootElement.GetProperty("source")));
        }
        using (var unknown = await client.GetAsync($"/api/v1/occ/map/aircraft/0c0009/track?stationId={PuntaCana}", ct))
            Assert.Equal((HttpStatusCode.NotFound, "not_found", NotFoundTitle), await StatusCodeAndTitleAsync(unknown));

        // A station outside the reader's scope: not found, on all three.
        foreach (var path in new[] { $"air-picture?stationId={Elsewhere}", $"flights?stationId={Elsewhere}",
                     $"aircraft/0c0001/track?stationId={Elsewhere}" })
        {
            using var response = await client.GetAsync($"/api/v1/occ/map/{path}", ct);
            Assert.Equal((HttpStatusCode.NotFound, "not_found", NotFoundTitle), await StatusCodeAndTitleAsync(response));
        }

        // «short» (the default) carries each trail, «none» no trail.
        foreach (var (query, points) in new[] { ("", 1), ("&trails=short", 1), ("&trails=none", 0) })
        {
            using var response = await client.GetAsync($"/api/v1/occ/map/air-picture?stationId={PuntaCana}{query}", ct);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            using var body = await JsonAsync(response);
            Assert.Equal(points, body.RootElement.GetProperty("aircraft")[0].GetProperty("trail").GetArrayLength());
        }
        // Reads came from memory: the network was read once, before the host started.
        Assert.Equal(1, network.Reads);
    }

    [Fact]
    public async Task TheAirPictureAnswersItsStatusInsteadOfAServerError()
    {
        var ct = TestContext.Current.CancellationToken;

        // Testing has no AirTraffic of its own (appsettings.json leaves it off): Disabled, with the area and no credit.
        await using (var application = Application(Reader("operations.dashboard.read"), new FlightStore()))
        {
            using var client = Authorized(application);
            using var response = await client.GetAsync($"/api/v1/occ/map/air-picture?stationId={PuntaCana}", ct);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Contains("no-store", response.Headers.CacheControl?.ToString(), StringComparison.Ordinal);
            using var body = await JsonAsync(response);
            var root = body.RootElement;
            Assert.Equal(PictureNames, Names(root));
            Assert.Equal((PuntaCana.ToString("D"), "Disabled", "not_configured", 60),
                (root.GetProperty("stationId").GetString(), root.GetProperty("status").GetString(),
                    root.GetProperty("reason").GetString(), root.GetProperty("refreshAfterSeconds").GetInt32()));
            foreach (var name in new[] { "observedAt", "ageSeconds", "source" })
                Assert.Equal(JsonValueKind.Null, root.GetProperty(name).ValueKind);
            Assert.Equal(0, root.GetProperty("aircraft").GetArrayLength());
            var center = root.GetProperty("center");
            Assert.Equal(["latitude", "longitude", "radiusNm"], Names(center));
            Assert.Equal((18.5674, -68.3634, 250), (center.GetProperty("latitude").GetDouble(),
                center.GetProperty("longitude").GetDouble(), center.GetProperty("radiusNm").GetInt32()));
        }

        // A network that throws or refuses: the first read of the watch is Warming, then the failure is a state of the
        // picture, never a 5xx. Nothing reaches the flights while there are no aircraft.
        foreach (var (network, reason) in new (FailingNetwork, string)[]
                 {
                     (new FailingNetwork(null), "provider_error"),
                     (new FailingNetwork(AirTrafficOutcome.RateLimited), "rate_limited"),
                     (new FailingNetwork(AirTrafficOutcome.Unauthorized), "unauthorized"),
                 })
        {
            var flights = new FlightStore();
            var picture = new AirPictureService(network, Settings(), new FrozenClock(Now));
            await using var application = Application(Reader("operations.dashboard.read"), flights, picture);
            using var client = Authorized(application);

            using (var warming = await client.GetAsync($"/api/v1/occ/map/air-picture?stationId={PuntaCana}", ct))
            {
                Assert.Equal(HttpStatusCode.OK, warming.StatusCode);
                using var body = await JsonAsync(warming);
                Assert.Equal(("Warming", 2, "adsb.fi"), (body.RootElement.GetProperty("status").GetString(),
                    body.RootElement.GetProperty("refreshAfterSeconds").GetInt32(),
                    body.RootElement.GetProperty("source").GetProperty("name").GetString()));
            }
            // The read the request asked for (the hosted worker may be the one that makes it).
            await ReadOnceAsync(picture, ct);
            using (var failed = await client.GetAsync($"/api/v1/occ/map/air-picture?stationId={PuntaCana}", ct))
            {
                Assert.Equal(HttpStatusCode.OK, failed.StatusCode);
                using var body = await JsonAsync(failed);
                var root = body.RootElement;
                Assert.Equal(("Unavailable", reason, 0), (root.GetProperty("status").GetString(),
                    root.GetProperty("reason").GetString(), root.GetProperty("aircraft").GetArrayLength()));
                Assert.InRange(root.GetProperty("refreshAfterSeconds").GetInt32(), 10, 60);
            }
            Assert.Equal(1, network.Reads);
            Assert.Equal(0, flights.KeyCalls);
        }

        // The flights out of reach while aircraft are live: the aircraft come without a flight, in a 200.
        var broken = new FlightStore { KeyFailure = new InvalidOperationException("The database is out of reach.") };
        var (live, _) = await LivePictureAsync(Plane("0c0001", registration: "HI1002"));
        await using (var application = Application(Reader("operations.flight_monitoring.read"), broken, live))
        {
            using var client = Authorized(application);
            using var response = await client.GetAsync($"/api/v1/occ/map/air-picture?stationId={PuntaCana}", ct);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            using var body = await JsonAsync(response);
            var aircraft = body.RootElement.GetProperty("aircraft")[0];
            Assert.Equal(("Live", "0c0001"), (body.RootElement.GetProperty("status").GetString(),
                aircraft.GetProperty("hex").GetString()));
            Assert.Equal((JsonValueKind.Null, JsonValueKind.Null), (aircraft.GetProperty("matchedFlightKey").ValueKind,
                aircraft.GetProperty("matchedBy").ValueKind));
            Assert.Equal(1, broken.KeyCalls);
        }
    }

    [Fact]
    public async Task MapProblemsAreCodedAndSpanish()
    {
        var ct = TestContext.Current.CancellationToken;
        string[] paths = [$"air-picture?stationId={PuntaCana}", $"flights?stationId={PuntaCana}",
            $"aircraft/0c0001/track?stationId={PuntaCana}"];

        // Without a session: 401 with the Bearer challenge, from the authentication itself.
        var flights = new FlightStore();
        await using (var application = Application(Reader(MapPermissions), flights))
        {
            using var anonymous = application.CreateClient();
            foreach (var path in paths)
            {
                using var response = await anonymous.GetAsync($"/api/v1/occ/map/{path}", ct);
                Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
                Assert.Contains(response.Headers.WwwAuthenticate, header => header.Scheme == "Bearer");
            }
        }

        // A token whose account no longer resolves: 401 without a code, in Spanish, with the challenge.
        await using (var application = Application(null, flights))
        {
            using var client = Authorized(application);
            foreach (var path in paths)
            {
                using var response = await client.GetAsync($"/api/v1/occ/map/{path}", ct);
                Assert.Equal((HttpStatusCode.Unauthorized, null, "La sesión no es válida."),
                    await StatusCodeAndTitleAsync(response));
                Assert.Contains(response.Headers.WwwAuthenticate, header => header.Scheme == "Bearer");
            }
        }

        // Another Operations permission alone, or a map permission outside AVIAM's staff: 403 forbidden.
        var outsider = Reader(MapPermissions) with
        {
            Memberships = [Reader().Memberships[0] with { OrganizationType = OrganizationType.AirlineCustomer,
                Kind = MembershipKind.AirlineClient }],
        };
        foreach (var refused in new[] { Reader("operations.review.read"), outsider })
        {
            await using var application = Application(refused, flights);
            using var client = Authorized(application);
            foreach (var path in paths)
            {
                using var response = await client.GetAsync($"/api/v1/occ/map/{path}", ct);
                Assert.Equal((HttpStatusCode.Forbidden, "forbidden", ForbiddenTitle), await StatusCodeAndTitleAsync(response));
                Assert.Contains("no-store", response.Headers.CacheControl?.ToString(), StringComparison.Ordinal);
            }
        }

        // Not found and invalid queries carry their own codes, and the store never answered any of them.
        await using (var application = Application(Reader(MapPermissions), flights))
        {
            using var client = Authorized(application);
            using var missing = await client.GetAsync($"/api/v1/occ/map/flights?stationId={Elsewhere}", ct);
            Assert.Equal((HttpStatusCode.NotFound, "not_found", NotFoundTitle), await StatusCodeAndTitleAsync(missing));
            using var invalid = await client.GetAsync($"/api/v1/occ/map/flights?stationId={PuntaCana}&hoursBack=99", ct);
            Assert.Equal((HttpStatusCode.BadRequest, "invalid_map_query", InvalidTitle), await StatusCodeAndTitleAsync(invalid));
            // An unknown station of the reader's scope (the store knows none) is not found either.
            flights.Data = null;
            using var gone = await client.GetAsync($"/api/v1/occ/map/flights?stationId={PuntaCana}", ct);
            Assert.Equal((HttpStatusCode.NotFound, "not_found", NotFoundTitle), await StatusCodeAndTitleAsync(gone));
        }
        Assert.Single(flights.Requests);
    }

    [Fact]
    public async Task APlanningOnlyReaderCanReadTheFlights()
    {
        var flights = new FlightStore();
        var (picture, _) = await LivePictureAsync(Plane("0c0001", registration: "HI-DM01"), Plane("0c0002", callsign: "DZZ171"));
        // The handler matches at the host's own clock: the flights are due around the real now.
        var soon = DateTimeOffset.UtcNow.AddMinutes(30);
        flights.Keys =
        [
            new MapFlightMatchKey($"p:{ProposalId:D}", "Arrival", "ZZ9001", "DZZ", "ZZ", "HIDM01", soon, false, true),
            new MapFlightMatchKey($"p:{OpenProposalId:D}", "Arrival", "ZZ0171", "DZZ", "ZZ", null, soon, false, false),
        ];
        await using var application = Application(Reader("operations.planning.read"), flights, picture);
        using var client = Authorized(application);
        var ct = TestContext.Current.CancellationToken;

        using var response = await client.GetAsync($"/api/v1/occ/map/flights?stationId={PuntaCana}", ct);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var body = await JsonAsync(response);
        var root = body.RootElement;
        Assert.Equal(["stationId", "stationCode", "serverTime", "windowFrom", "windowTo", "stationAirport", "flights"],
            Names(root));
        Assert.Equal(AirportNames, Names(root.GetProperty("stationAirport")));
        Assert.Equal(18.5674m, root.GetProperty("stationAirport").GetProperty("latitude").GetDecimal());
        var rows = root.GetProperty("flights").EnumerateArray().ToArray();
        Assert.Equal(2, rows.Length);
        Assert.All(rows, row => Assert.Equal(FlightNames, Names(row)));

        // The imported demo leg: its keys, its runway time, its turnaround, stand, milestones and demo clock.
        var imported = rows[0];
        Assert.Equal(($"p:{ProposalId:D}", $"p:{ProposalId:D}", "Runway", "landed", true, true),
            (imported.GetProperty("flightKey").GetString(), imported.GetProperty("visitKey").GetString(),
                imported.GetProperty("actualKind").GetString(), imported.GetProperty("phase").GetString(),
                imported.GetProperty("imported").GetBoolean(), imported.GetProperty("isDemo").GetBoolean()));
        Assert.Equal(["id", "name", "iataCode", "icaoCode"], Names(imported.GetProperty("airline")));
        Assert.Equal(AirportNames, Names(imported.GetProperty("counterpart")));
        Assert.Equal(["registration", "typeIcaoCode", "model", "sizeCategory"], Names(imported.GetProperty("aircraft")));
        Assert.Equal(["id", "operationCode", "status", "operationId", "operationStatus"],
            Names(imported.GetProperty("turnaround")));
        Assert.Equal(["id", "code", "terminalCode"], Names(imported.GetProperty("stand")));
        var milestone = Assert.Single(imported.GetProperty("milestones").EnumerateArray());
        Assert.Equal(["code", "actualAt"], Names(milestone));
        Assert.Equal("BLOCK_ON", milestone.GetProperty("code").GetString());
        Assert.Equal(["demoFlightId", "state", "phase", "appearAt", "touchdownAt", "onBlockAt", "scheduledOffBlockAt",
            "offBlockAt", "takeoffAt", "vanishAt"], Names(imported.GetProperty("demo")));
        Assert.Equal((DemoFlightId.ToString("D"), "Active", "Parked"),
            (imported.GetProperty("demo").GetProperty("demoFlightId").GetString(),
                imported.GetProperty("demo").GetProperty("state").GetString(),
                imported.GetProperty("demo").GetProperty("phase").GetString()));

        // The open proposal: nothing of OCC yet, every absent part written as null and no milestone.
        var open = rows[1];
        Assert.Equal(($"p:{OpenProposalId:D}", "scheduled", false, false, 0),
            (open.GetProperty("flightKey").GetString(), open.GetProperty("phase").GetString(),
                open.GetProperty("imported").GetBoolean(), open.GetProperty("isDemo").GetBoolean(),
                open.GetProperty("milestones").GetArrayLength()));
        foreach (var name in new[] { "legId", "turnaroundId", "counterpart", "estimatedAt", "actualAt", "actualKind",
                     "aircraft", "turnaround", "stand", "suggestedStandCode", "demo" })
            Assert.True(open.GetProperty(name).ValueKind == JsonValueKind.Null, name);

        // Planning alone also opens the air picture; the aircraft name their flights by these keys (never the demo's).
        using var air = await client.GetAsync($"/api/v1/occ/map/air-picture?stationId={PuntaCana}", ct);
        Assert.Equal(HttpStatusCode.OK, air.StatusCode);
        using var picture2 = await JsonAsync(air);
        var aircraft = picture2.RootElement.GetProperty("aircraft").EnumerateArray().ToArray();
        Assert.Equal(PictureNames, Names(picture2.RootElement));
        Assert.All(aircraft, item => Assert.Equal(AircraftNames, Names(item)));
        Assert.All(aircraft.SelectMany(item => item.GetProperty("trail").EnumerateArray()),
            point => Assert.Equal(PointNames, Names(point)));
        Assert.Equal([(null, null), ($"p:{OpenProposalId:D}", "Callsign")], aircraft.Select(item =>
            (item.GetProperty("matchedFlightKey").GetString(), item.GetProperty("matchedBy").GetString())));
    }

    [Fact]
    public async Task TheAirPictureAndTheTrackNeedTheAirTrafficStation()
    {
        var ct = TestContext.Current.CancellationToken;
        var flights = new FlightStore();
        var (picture, _) = await LivePictureAsync(Plane("0c0001"));
        var reader = Reader(MapPermissions);

        // Santo Domingo is in the reader's scope: its flights are read, but it has no air picture and no track.
        await using (var application = Application(reader, flights, picture))
        {
            using var client = Authorized(application);
            foreach (var path in new[] { $"air-picture?stationId={SantoDomingo}", $"aircraft/0c0001/track?stationId={SantoDomingo}" })
            {
                using var response = await client.GetAsync($"/api/v1/occ/map/{path}", ct);
                Assert.Equal((HttpStatusCode.NotFound, "not_found", NotFoundTitle), await StatusCodeAndTitleAsync(response));
            }
            using var sdqFlights = await client.GetAsync($"/api/v1/occ/map/flights?stationId={SantoDomingo}", ct);
            Assert.Equal(HttpStatusCode.OK, sdqFlights.StatusCode);
            Assert.Equal(SantoDomingo, flights.Requests[^1].StationId);
            using var pujPicture = await client.GetAsync($"/api/v1/occ/map/air-picture?stationId={PuntaCana}", ct);
            Assert.Equal(HttpStatusCode.OK, pujPicture.StatusCode);
        }

        // The station is the configured one (AirTraffic:StationCode): moved to SDQ, Santo Domingo has it and Punta Cana not.
        var moved = Settings() with { StationCode = "SDQ" };
        await using (var application = Application(reader, flights, new AirPictureService(new FailingNetwork(null), moved,
                         new FrozenClock(Now)), moved))
        {
            using var client = Authorized(application);
            using var sdq = await client.GetAsync($"/api/v1/occ/map/air-picture?stationId={SantoDomingo}", ct);
            Assert.Equal(HttpStatusCode.OK, sdq.StatusCode);
            using (var body = await JsonAsync(sdq))
                Assert.Equal(SantoDomingo.ToString("D"), body.RootElement.GetProperty("stationId").GetString());
            using var puj = await client.GetAsync($"/api/v1/occ/map/air-picture?stationId={PuntaCana}", ct);
            Assert.Equal((HttpStatusCode.NotFound, "not_found", NotFoundTitle), await StatusCodeAndTitleAsync(puj));
        }
    }

    [Fact]
    public void TheDevelopmentImageTurnsTheAirPictureOnAndRaisesTheRateLimit()
    {
        static IConfigurationRoot Compose(params string[] files)
        {
            var builder = new ConfigurationBuilder();
            foreach (var file in files) builder.AddJsonFile(Path.Combine(AppContext.BaseDirectory, file), optional: false);
            return builder.Build();
        }

        // Development (the VPS image and the local stack): adsb.fi first, adsb.lol as its relief, and 600 requests a
        // minute, all inside the image: the VPS needs no new variable.
        var development = Compose("appsettings.json", "appsettings.Development.json");
        var options = development.GetSection(AirTrafficOptions.SectionName).Get<AirTrafficOptions>()!;
        Assert.True(options.Enabled);
        Assert.Equal(["AdsbFi", "AdsbLol"], options.Providers);
        Assert.Equal(("PUJ", 18.5674, -68.3634, 250, 10, 900, 180), (options.StationCode, options.CenterLatitude,
            options.CenterLongitude, options.RadiusNm, options.IntervalSeconds, options.IdleAfterSeconds, options.TrailMinutes));
        Assert.Null(options.ApiKey);
        Assert.Equal(600, development.GetValue<int>("RateLimiting:PermitLimit"));
        Assert.Equal(10, development.GetValue<int>("RateLimiting:SessionPermitLimit"));

        // That configuration starts the API with both networks, adsb.fi the active one and its credit; nothing is read
        // until a screen watches the map.
        var services = new ServiceCollection().AddInfrastructure(new ConfigurationBuilder()
            .AddConfiguration(development)
            .AddInMemoryCollection(new Dictionary<string, string?> { ["environment"] = "Development" })
            .Build());
        Assert.Equal(new AirTrafficSettings(true, "PUJ", 18.5674, -68.3634, 250, TimeSpan.FromSeconds(10),
                TimeSpan.FromSeconds(900), TimeSpan.FromMinutes(180)),
            Assert.Single(services, item => item.ServiceType == typeof(AirTrafficSettings)).ImplementationInstance);
        var descriptor = Assert.Single(services, item => item.ServiceType == typeof(IAirTrafficProvider));
        using (var provider = (FailoverAirTrafficProvider)descriptor.ImplementationFactory!(new OnlyTime()))
            Assert.Equal((true, ReadsbProfile.AdsbFi.Attribution), (provider.IsConfigured, provider.Attribution));

        // The shared settings leave it off with the values of the code, no list and no key; 100 requests a minute.
        var shared = Compose("appsettings.json");
        var defaults = new AirTrafficOptions();
        var sharedOptions = shared.GetSection(AirTrafficOptions.SectionName).Get<AirTrafficOptions>()!;
        Assert.False(sharedOptions.Enabled);
        Assert.Empty(sharedOptions.Providers);
        Assert.Null(sharedOptions.ApiKey);
        Assert.Equal((defaults.StationCode, defaults.CenterLatitude, defaults.CenterLongitude, defaults.RadiusNm,
                defaults.IntervalSeconds, defaults.IdleAfterSeconds, defaults.TrailMinutes),
            (sharedOptions.StationCode, sharedOptions.CenterLatitude, sharedOptions.CenterLongitude, sharedOptions.RadiusNm,
                sharedOptions.IntervalSeconds, sharedOptions.IdleAfterSeconds, sharedOptions.TrailMinutes));
        Assert.Equal(100, shared.GetValue<int>("RateLimiting:PermitLimit"));

        // Testing adds no AirTraffic of its own, and Production says off explicitly: neither raises the limit.
        Assert.False(Compose("appsettings.Testing.json").GetSection(AirTrafficOptions.SectionName).Exists());
        foreach (var environment in new[] { "appsettings.Testing.json", "appsettings.Production.json" })
        {
            var composed = Compose("appsettings.json", environment);
            Assert.False(composed.GetValue<bool>("AirTraffic:Enabled"), environment);
            Assert.False(composed.GetSection("AirTraffic:Providers").Exists(), environment);
            Assert.Equal(100, composed.GetValue<int>("RateLimiting:PermitLimit"));
        }
        Assert.Equal("false", Compose("appsettings.Production.json")["AirTraffic:Enabled"]?.ToLowerInvariant());
    }

    /// <summary>
    /// The API with the actor, the map flights and (when given) the air picture and its settings replaced by stubs. Without
    /// a picture the host keeps its own: AirTraffic off, as the Testing settings leave it.
    /// </summary>
    private WebApplicationFactory<Program> Application(ActorContext? actor, FlightStore flights,
        AirPictureService? picture = null, AirTrafficSettings? settings = null) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            Replace<IActorContextResolver>(services, new Actors(actor));
            Replace<IOccMapFlightStore>(services, flights);
            Replace<IOccMapFlightMatchKeyStore>(services, flights);
            if (picture is not null)
            {
                Replace(services, picture);
                Replace(services, settings ?? Settings());
            }
        }));

    /// <summary>
    /// A picture of Punta Cana that read the network once at <see cref="Now"/> and found <paramref name="aircraft"/>, with
    /// a clock that never moves: it stays live and no further read is ever due.
    /// </summary>
    private static async Task<(AirPictureService Picture, ScriptedNetwork Network)> LivePictureAsync(
        params AirTrafficAircraft[] aircraft)
    {
        var network = new ScriptedNetwork(aircraft);
        var picture = new AirPictureService(network, Settings(), new FrozenClock(Now));
        picture.NoteDemand();
        await picture.PollOnceAsync(TestContext.Current.CancellationToken);
        Assert.Equal((1, AirPictureStatus.Live), (network.Reads, picture.Read(shortTrails: false).Status));
        return (picture, network);
    }

    /// <summary>Waits for the one read a screen's request asked for, whoever makes it: this test or the hosted worker.</summary>
    private static async Task ReadOnceAsync(AirPictureService picture, CancellationToken cancellationToken)
    {
        for (var attempt = 0; picture.Read(shortTrails: false).Status == AirPictureStatus.Warming; attempt++)
        {
            Assert.True(attempt < 200, "The read of the network never ended.");
            await picture.PollOnceAsync(cancellationToken);
            await Task.Delay(TimeSpan.FromMilliseconds(25), cancellationToken);
        }
    }

    private static AirTrafficSettings Settings() =>
        new(true, "PUJ", 18.5674, -68.3634, 250, TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(900), TimeSpan.FromMinutes(180));

    /// <summary>A synthetic aircraft: an invented address over the sea east of Punta Cana.</summary>
    private static AirTrafficAircraft Plane(string hex, string? callsign = null, string? registration = null) =>
        new(hex, callsign, registration, "A320", "A3", 18.5, -68.36, 2500, false, 150, 80, -600, "1200", Now);

    /// <summary>AVIAM internal staff of Operations with the given permissions, Punta Cana and Santo Domingo in scope.</summary>
    private static ActorContext Reader(params string[] permissions) => new(AccountId, "occ.map@dev.elevant.test", "Map Reader",
        [new ActorRole(Guid.Parse("41000000-0000-7000-8000-000000000001"), "ADMIN_OCC", "Admin OCC", PortalKind.BackOffice,
            "admin_occ")],
        [new ActorMembership(Guid.Parse("42000000-0000-7000-8000-000000000001"),
            Guid.Parse("10000000-0000-7000-8000-000000000001"), "AVIAM", "AVIAM Development", OrganizationType.AviamOperator,
            MembershipKind.InternalStaff)],
        [new ActorStationScope(PuntaCana, "PUJ"), new ActorStationScope(SantoDomingo, "SDQ")],
        new DepartmentAccess(DepartmentAssignmentKind.Member, Department.Operations,
            permissions.ToHashSet(StringComparer.Ordinal)));

    /// <summary>
    /// Punta Cana's map: an imported demo arrival on its stand with BLOCK_ON recorded, and an open proposal of the feed.
    /// </summary>
    private static OccMapFlightsData MapFlights(Guid stationId)
    {
        var airline = new OccMapAirlineData(AirlineId, "Demo Airlines", "ZZ", "DZZ");
        var imported = new OccMapFlightData($"p:{ProposalId:D}", $"p:{ProposalId:D}", ProposalId, LegId, TurnaroundId,
            "Arrival", "ZZ9001", "DZZ9001", airline,
            new OccMapAirportData("MIA", "KMIA", "Miami International Airport", 25.795900m, -80.287000m),
            Now.AddMinutes(-12), Now.AddMinutes(-12), Now.AddMinutes(-15), MapFlightActualKinds.Runway, MapFlightPhases.Landed,
            "Arrived", new OccMapAircraftData("HIDM01", "A320", "Airbus A320", "Narrowbody"), true,
            new OccMapTurnaroundData(TurnaroundId, "PUJ-20261113-001", "Confirmed", OperationId, "InProgress"),
            new OccMapStandData(StandId, "A1", "A"), null, [new OccMapMilestoneData("BLOCK_ON", Now.AddMinutes(-12))], true,
            new OccMapDemoData(DemoFlightId, "Active", "Parked", Now.AddMinutes(-20), Now.AddMinutes(-15), Now.AddMinutes(-12),
                Now.AddMinutes(48), null, null, null));
        var open = new OccMapFlightData($"p:{OpenProposalId:D}", $"p:{OpenProposalId:D}", OpenProposalId, null, null,
            "Arrival", "ZZ0171", "DZZ171", airline, null, Now.AddMinutes(30), null, null, null, MapFlightPhases.Scheduled,
            "Expected", null, false, null, null, null, [], false, null);
        return new OccMapFlightsData(stationId, stationId == SantoDomingo ? "SDQ" : "PUJ", Now, Now.AddHours(-2),
            Now.AddHours(12), new OccMapAirportData("PUJ", "MDPC", "Punta Cana International Airport", 18.567400m, -68.363400m),
            [imported, open]);
    }

    private static async Task<JsonDocument> JsonAsync(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));

    private static string[] Names(JsonElement element) => element.EnumerateObject().Select(item => item.Name).ToArray();

    private static async Task<(HttpStatusCode Status, string? Code, string Title)> StatusCodeAndTitleAsync(
        HttpResponseMessage response)
    {
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var problem = await JsonAsync(response);
        return (response.StatusCode, problem.RootElement.TryGetProperty("code", out var code) ? code.GetString() : null,
            problem.RootElement.GetProperty("title").GetString() ?? string.Empty);
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

    private sealed class Actors(ActorContext? actor) : IActorContextResolver
    {
        public Task<ActorContext?> ResolveAsync(Guid accountId, CancellationToken cancellationToken = default) =>
            Task.FromResult(actor is not null && accountId == actor.AccountId ? actor : null);
    }

    /// <summary>The map flights of any station and the keys to match, and every window and key read asked for.</summary>
    private sealed class FlightStore : IOccMapFlightStore, IOccMapFlightMatchKeyStore
    {
        private readonly Lock _gate = new();
        private readonly List<(Guid StationId, DateTimeOffset From, DateTimeOffset To, DateTimeOffset Now)> _requests = [];
        private int _keyCalls;

        /// <summary>When set, the flights every station answers; null: no station is known.</summary>
        public Func<Guid, OccMapFlightsData>? Data { get; set; } = MapFlights;

        public IReadOnlyList<MapFlightMatchKey> Keys { get; set; } = [];

        public Exception? KeyFailure { get; init; }

        public IReadOnlyList<(Guid StationId, DateTimeOffset From, DateTimeOffset To, DateTimeOffset Now)> Requests
        {
            get
            {
                lock (_gate) return [.. _requests];
            }
        }

        public int KeyCalls => Volatile.Read(ref _keyCalls);

        public Task<OccMapFlightsData?> ListAsync(Guid stationId, DateTimeOffset windowFrom, DateTimeOffset windowTo,
            DateTimeOffset now, CancellationToken cancellationToken = default)
        {
            lock (_gate) _requests.Add((stationId, windowFrom, windowTo, now));
            return Task.FromResult(Data?.Invoke(stationId));
        }

        public Task<IReadOnlyList<MapFlightMatchKey>> ListMatchKeysAsync(Guid stationId, DateTimeOffset now,
            CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _keyCalls);
            return KeyFailure is null
                ? Task.FromResult(Keys)
                : Task.FromException<IReadOnlyList<MapFlightMatchKey>>(KeyFailure);
        }
    }

    /// <summary>A network that answers the same synthetic aircraft to every read.</summary>
    private sealed class ScriptedNetwork(IReadOnlyList<AirTrafficAircraft> aircraft) : IAirTrafficProvider
    {
        private int _reads;

        public int Reads => Volatile.Read(ref _reads);

        public bool IsConfigured => true;

        public AirTrafficAttribution? Attribution => Credit;

        public Task<AirTrafficReadResult> ReadAsync(AirTrafficArea area, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _reads);
            return Task.FromResult(new AirTrafficReadResult(AirTrafficOutcome.Succeeded, Credit, Now, aircraft, null));
        }
    }

    /// <summary>A network that refuses with <paramref name="outcome"/>, or throws when it is null.</summary>
    private sealed class FailingNetwork(AirTrafficOutcome? outcome) : IAirTrafficProvider
    {
        private int _reads;

        public int Reads => Volatile.Read(ref _reads);

        public bool IsConfigured => true;

        public AirTrafficAttribution? Attribution => Credit;

        public Task<AirTrafficReadResult> ReadAsync(AirTrafficArea area, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _reads);
            return outcome is { } refused
                ? Task.FromResult(AirTrafficReadResult.Failure(refused, Credit))
                : throw new HttpRequestException("The synthetic network is down.");
        }
    }

    private sealed class FrozenClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    /// <summary>The one service the air traffic provider's factory asks for.</summary>
    private sealed class OnlyTime : IServiceProvider
    {
        public object? GetService(Type serviceType) => serviceType == typeof(TimeProvider) ? TimeProvider.System : null;
    }
}
