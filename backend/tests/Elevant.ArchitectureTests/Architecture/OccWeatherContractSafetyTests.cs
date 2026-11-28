using System.Reflection;
using Elevant.Api.Configuration;
using Elevant.Api.Controllers;
using Elevant.Contracts.Operations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;

namespace Elevant.ArchitectureTests.Architecture;

/// <summary>
/// ADR-0043 (contracts 1.4) and plan M6: the OCC's weather is five reads under <c>occ/weather</c>, an airport's and, since
/// M6, its region's METARs, SIGMETs, wind grid and radar frames, for authenticated sessions with a private response.
/// Their contracts expose a public identifier only (and a SIGMET's own code, which is the weather service's), no
/// <c>long</c> and no enumeration (states and codes travel as text). The airport read says nothing of the reasons or the
/// pace the weather service is read at; the region reads say why they are not live and when to ask again, like the air
/// picture, with exactly the names of their contracts.
/// </summary>
public sealed class OccWeatherContractSafetyTests
{
    private static readonly string[] WeatherPrefixes =
        ["OccAerodrome", "OccWeather", "OccMetar", "OccTaf", "OccCloud", "OccRegion", "OccSigmet", "OccWind", "OccRadar"];

    private static readonly Type[] AerodromeContracts =
    [
        typeof(OccAerodromeWeatherResponse), typeof(OccWeatherSourceResponse), typeof(OccMetarResponse),
        typeof(OccCloudLayerResponse), typeof(OccTafResponse), typeof(OccTafPeriodResponse),
    ];

    private static readonly Type[] RegionContracts =
    [
        typeof(OccRegionWeatherResponse), typeof(OccRegionWeatherCreditResponse), typeof(OccRegionWeatherStationResponse),
        typeof(OccRegionMetarResponse), typeof(OccRegionTafResponse),
    ];

    private static readonly Type[] LayerContracts =
    [
        typeof(OccSigmetsResponse), typeof(OccSigmetResponse), typeof(OccWindGridResponse), typeof(OccWindGridAreaResponse),
        typeof(OccWindPointResponse), typeof(OccRadarFramesResponse), typeof(OccRadarFrameResponse),
    ];

    private static readonly Type[] LayerReads = [typeof(OccSigmetsResponse), typeof(OccWindGridResponse),
        typeof(OccRadarFramesResponse)];

    private static readonly Type[] WeatherContracts = typeof(OccAerodromeWeatherResponse).Assembly.GetTypes()
        .Where(type => type.Namespace == typeof(OccAerodromeWeatherResponse).Namespace &&
            WeatherPrefixes.Any(prefix => type.Name.StartsWith(prefix, StringComparison.Ordinal)))
        .ToArray();

    [Fact]
    public void WeatherContractsExposeNoLongNoEnumAndNoInternalId()
    {
        Assert.Equal(AerodromeContracts.Concat(RegionContracts).Concat(LayerContracts).ToHashSet(),
            WeatherContracts.ToHashSet());
        Assert.All(WeatherContracts, type => Assert.True(type.IsSealed, type.Name));
        var properties = Properties(WeatherContracts);

        // No internal key, no enumeration, nothing secret.
        Assert.DoesNotContain(properties, property =>
            property.PropertyType == typeof(long) || property.PropertyType == typeof(long?) ||
            (Nullable.GetUnderlyingType(property.PropertyType) ?? property.PropertyType).IsEnum ||
            property.Name.Contains("Password", StringComparison.OrdinalIgnoreCase) ||
            property.Name.Contains("Token", StringComparison.OrdinalIgnoreCase) ||
            property.Name.Contains("Email", StringComparison.OrdinalIgnoreCase) ||
            property.Name.Contains("ApiKey", StringComparison.OrdinalIgnoreCase));
        // The only identifier of ELEVANT a screen receives is the station's public UUID, once in each read; a SIGMET
        // brings the weather service's own codes as text: its id and its FIR.
        Assert.Equal(["FirId", "Id", "StationId", "StationId", "StationId", "StationId", "StationId"], properties
            .Where(property => property.Name == "Id" || property.Name.EndsWith("Id", StringComparison.Ordinal))
            .Select(property => property.Name).Order(StringComparer.Ordinal));
        Assert.Equal((typeof(string), typeof(string)), (typeof(OccSigmetResponse).GetProperty("Id")?.PropertyType,
            typeof(OccSigmetResponse).GetProperty("FirId")?.PropertyType));
        foreach (var read in new[] { typeof(OccAerodromeWeatherResponse), typeof(OccRegionWeatherResponse) }.Concat(LayerReads))
        {
            Assert.Equal(typeof(Guid), read.GetProperty("StationId")?.PropertyType);
            // The states are text from a closed list.
            Assert.Equal(typeof(string), read.GetProperty("Status")?.PropertyType);
        }
    }

    [Fact]
    public void TheAirportReadSaysNothingOfWhyOrWhenToAskAgain()
    {
        // The state alone tells the screens what they show.
        Assert.DoesNotContain(Properties(AerodromeContracts), property => property.Name is "Reason" or "RefreshAfterSeconds");
        // The credit is always there: name and home page.
        Assert.Equal(["Name", "HomeUrl"], Names(typeof(OccWeatherSourceResponse)));
        Assert.Equal(typeof(OccWeatherSourceResponse), typeof(OccAerodromeWeatherResponse).GetProperty("Source")?.PropertyType);
    }

    [Fact]
    public void TheRegionReadCarriesExactlyTheNamesOfItsContract()
    {
        // The JSON names are these in camelCase, in this order.
        Assert.Equal(["StationId", "Status", "Reason", "ServerTime", "RefreshAfterSeconds", "Credit", "Stations"],
            Names(typeof(OccRegionWeatherResponse)));
        Assert.Equal(["Name", "Url"], Names(typeof(OccRegionWeatherCreditResponse)));
        Assert.Equal(["Icao", "Iata", "Name", "Latitude", "Longitude", "Metar", "Taf"],
            Names(typeof(OccRegionWeatherStationResponse)));
        Assert.Equal(["Raw", "ObservedAt", "WindDirectionDegrees", "WindSpeedKnots", "WindGustKnots", "VisibilityStatuteMiles",
            "CeilingFeet", "FlightCategory", "TemperatureCelsius", "DewpointCelsius", "AltimeterHectopascals"],
            Names(typeof(OccRegionMetarResponse)));
        Assert.Equal(["Raw", "IssuedAt", "ValidFrom", "ValidTo"], Names(typeof(OccRegionTafResponse)));

        // Why it is not live is a code (text, or null); when to ask again whole seconds; the credit always comes; every
        // airport travels in one list.
        var response = typeof(OccRegionWeatherResponse);
        Assert.Equal((typeof(string), typeof(int), typeof(OccRegionWeatherCreditResponse),
                typeof(IReadOnlyList<OccRegionWeatherStationResponse>)),
            (response.GetProperty("Reason")?.PropertyType, response.GetProperty("RefreshAfterSeconds")?.PropertyType,
                response.GetProperty("Credit")?.PropertyType, response.GetProperty("Stations")?.PropertyType));
        Assert.Equal((typeof(double), typeof(double), typeof(int?), typeof(int?)),
            (typeof(OccRegionWeatherStationResponse).GetProperty("Latitude")?.PropertyType,
                typeof(OccRegionWeatherStationResponse).GetProperty("Longitude")?.PropertyType,
                typeof(OccRegionMetarResponse).GetProperty("WindDirectionDegrees")?.PropertyType,
                typeof(OccRegionMetarResponse).GetProperty("CeilingFeet")?.PropertyType));
    }

    [Fact]
    public void TheLayerReadsCarryExactlyTheNamesOfTheirContracts()
    {
        // Each one has the state, reason, pace and credit of the region's METARs, then its own layer.
        string[] head = ["StationId", "Status", "Reason", "ServerTime", "RefreshAfterSeconds", "Credit"];
        Assert.Equal([.. head, "Sigmets"], Names(typeof(OccSigmetsResponse)));
        Assert.Equal([.. head, "ValidAt", "Grid"], Names(typeof(OccWindGridResponse)));
        Assert.Equal([.. head, "Provider", "MaxZoom", "Frames"], Names(typeof(OccRadarFramesResponse)));
        foreach (var read in LayerReads)
            Assert.Equal((typeof(string), typeof(int), typeof(OccRegionWeatherCreditResponse)),
                (read.GetProperty("Reason")?.PropertyType, read.GetProperty("RefreshAfterSeconds")?.PropertyType,
                    read.GetProperty("Credit")?.PropertyType));

        Assert.Equal(["Id", "FirId", "Hazard", "Qualifier", "ValidFrom", "ValidTo", "BaseFeet", "TopFeet", "Raw", "Polygon"],
            Names(typeof(OccSigmetResponse)));
        // The area is a ring of [longitude, latitude] pairs, as GeoJSON takes it.
        Assert.Equal((typeof(IReadOnlyList<IReadOnlyList<double>>), typeof(int?), typeof(int?)),
            (typeof(OccSigmetResponse).GetProperty("Polygon")?.PropertyType,
                typeof(OccSigmetResponse).GetProperty("BaseFeet")?.PropertyType,
                typeof(OccSigmetResponse).GetProperty("TopFeet")?.PropertyType));
        Assert.Equal(["LonMin", "LonMax", "LatMin", "LatMax", "Columns", "Rows", "Points"],
            Names(typeof(OccWindGridAreaResponse)));
        Assert.Equal(["Latitude", "Longitude", "SpeedKnots", "DirectionDegrees"], Names(typeof(OccWindPointResponse)));
        Assert.Equal((typeof(DateTimeOffset?), typeof(double), typeof(int)),
            (typeof(OccWindGridResponse).GetProperty("ValidAt")?.PropertyType,
                typeof(OccWindPointResponse).GetProperty("SpeedKnots")?.PropertyType,
                typeof(OccWindPointResponse).GetProperty("DirectionDegrees")?.PropertyType));
        Assert.Equal(["Time", "TileUrlTemplate"], Names(typeof(OccRadarFrameResponse)));
        Assert.Equal((typeof(string), typeof(int)), (typeof(OccRadarFramesResponse).GetProperty("Provider")?.PropertyType,
            typeof(OccRadarFramesResponse).GetProperty("MaxZoom")?.PropertyType));
    }

    [Fact]
    public void TheWeatherIsFiveReadsUnderOccWeather()
    {
        var controller = typeof(OccWeatherController);
        var route = Assert.Single(controller.GetCustomAttributes<RouteAttribute>(inherit: false));
        Assert.Equal("api/v{version:apiVersion}/occ/weather", route.Template);
        Assert.Single(controller.GetCustomAttributes<AuthorizeAttribute>(inherit: false));
        Assert.Single(controller.GetCustomAttributes<PrivateResponseAttribute>(inherit: false));
        Assert.Empty(controller.GetCustomAttributes<AllowAnonymousAttribute>(inherit: true));
        // A malformed query answers the weather's coded 400, not the framework's uncoded validation problem.
        Assert.Single(controller.GetCustomAttributes(inherit: false),
            attribute => attribute.GetType().Name == "OccWeatherProblemDetailsAttribute");

        var actions = controller.GetMethods(BindingFlags.Instance | BindingFlags.Public | BindingFlags.DeclaredOnly)
            .Select(method => (Method: method, Http: method.GetCustomAttribute<HttpMethodAttribute>()))
            .ToArray();
        // Five reads: the operationIds the snapshot publishes, their verb and their routes under occ/weather (the
        // airport's has none of its own).
        Assert.Equal(5, actions.Length);
        Assert.All(actions, action => Assert.NotNull(action.Http));
        var reads = actions
            .Select(action => (Name: action.Http!.Name, Verb: Assert.Single(action.Http.HttpMethods),
                Template: action.Http.Template))
            .OrderBy(read => read.Name, StringComparer.Ordinal)
            .ToArray();
        Assert.Equal(new (string?, string, string?)[]
        {
            ("GetOccAerodromeWeather", "GET", null), ("GetOccRegionRadar", "GET", "radar"),
            ("GetOccRegionSigmets", "GET", "sigmets"), ("GetOccRegionWeather", "GET", "region"),
            ("GetOccRegionWind", "GET", "wind"),
        }, reads);
        foreach (var (read, _) in actions)
        {
            // The station comes in the query; the account, its scope and its authority come from the session.
            Assert.Equal(["stationId", "cancellationToken"], read.GetParameters().Select(parameter => parameter.Name));
            Assert.DoesNotContain(read.GetParameters(), parameter =>
                parameter.GetCustomAttribute<FromBodyAttribute>() is not null ||
                parameter.GetCustomAttribute<FromHeaderAttribute>() is not null ||
                parameter.Name is "accountId" or "actorId" or "organizationId");
            Assert.NotNull(read.GetParameters()[0].GetCustomAttribute<FromQueryAttribute>());
            // Every refusal is a Problem Details: 400, 401, 403 and 404 are declared besides the 200.
            Assert.Equal([200, 400, 401, 403, 404], read.GetCustomAttributes<ProducesResponseTypeAttribute>()
                .Select(attribute => attribute.StatusCode).Order());
        }
    }

    private static PropertyInfo[] Properties(IEnumerable<Type> types) =>
        types.SelectMany(type => type.GetProperties(BindingFlags.Instance | BindingFlags.Public)).ToArray();

    private static string[] Names(Type type) => type.GetProperties().Select(property => property.Name).ToArray();
}
