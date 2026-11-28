using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure;
using Elevant.Infrastructure.Integrations.AviationWeather;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

/// <summary>
/// ADR-0043 (contracts 1.4) through the real HTTP pipeline: the OCC's weather under <c>occ/weather</c>. It validates the
/// station and answers coded Spanish problems; the readers of the map read it, a planner alone too; and the state of the
/// weather (Disabled, Unavailable, Stale, Live) comes in its 200 with the credit of the service. The actor, the airports
/// and the weather source are stubs, and the one real source here sends through a transport that fails at once: no test
/// reaches a database or the network.
/// </summary>
public sealed class OccWeatherEndpointsTests(ElevantApiFactory factory) : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000046");
    private static readonly Guid PuntaCana = Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly Guid SantoDomingo = Guid.Parse("20000000-0000-7000-8000-000000000004");
    private static readonly Guid Elsewhere = Guid.Parse("20000000-0000-7000-8000-000000000099");

    private const string InvalidTitle = "La consulta del clima no es válida.";
    private const string ForbiddenTitle = "No tiene acceso al clima de esta estación.";
    private const string NotFoundTitle = "La estación no está disponible para el clima.";

    private static readonly string[] WeatherNames = ["stationId", "icaoCode", "status", "serverTime", "retrievedAt",
        "source", "metar", "taf"];

    private static readonly string[] MetarNames = ["raw", "observedAt", "flightCategory", "windDirectionDegrees",
        "windVariable", "windSpeedKnots", "windGustKnots", "visibilityStatuteMiles", "temperatureCelsius", "dewpointCelsius",
        "altimeterHectopascals", "weather", "clouds"];

    private static readonly string[] TafNames = ["raw", "issuedAt", "validFrom", "validTo", "periods"];

    private static readonly string[] PeriodNames = ["from", "to", "change", "probabilityPercent", "windDirectionDegrees",
        "windVariable", "windSpeedKnots", "windGustKnots", "visibilityStatuteMiles", "weather", "clouds"];

    private static readonly string[] CloudNames = ["cover", "baseFeet"];

    private static readonly string[] MapPermissions =
    [
        "operations.dashboard.read", "operations.flight_monitoring.read", "operations.positions_map.read",
        "operations.planning.read",
    ];

    [Fact]
    public async Task TheWeatherReadValidatesTheStation()
    {
        var airports = new Airports();
        var weather = new Weather(LiveReport);
        await using var application = Application(Reader("operations.dashboard.read"), airports, weather);
        using var client = Authorized(application);
        var ct = TestContext.Current.CancellationToken;

        // A missing, blank, malformed or empty station: 400 invalid_weather_query, before the airports or the service.
        foreach (var query in new[] { "", "?stationId=", "?stationId=PUJ", $"?stationId={Guid.Empty}", "?station=PUJ" })
        {
            using var response = await client.GetAsync($"/api/v1/occ/weather{query}", ct);
            Assert.True(await StatusCodeAndTitleAsync(response) == (HttpStatusCode.BadRequest, "invalid_weather_query",
                InvalidTitle), query);
            Assert.Contains("no-store", response.Headers.CacheControl?.ToString(), StringComparison.Ordinal);
        }
        Assert.Equal((0, 0), (airports.Requests.Count, weather.Requests.Count));

        // A valid station in any case is read by its airport's code.
        using var valid = await client.GetAsync($"/api/v1/occ/weather?stationId={PuntaCana.ToString("D").ToUpperInvariant()}",
            ct);
        Assert.Equal(HttpStatusCode.OK, valid.StatusCode);
        Assert.Equal([PuntaCana], airports.Requests);
        Assert.Equal(["MDPC"], weather.Requests);
    }

    [Fact]
    public async Task WeatherProblemsAreCodedAndSpanish()
    {
        var ct = TestContext.Current.CancellationToken;
        var path = $"/api/v1/occ/weather?stationId={PuntaCana}";
        var airports = new Airports();
        var weather = new Weather(LiveReport);

        // Without a session: 401 with the Bearer challenge, from the authentication itself.
        await using (var application = Application(Reader(MapPermissions), airports, weather))
        {
            using var anonymous = application.CreateClient();
            using var response = await anonymous.GetAsync(path, ct);
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
            Assert.Contains(response.Headers.WwwAuthenticate, header => header.Scheme == "Bearer");
        }

        // A token whose account no longer resolves: 401 without a code, in Spanish, with the challenge.
        await using (var application = Application(null, airports, weather))
        {
            using var client = Authorized(application);
            using var response = await client.GetAsync(path, ct);
            Assert.Equal((HttpStatusCode.Unauthorized, null, "La sesión no es válida."), await StatusCodeAndTitleAsync(response));
            Assert.Contains(response.Headers.WwwAuthenticate, header => header.Scheme == "Bearer");
        }

        // Another Operations permission alone, or the map permissions outside AVIAM's staff: 403 forbidden.
        var outsider = Reader(MapPermissions) with
        {
            Memberships = [Reader().Memberships[0] with { OrganizationType = OrganizationType.AirlineCustomer,
                Kind = MembershipKind.AirlineClient }],
        };
        foreach (var refused in new[] { Reader("operations.review.read"), outsider })
        {
            await using var application = Application(refused, airports, weather);
            using var client = Authorized(application);
            using var response = await client.GetAsync(path, ct);
            Assert.Equal((HttpStatusCode.Forbidden, "forbidden", ForbiddenTitle), await StatusCodeAndTitleAsync(response));
            Assert.Contains("no-store", response.Headers.CacheControl?.ToString(), StringComparison.Ordinal);
        }
        Assert.Equal((0, 0), (airports.Requests.Count, weather.Requests.Count));

        // A station outside the reader's scope, one the store does not know and an airport without an ICAO code: 404.
        await using (var application = Application(Reader(MapPermissions), airports, weather))
        {
            using var client = Authorized(application);
            using var elsewhere = await client.GetAsync($"/api/v1/occ/weather?stationId={Elsewhere}", ct);
            Assert.Equal((HttpStatusCode.NotFound, "not_found", NotFoundTitle), await StatusCodeAndTitleAsync(elsewhere));
            Assert.Empty(airports.Requests);
            foreach (var icao in new[] { null, "MD1C" })
            {
                airports.Codes[PuntaCana] = icao;
                using var unknown = await client.GetAsync(path, ct);
                Assert.Equal((HttpStatusCode.NotFound, "not_found", NotFoundTitle), await StatusCodeAndTitleAsync(unknown));
            }
        }
        Assert.Equal(2, airports.Requests.Count);
        Assert.Empty(weather.Requests);
    }

    [Fact]
    public async Task TheWeatherAnswersItsStatusInsteadOfAServerError()
    {
        var ct = TestContext.Current.CancellationToken;
        var path = $"/api/v1/occ/weather?stationId={PuntaCana}";

        // Testing has no AviationWeather of its own (appsettings.json leaves it off): Disabled, with the credit and no report.
        await using (var application = Application(Reader("operations.dashboard.read"), new Airports()))
        {
            using var client = Authorized(application);
            using var response = await client.GetAsync(path, ct);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Contains("no-store", response.Headers.CacheControl?.ToString(), StringComparison.Ordinal);
            using var body = await JsonAsync(response);
            var root = body.RootElement;
            Assert.Equal(WeatherNames, Names(root));
            Assert.Equal((PuntaCana.ToString("D"), "MDPC", "Disabled"), (root.GetProperty("stationId").GetString(),
                root.GetProperty("icaoCode").GetString(), root.GetProperty("status").GetString()));
            foreach (var name in new[] { "retrievedAt", "metar", "taf" })
                Assert.Equal(JsonValueKind.Null, root.GetProperty(name).ValueKind);
            AssertCredit(root);
            Assert.InRange(root.GetProperty("serverTime").GetDateTimeOffset(), DateTimeOffset.UtcNow.AddMinutes(-5),
                DateTimeOffset.UtcNow.AddMinutes(5));
        }

        // The real source whose every request fails at once (never the network): Unavailable, then the service is waited
        // out instead of being asked again. A source that throws answers Unavailable too.
        var transport = new FailingTransport();
        using var failing = new AviationWeatherSource(new HttpClient(transport), new Uri("https://aviationweather.gov/api/data/"),
            TimeProvider.System);
        var faulty = new Weather(_ => throw new InvalidOperationException("A synthetic fault of the source."));
        foreach (var source in new IAerodromeWeatherSource[] { failing, failing, faulty })
        {
            await using var application = Application(Reader("operations.dashboard.read"), new Airports(), source);
            using var client = Authorized(application);
            using var response = await client.GetAsync(path, ct);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            using var body = await JsonAsync(response);
            var root = body.RootElement;
            Assert.Equal(WeatherNames, Names(root));
            Assert.Equal(("MDPC", "Unavailable"), (root.GetProperty("icaoCode").GetString(), root.GetProperty("status").GetString()));
            foreach (var name in new[] { "retrievedAt", "metar", "taf" })
                Assert.Equal(JsonValueKind.Null, root.GetProperty(name).ValueKind);
            AssertCredit(root);
        }
        Assert.Equal(["https://aviationweather.gov/api/data/metar?ids=MDPC&format=json",
                "https://aviationweather.gov/api/data/taf?ids=MDPC&format=json"],
            transport.Requests.Order(StringComparer.Ordinal));

        // A live METAR with its TAF: every level with exactly the names of the contract.
        var weather = new Weather(LiveReport);
        await using (var application = Application(Reader("operations.dashboard.read"), new Airports(), weather))
        {
            using var client = Authorized(application);
            using var response = await client.GetAsync(path, ct);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            using var body = await JsonAsync(response);
            AssertLive(body.RootElement);
        }
        Assert.Equal(["MDPC"], weather.Requests);
    }

    [Fact]
    public async Task APlanningOnlyReaderCanReadTheWeather()
    {
        var airports = new Airports();
        var weather = new Weather(LiveReport);
        var ct = TestContext.Current.CancellationToken;
        await using var application = Application(Reader("operations.planning.read"), airports, weather);
        using var client = Authorized(application);

        using var response = await client.GetAsync($"/api/v1/occ/weather?stationId={PuntaCana}", ct);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using (var body = await JsonAsync(response))
            AssertLive(body.RootElement);

        // Any station of the scope has the weather of its own airport.
        using var sdq = await client.GetAsync($"/api/v1/occ/weather?stationId={SantoDomingo}", ct);
        Assert.Equal(HttpStatusCode.OK, sdq.StatusCode);
        using (var body = await JsonAsync(sdq))
            Assert.Equal((SantoDomingo.ToString("D"), "MDSD"), (body.RootElement.GetProperty("stationId").GetString(),
                body.RootElement.GetProperty("icaoCode").GetString()));
        Assert.Equal(["MDPC", "MDSD"], weather.Requests);
    }

    [Fact]
    public void TheDevelopmentImageTurnsTheWeatherOn()
    {
        static IConfigurationRoot Compose(params string[] files)
        {
            var builder = new ConfigurationBuilder();
            foreach (var file in files) builder.AddJsonFile(Path.Combine(AppContext.BaseDirectory, file), optional: false);
            return builder.Build();
        }

        // The shared settings leave it off and name the Data API of aviationweather.gov.
        var shared = Compose("appsettings.json");
        var sharedOptions = shared.GetSection(AviationWeatherOptions.SectionName).Get<AviationWeatherOptions>()!;
        Assert.False(sharedOptions.Enabled);
        Assert.Equal("https://aviationweather.gov/api/data/", shared["AviationWeather:BaseUrl"]);
        Assert.Equal("false", shared["AviationWeather:Enabled"]?.ToLowerInvariant());

        // Development (the VPS image and the local stack) turns it on inside the image, with the same address: the VPS
        // needs no new variable.
        var development = Compose("appsettings.json", "appsettings.Development.json");
        var options = development.GetSection(AviationWeatherOptions.SectionName).Get<AviationWeatherOptions>()!;
        Assert.Equal((true, "https://aviationweather.gov/api/data/"), (options.Enabled, options.BaseUrl));
        Assert.False(Compose("appsettings.Development.json").GetSection("AviationWeather:BaseUrl").Exists());

        // Production says off explicitly; Testing adds no AviationWeather of its own.
        Assert.Equal("false", Compose("appsettings.Production.json")["AviationWeather:Enabled"]?.ToLowerInvariant());
        Assert.False(Compose("appsettings.Testing.json").GetSection(AviationWeatherOptions.SectionName).Exists());
        foreach (var environment in new[] { "appsettings.Testing.json", "appsettings.Production.json" })
            Assert.False(Compose("appsettings.json", environment).GetValue<bool>("AviationWeather:Enabled"), environment);

        // That configuration starts the API with the aviationweather.gov source, built only when it is first resolved;
        // building it sends nothing (a read leaves only when a screen asks for an airport's weather).
        var services = new ServiceCollection().AddInfrastructure(new ConfigurationBuilder()
            .AddConfiguration(development)
            .AddInMemoryCollection(new Dictionary<string, string?> { ["environment"] = "Development" })
            .Build());
        var descriptor = Assert.Single(services, item => item.ServiceType == typeof(IAerodromeWeatherSource));
        Assert.Equal(((Type?)null, ServiceLifetime.Singleton), (descriptor.ImplementationType, descriptor.Lifetime));
        Assert.NotNull(descriptor.ImplementationFactory);
        using var source = Assert.IsType<AviationWeatherSource>(descriptor.ImplementationFactory!(new OnlyTime()));
        // The region's weather (plan M6) follows the same switch, with its own source.
        var regionDescriptor = Assert.Single(services, item => item.ServiceType == typeof(IRegionWeatherSource));
        Assert.NotNull(regionDescriptor.ImplementationFactory);
        using var regionSource = Assert.IsType<AviationWeatherRegionSource>(
            regionDescriptor.ImplementationFactory!(new OnlyTime()));

        // Off, as Testing and Production leave it, the source is the disabled one: nothing is ever called.
        var off = new ServiceCollection().AddInfrastructure(new ConfigurationBuilder()
            .AddConfiguration(Compose("appsettings.json", "appsettings.Production.json"))
            .AddInMemoryCollection(new Dictionary<string, string?> { ["environment"] = "Production" })
            .Build());
        Assert.Equal(typeof(DisabledAerodromeWeatherSource),
            Assert.Single(off, item => item.ServiceType == typeof(IAerodromeWeatherSource)).ImplementationType);
        Assert.Equal(typeof(DisabledRegionWeatherSource),
            Assert.Single(off, item => item.ServiceType == typeof(IRegionWeatherSource)).ImplementationType);
    }

    [Fact]
    public async Task TheRegionReadValidatesAndScopesTheStation()
    {
        var ct = TestContext.Current.CancellationToken;
        var airports = new Airports();
        var region = new RegionWeather(LiveRegion);

        await using (var application = Application(Reader(MapPermissions), airports, region: region))
        {
            using var client = Authorized(application);
            // A missing, blank, malformed or empty station: 400 invalid_weather_query, before the airports or the service.
            foreach (var query in new[] { "", "?stationId=", "?stationId=PUJ", $"?stationId={Guid.Empty}" })
            {
                using var response = await client.GetAsync($"/api/v1/occ/weather/region{query}", ct);
                Assert.True(await StatusCodeAndTitleAsync(response) == (HttpStatusCode.BadRequest, "invalid_weather_query",
                    InvalidTitle), query);
            }
            Assert.Equal((0, 0), (airports.Requests.Count, region.Requests.Count));

            // A station outside the scope, and Santo Domingo, whose airport has no region: 404, and nothing is read.
            foreach (var station in new[] { Elsewhere, SantoDomingo })
            {
                using var response = await client.GetAsync($"/api/v1/occ/weather/region?stationId={station}", ct);
                Assert.Equal((HttpStatusCode.NotFound, "not_found", NotFoundTitle), await StatusCodeAndTitleAsync(response));
                Assert.Contains("no-store", response.Headers.CacheControl?.ToString(), StringComparison.Ordinal);
            }
            Assert.Equal([SantoDomingo], airports.Requests);
            Assert.Empty(region.Requests);
        }

        // Another Operations permission alone: 403 forbidden.
        await using (var application = Application(Reader("operations.review.read"), airports, region: region))
        {
            using var client = Authorized(application);
            using var response = await client.GetAsync($"/api/v1/occ/weather/region?stationId={PuntaCana}", ct);
            Assert.Equal((HttpStatusCode.Forbidden, "forbidden", ForbiddenTitle), await StatusCodeAndTitleAsync(response));
        }
        Assert.Empty(region.Requests);
    }

    [Fact]
    public async Task TheRegionAnswersEveryAirportWithExactlyTheNamesOfItsContract()
    {
        var ct = TestContext.Current.CancellationToken;
        var path = $"/api/v1/occ/weather/region?stationId={PuntaCana}";

        // Testing leaves AviationWeather off: Disabled (not_configured), the longest wait, the credit and the 32 airports
        // without reports.
        await using (var application = Application(Reader("operations.planning.read"), new Airports()))
        {
            using var client = Authorized(application);
            using var response = await client.GetAsync(path, ct);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Contains("no-store", response.Headers.CacheControl?.ToString(), StringComparison.Ordinal);
            using var body = await JsonAsync(response);
            var root = body.RootElement;
            Assert.Equal(RegionNames, Names(root));
            Assert.Equal((PuntaCana.ToString("D"), "Disabled", "not_configured", 900),
                (root.GetProperty("stationId").GetString(), root.GetProperty("status").GetString(),
                    root.GetProperty("reason").GetString(), root.GetProperty("refreshAfterSeconds").GetInt32()));
            AssertRegionCredit(root);
            var stations = root.GetProperty("stations").EnumerateArray().ToArray();
            Assert.Equal(32, stations.Length);
            Assert.All(stations, station =>
            {
                Assert.Equal(RegionStationNames, Names(station));
                Assert.Equal((JsonValueKind.Null, JsonValueKind.Null),
                    (station.GetProperty("metar").ValueKind, station.GetProperty("taf").ValueKind));
            });
            Assert.Equal(("MDPC", "PUJ", "Punta Cana International Airport", 18.567093, -68.364558),
                (stations[0].GetProperty("icao").GetString(), stations[0].GetProperty("iata").GetString(),
                    stations[0].GetProperty("name").GetString(), stations[0].GetProperty("latitude").GetDouble(),
                    stations[0].GetProperty("longitude").GetDouble()));
            var sanIsidro = Assert.Single(stations, station => station.GetProperty("icao").GetString() == "MDSI");
            Assert.Equal(JsonValueKind.Null, sanIsidro.GetProperty("iata").ValueKind);
        }

        // The real source whose every request fails at once (never the network): one query of each kind for the whole
        // region, then Unavailable with provider_error.
        var transport = new FailingTransport();
        using (var failing = new AviationWeatherRegionSource(new HttpClient(transport),
                   new Uri("https://aviationweather.gov/api/data/"), TimeProvider.System))
        await using (var application = Application(Reader("operations.dashboard.read"), new Airports(), region: failing))
        {
            using var client = Authorized(application);
            using var response = await client.GetAsync(path, ct);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            using var body = await JsonAsync(response);
            Assert.Equal(("Unavailable", "provider_error"), (body.RootElement.GetProperty("status").GetString(),
                body.RootElement.GetProperty("reason").GetString()));
        }
        var ids = string.Join(',', Elevant.Application.Operations.Weather.RegionWeatherStations.AroundPuntaCana
            .Select(station => station.IcaoCode).Order(StringComparer.Ordinal));
        Assert.Equal([$"https://aviationweather.gov/api/data/metar?ids={ids}&format=json",
                $"https://aviationweather.gov/api/data/taf?ids={ids}&format=json"],
            transport.Requests.Order(StringComparer.Ordinal));

        // A live METAR (variable wind) and a TAF of Punta Cana: every level with exactly the names of the contract.
        var region = new RegionWeather(LiveRegion);
        await using (var application = Application(Reader("operations.dashboard.read"), new Airports(), region: region))
        {
            using var client = Authorized(application);
            using var response = await client.GetAsync(path, ct);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            using var body = await JsonAsync(response);
            var root = body.RootElement;
            Assert.Equal(("Live", JsonValueKind.Null, 300), (root.GetProperty("status").GetString(),
                root.GetProperty("reason").ValueKind, root.GetProperty("refreshAfterSeconds").GetInt32()));
            var puntaCana = root.GetProperty("stations")[0];
            var metar = puntaCana.GetProperty("metar");
            Assert.Equal(RegionMetarNames, Names(metar));
            Assert.Equal((JsonValueKind.Null, 4, 8000, "VFR", 1015.0),
                (metar.GetProperty("windDirectionDegrees").ValueKind, metar.GetProperty("windSpeedKnots").GetInt32(),
                    metar.GetProperty("ceilingFeet").GetInt32(), metar.GetProperty("flightCategory").GetString(),
                    metar.GetProperty("altimeterHectopascals").GetDouble()));
            Assert.Equal(JsonValueKind.Null, metar.GetProperty("windGustKnots").ValueKind);
            var taf = puntaCana.GetProperty("taf");
            Assert.Equal(["raw", "issuedAt", "validFrom", "validTo"], Names(taf));
            Assert.StartsWith("TAF MDPC", taf.GetProperty("raw").GetString(), StringComparison.Ordinal);
            Assert.All(root.GetProperty("stations").EnumerateArray().Skip(1), station =>
                Assert.Equal(JsonValueKind.Null, station.GetProperty("metar").ValueKind));
        }
        Assert.Single(region.Requests);
        Assert.Equal(32, region.Requests[0].Count);
    }

    private static readonly string[] LayerPaths = ["sigmets", "wind", "radar"];

    private static readonly string[] LayerHead = ["stationId", "status", "reason", "serverTime", "refreshAfterSeconds",
        "credit"];

    /// <summary>Plan M6: the SIGMETs, wind and radar reads validate and scope the station as the region's METARs do.</summary>
    [Fact]
    public async Task TheLayerReadsValidateAndScopeTheStation()
    {
        var ct = TestContext.Current.CancellationToken;
        var airports = new Airports();
        var layers = new StubLayers();
        var replaced = new Layers(layers, layers, layers);

        await using (var application = Application(Reader(MapPermissions), airports, layers: replaced))
        {
            using var client = Authorized(application);
            foreach (var path in LayerPaths)
            {
                foreach (var query in new[] { "", "?stationId=", "?stationId=PUJ", $"?stationId={Guid.Empty}" })
                {
                    using var response = await client.GetAsync($"/api/v1/occ/weather/{path}{query}", ct);
                    Assert.True(await StatusCodeAndTitleAsync(response) == (HttpStatusCode.BadRequest,
                        "invalid_weather_query", InvalidTitle), path + query);
                }
                foreach (var station in new[] { Elsewhere, SantoDomingo })
                {
                    using var response = await client.GetAsync($"/api/v1/occ/weather/{path}?stationId={station}", ct);
                    Assert.Equal((HttpStatusCode.NotFound, "not_found", NotFoundTitle), await StatusCodeAndTitleAsync(response));
                    Assert.Contains("no-store", response.Headers.CacheControl?.ToString(), StringComparison.Ordinal);
                }
            }
            Assert.Equal([SantoDomingo, SantoDomingo, SantoDomingo], airports.Requests);
            Assert.Equal(0, layers.Reads);
        }

        // Another Operations permission alone: 403 forbidden.
        await using (var application = Application(Reader("operations.review.read"), airports, layers: replaced))
        {
            using var client = Authorized(application);
            foreach (var path in LayerPaths)
            {
                using var response = await client.GetAsync($"/api/v1/occ/weather/{path}?stationId={PuntaCana}", ct);
                Assert.Equal((HttpStatusCode.Forbidden, "forbidden", ForbiddenTitle), await StatusCodeAndTitleAsync(response));
            }
        }
        Assert.Equal(0, layers.Reads);
    }

    /// <summary>
    /// Plan M6: each layer read answers its state in its 200 with exactly the names of its contract: Disabled while its
    /// switch is off (as Testing leaves them), Unavailable with provider_error when the real source's every request fails
    /// at once (never the network), and its values when live.
    /// </summary>
    [Fact]
    public async Task TheLayerReadsAnswerWithExactlyTheNamesOfTheirContracts()
    {
        var ct = TestContext.Current.CancellationToken;

        await using (var application = Application(Reader("operations.planning.read"), new Airports()))
        {
            using var client = Authorized(application);
            using (var sigmets = await LayerAsync(client, "sigmets", ct))
            {
                Assert.Equal([.. LayerHead, "sigmets"], Names(sigmets.RootElement));
                AssertLayer(sigmets.RootElement, "Disabled", "not_configured", 900, "NOAA Aviation Weather Center",
                    "https://aviationweather.gov");
                Assert.Equal(0, sigmets.RootElement.GetProperty("sigmets").GetArrayLength());
            }
            using (var wind = await LayerAsync(client, "wind", ct))
            {
                Assert.Equal([.. LayerHead, "validAt", "grid"], Names(wind.RootElement));
                AssertLayer(wind.RootElement, "Disabled", "not_configured", 3600, "Open-Meteo", "https://open-meteo.com");
                var grid = wind.RootElement.GetProperty("grid");
                Assert.Equal(["lonMin", "lonMax", "latMin", "latMax", "columns", "rows", "points"], Names(grid));
                Assert.Equal((-76d, -60d, 12d, 24d, 10, 8, 0), (grid.GetProperty("lonMin").GetDouble(),
                    grid.GetProperty("lonMax").GetDouble(), grid.GetProperty("latMin").GetDouble(),
                    grid.GetProperty("latMax").GetDouble(), grid.GetProperty("columns").GetInt32(),
                    grid.GetProperty("rows").GetInt32(), grid.GetProperty("points").GetArrayLength()));
                Assert.Equal(JsonValueKind.Null, wind.RootElement.GetProperty("validAt").ValueKind);
            }
            using (var radar = await LayerAsync(client, "radar", ct))
            {
                Assert.Equal([.. LayerHead, "provider", "maxZoom", "frames"], Names(radar.RootElement));
                AssertLayer(radar.RootElement, "Disabled", "not_configured", 900, "Iowa Environmental Mesonet",
                    "https://mesonet.agron.iastate.edu");
                Assert.Equal((JsonValueKind.Null, 0, 0), (radar.RootElement.GetProperty("provider").ValueKind,
                    radar.RootElement.GetProperty("maxZoom").GetInt32(),
                    radar.RootElement.GetProperty("frames").GetArrayLength()));
            }
        }

        // The real sources whose every request fails at once: one request each, then Unavailable with provider_error.
        var transport = new FailingTransport();
        using (var failingSigmets = new AviationWeatherSigmetSource(new HttpClient(transport),
                   new Uri("https://aviationweather.gov/api/data/"), TimeProvider.System))
        using (var failingWind = new Elevant.Infrastructure.Integrations.OpenMeteo.OpenMeteoWindSource(
                   new HttpClient(transport), new Uri("https://api.open-meteo.com/v1/"), TimeProvider.System))
        using (var failingRadar = new Elevant.Infrastructure.Integrations.WeatherRadar.IemRadarSource(
                   new HttpClient(transport), new Uri("https://mesonet.agron.iastate.edu/"), TimeProvider.System))
        await using (var application = Application(Reader("operations.dashboard.read"), new Airports(),
                         layers: new Layers(failingSigmets, failingWind, failingRadar)))
        {
            using var client = Authorized(application);
            foreach (var path in LayerPaths)
            {
                using var document = await LayerAsync(client, path, ct);
                Assert.Equal(("Unavailable", "provider_error"), (document.RootElement.GetProperty("status").GetString(),
                    document.RootElement.GetProperty("reason").GetString()));
            }
        }
        var sent = transport.Requests;
        Assert.Equal(3, sent.Count);
        Assert.Contains("https://aviationweather.gov/api/data/isigmet?format=json", sent);
        Assert.Single(sent, uri => uri.StartsWith("https://api.open-meteo.com/v1/forecast?latitude=", StringComparison.Ordinal));
        Assert.Single(sent, uri => uri.StartsWith(
            "https://mesonet.agron.iastate.edu/json/radar.py?operation=list&product=N0B&radar=JUA&", StringComparison.Ordinal));

        // Live layers: every level with exactly the names of its contract.
        var layers = new StubLayers();
        await using (var application = Application(Reader("operations.dashboard.read"), new Airports(),
                         layers: new Layers(layers, layers, layers)))
        {
            using var client = Authorized(application);
            using (var sigmets = await LayerAsync(client, "sigmets", ct))
            {
                AssertLayer(sigmets.RootElement, "Live", null, 600, "NOAA Aviation Weather Center",
                    "https://aviationweather.gov");
                var sigmet = Assert.Single(sigmets.RootElement.GetProperty("sigmets").EnumerateArray());
                Assert.Equal(["id", "firId", "hazard", "qualifier", "validFrom", "validTo", "baseFeet", "topFeet", "raw",
                    "polygon"], Names(sigmet));
                Assert.Equal(("TJZS-A3-202611131500", "TJZS", "TS", "EMBD", JsonValueKind.Null, 45000),
                    (sigmet.GetProperty("id").GetString(), sigmet.GetProperty("firId").GetString(),
                        sigmet.GetProperty("hazard").GetString(), sigmet.GetProperty("qualifier").GetString(),
                        sigmet.GetProperty("baseFeet").ValueKind, sigmet.GetProperty("topFeet").GetInt32()));
                // Longitude first, as GeoJSON takes it.
                Assert.Equal([[-67.5, 18.5], [-66.0, 19.5], [-65.0, 18.0], [-67.5, 18.5]],
                    sigmet.GetProperty("polygon").EnumerateArray()
                        .Select(point => point.EnumerateArray().Select(value => value.GetDouble()).ToArray()).ToArray());
            }
            using (var wind = await LayerAsync(client, "wind", ct))
            {
                AssertLayer(wind.RootElement, "Live", null, 3600, "Open-Meteo", "https://open-meteo.com");
                var point = Assert.Single(wind.RootElement.GetProperty("grid").GetProperty("points").EnumerateArray());
                Assert.Equal(["latitude", "longitude", "speedKnots", "directionDegrees"], Names(point));
                Assert.Equal((18.5, -68.4, 12.5, 90), (point.GetProperty("latitude").GetDouble(),
                    point.GetProperty("longitude").GetDouble(), point.GetProperty("speedKnots").GetDouble(),
                    point.GetProperty("directionDegrees").GetInt32()));
                Assert.Equal(JsonValueKind.String, wind.RootElement.GetProperty("validAt").ValueKind);
            }
            using (var radar = await LayerAsync(client, "radar", ct))
            {
                AssertLayer(radar.RootElement, "Live", null, 300, "Iowa Environmental Mesonet",
                    "https://mesonet.agron.iastate.edu");
                Assert.Equal(("iem-tjua", 10), (radar.RootElement.GetProperty("provider").GetString(),
                    radar.RootElement.GetProperty("maxZoom").GetInt32()));
                var frame = Assert.Single(radar.RootElement.GetProperty("frames").EnumerateArray());
                Assert.Equal(["time", "tileUrlTemplate"], Names(frame));
                Assert.Equal("https://mesonet.agron.iastate.edu/c/tile.py/1.0.0/ridge::JUA-N0B-202611131500/{z}/{x}/{y}.png",
                    frame.GetProperty("tileUrlTemplate").GetString());
            }
        }
        Assert.Equal(3, layers.Reads);
    }

    private static async Task<JsonDocument> LayerAsync(HttpClient client, string path, CancellationToken ct)
    {
        using var response = await client.GetAsync($"/api/v1/occ/weather/{path}?stationId={PuntaCana}", ct);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString(), StringComparison.Ordinal);
        return await JsonAsync(response);
    }

    private static void AssertLayer(JsonElement root, string status, string? reason, int refreshAfterSeconds,
        string creditName, string creditUrl)
    {
        Assert.Equal((PuntaCana.ToString("D"), status, reason, refreshAfterSeconds),
            (root.GetProperty("stationId").GetString(), root.GetProperty("status").GetString(),
                root.GetProperty("reason").ValueKind == JsonValueKind.Null ? null : root.GetProperty("reason").GetString(),
                root.GetProperty("refreshAfterSeconds").GetInt32()));
        var credit = root.GetProperty("credit");
        Assert.Equal(["name", "url"], Names(credit));
        Assert.Equal((creditName, creditUrl), (credit.GetProperty("name").GetString(), credit.GetProperty("url").GetString()));
    }

    /// <summary>The sources of the region's layers a test puts in the host's place (plan M6); null keeps the host's.</summary>
    private sealed record Layers(IRegionSigmetSource? Sigmets, IRegionWindSource? Wind, IRegionRadarSource? Radar);

    /// <summary>
    /// The three layer sources at once, live by the host's clock: a SIGMET valid for another hour, one point of wind valid
    /// a quarter of an hour ago and one radar scan of four minutes ago. Every read is counted.
    /// </summary>
    private sealed class StubLayers : IRegionSigmetSource, IRegionWindSource, IRegionRadarSource
    {
        private int _reads;

        public int Reads => Volatile.Read(ref _reads);

        Task<RegionWeatherLayer<IReadOnlyList<RegionSigmet>>?> IRegionSigmetSource.ReadAsync(RegionWeatherArea area,
            CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref _reads);
            var now = DateTimeOffset.UtcNow;
            IReadOnlyList<RegionSigmet> sigmets =
            [
                new("TJZS-A3-202611131500", "TJZS", "TS", "EMBD", now.AddHours(-1), now.AddHours(1), null, 45000,
                    "TJZS SIGMET A3 VALID 131500/131900 TJSJ- EMBD TS TOP FL450",
                    [new(-67.5, 18.5), new(-66.0, 19.5), new(-65.0, 18.0), new(-67.5, 18.5)]),
            ];
            return Task.FromResult<RegionWeatherLayer<IReadOnlyList<RegionSigmet>>?>(new(sigmets, false, null, null));
        }

        Task<RegionWeatherLayer<RegionWindGrid>?> IRegionWindSource.ReadAsync(RegionWeatherArea area,
            CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref _reads);
            var grid = new RegionWindGrid(DateTimeOffset.UtcNow.AddMinutes(-15), area, 10, 8,
                [new RegionWindPoint(18.5, -68.4, 12.5, 90)]);
            return Task.FromResult<RegionWeatherLayer<RegionWindGrid>?>(new(grid, false, null, null));
        }

        Task<RegionWeatherLayer<RegionRadarFrames>?> IRegionRadarSource.ReadAsync(RegionWeatherArea area,
            CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref _reads);
            var frames = new RegionRadarFrames("iem-tjua", 10,
            [
                new RegionRadarFrame(DateTimeOffset.UtcNow.AddMinutes(-4),
                    "https://mesonet.agron.iastate.edu/c/tile.py/1.0.0/ridge::JUA-N0B-202611131500/{z}/{x}/{y}.png"),
            ]);
            return Task.FromResult<RegionWeatherLayer<RegionRadarFrames>?>(new(frames, false, null, null));
        }
    }

    private static readonly string[] RegionNames = ["stationId", "status", "reason", "serverTime", "refreshAfterSeconds",
        "credit", "stations"];

    private static readonly string[] RegionStationNames = ["icao", "iata", "name", "latitude", "longitude", "metar", "taf"];

    private static readonly string[] RegionMetarNames = ["raw", "observedAt", "windDirectionDegrees", "windSpeedKnots",
        "windGustKnots", "visibilityStatuteMiles", "ceilingFeet", "flightCategory", "temperatureCelsius", "dewpointCelsius",
        "altimeterHectopascals"];

    private static void AssertRegionCredit(JsonElement root)
    {
        var credit = root.GetProperty("credit");
        Assert.Equal(["name", "url"], Names(credit));
        Assert.Equal(("NOAA Aviation Weather Center", "https://aviationweather.gov"),
            (credit.GetProperty("name").GetString(), credit.GetProperty("url").GetString()));
    }

    /// <summary>
    /// The region with only Punta Cana reported: a METAR with a variable wind, observed twenty minutes before the host's
    /// clock, and its TAF.
    /// </summary>
    private static RegionWeatherData LiveRegion(IReadOnlyList<string> icaoCodes)
    {
        var now = DateTimeOffset.UtcNow;
        var observedAt = now.AddMinutes(-20);
        var metar = new AerodromeMetar("MDPC 131500Z VRB04KT 9999 FEW018 BKN080 29/22 Q1015", observedAt, "VFR", null, true, 4,
            null, 6, 29, 22, 1015, null, [new AerodromeCloudLayer("FEW", 1800), new AerodromeCloudLayer("BKN", 8000)]);
        var taf = new AerodromeTaf("TAF MDPC 131100Z 1312/1412 09012KT 9999 FEW020", now.AddHours(-2), now.AddHours(-1),
            now.AddHours(23), []);
        return new RegionWeatherData(new Dictionary<string, AerodromeMetar> { ["MDPC"] = metar }, false,
            new Dictionary<string, AerodromeTaf> { ["MDPC"] = taf }, null, null);
    }

    /// <summary>A live METAR of the airport asked for, observed twenty minutes before the host's own clock, and its TAF.</summary>
    private static AerodromeWeatherData LiveReport(string icao)
    {
        var now = DateTimeOffset.UtcNow;
        var observedAt = now.AddMinutes(-20);
        var from = observedAt.AddHours(-3);
        return new AerodromeWeatherData(icao,
            new AerodromeMetar($"{icao} 131500Z 09014G24KT 9999 VCSH FEW018 BKN080 29/22 Q1015", observedAt, "VFR", 90, false,
                14, 24, 6, 29, 22, 1015, "VCSH", [new AerodromeCloudLayer("FEW", 1800), new AerodromeCloudLayer("BKN", 8000)]),
            false,
            new AerodromeTaf($"TAF {icao} 131100Z 1312/1412 09012KT 9999 FEW020 TEMPO 1316/1320 4000 SHRA BKN015",
                from.AddHours(-1), from, from.AddHours(24),
                [
                    new AerodromeTafPeriod(from, from.AddHours(24), null, null, 90, false, 12, null, 6, null,
                        [new AerodromeCloudLayer("FEW", 2000)]),
                    new AerodromeTafPeriod(from.AddHours(4), from.AddHours(8), "TEMPO", null, null, true, 15, 25, 2.49, "SHRA",
                        [new AerodromeCloudLayer("BKN", 1500)]),
                ]),
            now.AddMinutes(-1));
    }

    /// <summary>The live weather of Punta Cana as <see cref="LiveReport"/> answers it, with every name of the contract.</summary>
    private static void AssertLive(JsonElement root)
    {
        Assert.Equal(WeatherNames, Names(root));
        Assert.Equal((PuntaCana.ToString("D"), "MDPC", "Live"), (root.GetProperty("stationId").GetString(),
            root.GetProperty("icaoCode").GetString(), root.GetProperty("status").GetString()));
        Assert.Equal(JsonValueKind.String, root.GetProperty("retrievedAt").ValueKind);
        AssertCredit(root);

        var metar = root.GetProperty("metar");
        Assert.Equal(MetarNames, Names(metar));
        Assert.Equal(("MDPC 131500Z 09014G24KT 9999 VCSH FEW018 BKN080 29/22 Q1015", "VFR", 90, false, 14, 24),
            (metar.GetProperty("raw").GetString(), metar.GetProperty("flightCategory").GetString(),
                metar.GetProperty("windDirectionDegrees").GetInt32(), metar.GetProperty("windVariable").GetBoolean(),
                metar.GetProperty("windSpeedKnots").GetInt32(), metar.GetProperty("windGustKnots").GetInt32()));
        Assert.Equal((6.0, 29.0, 22.0, 1015.0, "VCSH"), (metar.GetProperty("visibilityStatuteMiles").GetDouble(),
            metar.GetProperty("temperatureCelsius").GetDouble(), metar.GetProperty("dewpointCelsius").GetDouble(),
            metar.GetProperty("altimeterHectopascals").GetDouble(), metar.GetProperty("weather").GetString()));
        var clouds = metar.GetProperty("clouds").EnumerateArray().ToArray();
        Assert.All(clouds, cloud => Assert.Equal(CloudNames, Names(cloud)));
        Assert.Equal([("FEW", 1800), ("BKN", 8000)], clouds.Select(cloud =>
            (cloud.GetProperty("cover").GetString(), cloud.GetProperty("baseFeet").GetInt32())));

        var taf = root.GetProperty("taf");
        Assert.Equal(TafNames, Names(taf));
        Assert.StartsWith("TAF MDPC 131100Z", taf.GetProperty("raw").GetString(), StringComparison.Ordinal);
        var periods = taf.GetProperty("periods").EnumerateArray().ToArray();
        Assert.Equal(2, periods.Length);
        Assert.All(periods, period => Assert.Equal(PeriodNames, Names(period)));
        Assert.All(periods.SelectMany(period => period.GetProperty("clouds").EnumerateArray()),
            cloud => Assert.Equal(CloudNames, Names(cloud)));
        Assert.Equal((JsonValueKind.Null, JsonValueKind.Null, false),
            (periods[0].GetProperty("change").ValueKind, periods[0].GetProperty("probabilityPercent").ValueKind,
                periods[0].GetProperty("windVariable").GetBoolean()));
        Assert.Equal(("TEMPO", true, JsonValueKind.Null, 2.49), (periods[1].GetProperty("change").GetString(),
            periods[1].GetProperty("windVariable").GetBoolean(), periods[1].GetProperty("windDirectionDegrees").ValueKind,
            periods[1].GetProperty("visibilityStatuteMiles").GetDouble()));
    }

    private static void AssertCredit(JsonElement root)
    {
        var source = root.GetProperty("source");
        Assert.Equal(["name", "homeUrl"], Names(source));
        Assert.Equal(("NOAA Aviation Weather Center", "https://aviationweather.gov"),
            (source.GetProperty("name").GetString(), source.GetProperty("homeUrl").GetString()));
    }

    /// <summary>
    /// The API with the actor and the airports replaced by stubs and, when given, the weather source. Without one the host
    /// keeps its own: AviationWeather off, as the Testing settings leave it.
    /// </summary>
    private WebApplicationFactory<Program> Application(ActorContext? actor, Airports airports,
        IAerodromeWeatherSource? weather = null, IRegionWeatherSource? region = null, Layers? layers = null) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            Replace<IActorContextResolver>(services, new Actors(actor));
            Replace<IOccStationAirportStore>(services, airports);
            if (weather is not null) Replace(services, weather);
            if (region is not null) Replace(services, region);
            if (layers?.Sigmets is { } sigmets) Replace(services, sigmets);
            if (layers?.Wind is { } wind) Replace(services, wind);
            if (layers?.Radar is { } radar) Replace(services, radar);
        }));

    /// <summary>AVIAM internal staff of Operations with the given permissions, Punta Cana and Santo Domingo in scope.</summary>
    private static ActorContext Reader(params string[] permissions) => new(AccountId, "occ.weather@dev.elevant.test",
        "Weather Reader",
        [new ActorRole(Guid.Parse("41000000-0000-7000-8000-000000000001"), "ADMIN_OCC", "Admin OCC", PortalKind.BackOffice,
            "admin_occ")],
        [new ActorMembership(Guid.Parse("42000000-0000-7000-8000-000000000001"),
            Guid.Parse("10000000-0000-7000-8000-000000000001"), "AVIAM", "AVIAM Development", OrganizationType.AviamOperator,
            MembershipKind.InternalStaff)],
        [new ActorStationScope(PuntaCana, "PUJ"), new ActorStationScope(SantoDomingo, "SDQ")],
        new DepartmentAccess(DepartmentAssignmentKind.Member, Department.Operations,
            permissions.ToHashSet(StringComparer.Ordinal)));

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

    /// <summary>The airports' ICAO codes by station (Punta Cana MDPC, Santo Domingo MDSD), and every station asked about.</summary>
    private sealed class Airports : IOccStationAirportStore
    {
        private readonly Lock _gate = new();
        private readonly List<Guid> _requests = [];

        public Dictionary<Guid, string?> Codes { get; } = new() { [PuntaCana] = "MDPC", [SantoDomingo] = "MDSD" };

        public IReadOnlyList<Guid> Requests
        {
            get
            {
                lock (_gate) return [.. _requests];
            }
        }

        public Task<string?> FindIcaoCodeAsync(Guid stationId, CancellationToken cancellationToken = default)
        {
            lock (_gate) _requests.Add(stationId);
            return Task.FromResult(Codes.GetValueOrDefault(stationId));
        }
    }

    /// <summary>A weather source that answers what <paramref name="answer"/> says, and records every ICAO code asked for.</summary>
    private sealed class Weather(Func<string, AerodromeWeatherData?> answer) : IAerodromeWeatherSource
    {
        private readonly Lock _gate = new();
        private readonly List<string> _requests = [];

        public IReadOnlyList<string> Requests
        {
            get
            {
                lock (_gate) return [.. _requests];
            }
        }

        public Task<AerodromeWeatherData?> ReadAsync(string icaoCode, CancellationToken cancellationToken = default)
        {
            lock (_gate) _requests.Add(icaoCode);
            return Task.FromResult(answer(icaoCode));
        }
    }

    /// <summary>A region source that answers what <paramref name="answer"/> says, and records every list of codes asked for.</summary>
    private sealed class RegionWeather(Func<IReadOnlyList<string>, RegionWeatherData?> answer) : IRegionWeatherSource
    {
        private readonly Lock _gate = new();
        private readonly List<IReadOnlyList<string>> _requests = [];

        public IReadOnlyList<IReadOnlyList<string>> Requests
        {
            get
            {
                lock (_gate) return [.. _requests];
            }
        }

        public Task<RegionWeatherData?> ReadAsync(IReadOnlyList<string> icaoCodes, CancellationToken cancellationToken = default)
        {
            lock (_gate) _requests.Add(icaoCodes);
            return Task.FromResult(answer(icaoCodes));
        }
    }

    /// <summary>A transport that fails every request at once, as a refused connection would, and records each address.</summary>
    private sealed class FailingTransport : HttpMessageHandler
    {
        private readonly Lock _gate = new();
        private readonly List<string> _requests = [];

        public IReadOnlyList<string> Requests
        {
            get
            {
                lock (_gate) return [.. _requests];
            }
        }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            lock (_gate) _requests.Add(request.RequestUri!.AbsoluteUri);
            return Task.FromException<HttpResponseMessage>(new HttpRequestException("The synthetic transport refuses."));
        }
    }

    /// <summary>The one service the weather source's factory asks for.</summary>
    private sealed class OnlyTime : IServiceProvider
    {
        public object? GetService(Type serviceType) => serviceType == typeof(TimeProvider) ? TimeProvider.System : null;
    }
}
