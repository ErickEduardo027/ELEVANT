using System.Reflection;
using Elevant.Api.Configuration;
using Elevant.Api.Controllers;
using Elevant.Contracts.Operations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;

namespace Elevant.ArchitectureTests.Architecture;

/// <summary>
/// ADR-0043 (contracts 1.4): the OCC's weather is one read under <c>occ/weather</c> for authenticated sessions with a
/// private response; its contracts expose a public identifier only, no <c>long</c> and no enumeration (states and codes
/// travel as text), and nothing of the reasons or the pace the weather service is read at.
/// </summary>
public sealed class OccWeatherContractSafetyTests
{
    private static readonly string[] WeatherPrefixes = ["OccAerodrome", "OccWeather", "OccMetar", "OccTaf", "OccCloud"];

    private static readonly Type[] WeatherContracts = typeof(OccAerodromeWeatherResponse).Assembly.GetTypes()
        .Where(type => type.Namespace == typeof(OccAerodromeWeatherResponse).Namespace &&
            WeatherPrefixes.Any(prefix => type.Name.StartsWith(prefix, StringComparison.Ordinal)))
        .ToArray();

    [Fact]
    public void WeatherContractsExposeNoLongNoEnumAndNoInternalId()
    {
        Assert.Equal(new HashSet<Type>
        {
            typeof(OccAerodromeWeatherResponse), typeof(OccWeatherSourceResponse), typeof(OccMetarResponse),
            typeof(OccCloudLayerResponse), typeof(OccTafResponse), typeof(OccTafPeriodResponse),
        }, WeatherContracts.ToHashSet());
        Assert.All(WeatherContracts, type => Assert.True(type.IsSealed, type.Name));
        var properties = WeatherContracts.SelectMany(type => type.GetProperties(BindingFlags.Instance | BindingFlags.Public))
            .ToArray();

        // No internal key, no enumeration, nothing secret.
        Assert.DoesNotContain(properties, property =>
            property.PropertyType == typeof(long) || property.PropertyType == typeof(long?) ||
            (Nullable.GetUnderlyingType(property.PropertyType) ?? property.PropertyType).IsEnum ||
            property.Name.Contains("Password", StringComparison.OrdinalIgnoreCase) ||
            property.Name.Contains("Token", StringComparison.OrdinalIgnoreCase) ||
            property.Name.Contains("Email", StringComparison.OrdinalIgnoreCase) ||
            property.Name.Contains("ApiKey", StringComparison.OrdinalIgnoreCase));
        // The only identifier a screen receives is the station's public UUID.
        Assert.Equal(["StationId"], properties.Where(property =>
            property.Name == "Id" || property.Name.EndsWith("Id", StringComparison.Ordinal)).Select(property => property.Name));
        Assert.Equal(typeof(Guid), typeof(OccAerodromeWeatherResponse).GetProperty("StationId")?.PropertyType);
        // The state is text from a closed list, and the answer says nothing of why or when to ask again: the state alone
        // tells the screens what they show.
        Assert.Equal(typeof(string), typeof(OccAerodromeWeatherResponse).GetProperty("Status")?.PropertyType);
        Assert.DoesNotContain(properties, property => property.Name is "Reason" or "RefreshAfterSeconds");
        // The credit is always there: name and home page.
        Assert.Equal(["Name", "HomeUrl"], typeof(OccWeatherSourceResponse).GetProperties().Select(property => property.Name));
        Assert.Equal(typeof(OccWeatherSourceResponse), typeof(OccAerodromeWeatherResponse).GetProperty("Source")?.PropertyType);
    }

    [Fact]
    public void TheWeatherIsOneReadUnderOccWeather()
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
        // One read: the operationId the snapshot publishes, its verb and no route of its own under occ/weather.
        var (read, http) = Assert.Single(actions);
        Assert.NotNull(http);
        Assert.Equal(("GetOccAerodromeWeather", "GET", (string?)null),
            (http.Name, Assert.Single(http.HttpMethods), http.Template));
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
