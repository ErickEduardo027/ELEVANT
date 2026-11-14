using System.Reflection;
using Elevant.Api.Configuration;
using Elevant.Api.Controllers;
using Elevant.Contracts.Operations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;

namespace Elevant.ArchitectureTests.Architecture;

/// <summary>
/// ADR-0042 (contracts 1.3): the OCC map is three reads under <c>occ/map</c> for authenticated sessions with private
/// responses; its contracts expose public identifiers only, no <c>long</c> and no enumeration, and never the geometry of a
/// stand or a runway (the map decides where). The air traffic worker reaches the network only through the Application's
/// air picture, never through an adapter or the database.
/// </summary>
public sealed class OccMapContractSafetyTests
{
    private static readonly Type[] MapContracts = typeof(OccMapFlightsResponse).Assembly.GetTypes()
        .Where(type => type.Namespace == typeof(OccMapFlightsResponse).Namespace &&
            (type.Name.StartsWith("OccMap", StringComparison.Ordinal) ||
             type.Name.StartsWith("OccAirPicture", StringComparison.Ordinal) ||
             type.Name.StartsWith("OccAirTraffic", StringComparison.Ordinal) ||
             type.Name.StartsWith("OccAirTrail", StringComparison.Ordinal) ||
             type.Name.StartsWith("OccAircraftTrack", StringComparison.Ordinal)))
        .ToArray();

    [Fact]
    public void MapContractsExposeOnlyPublicIdsAndNoLong()
    {
        Assert.Equal(new HashSet<Type>
        {
            typeof(OccAirPictureResponse), typeof(OccAirTrafficSourceResponse), typeof(OccAirPictureCenterResponse),
            typeof(OccAirPictureAircraftResponse), typeof(OccAirTrailPointResponse), typeof(OccAircraftTrackResponse),
            typeof(OccMapFlightsResponse), typeof(OccMapFlightResponse), typeof(OccMapAirlineResponse),
            typeof(OccMapAirportResponse), typeof(OccMapAircraftResponse), typeof(OccMapTurnaroundResponse),
            typeof(OccMapStandResponse), typeof(OccMapMilestoneResponse), typeof(OccMapDemoResponse),
        }, MapContracts.ToHashSet());
        var properties = MapContracts.SelectMany(type => type.GetProperties(BindingFlags.Instance | BindingFlags.Public))
            .ToArray();

        // No internal key, no enumeration (states and phases travel as text), nothing secret.
        Assert.DoesNotContain(properties, property =>
            property.PropertyType == typeof(long) || property.PropertyType == typeof(long?) ||
            (Nullable.GetUnderlyingType(property.PropertyType) ?? property.PropertyType).IsEnum ||
            property.Name.Contains("Password", StringComparison.OrdinalIgnoreCase) ||
            property.Name.Contains("Token", StringComparison.OrdinalIgnoreCase) ||
            property.Name.Contains("Email", StringComparison.OrdinalIgnoreCase) ||
            property.Name.Contains("ApiKey", StringComparison.OrdinalIgnoreCase));
        // Every identifier a screen receives is a public UUID; the map's own keys are opaque texts.
        Assert.All(properties.Where(property => property.Name == "Id" || property.Name.EndsWith("Id", StringComparison.Ordinal)),
            property => Assert.True(property.PropertyType == typeof(Guid) || property.PropertyType == typeof(Guid?),
                $"{property.DeclaringType!.Name}.{property.Name}"));
        foreach (var name in new[] { "FlightKey", "VisitKey" })
            Assert.Equal(typeof(string), typeof(OccMapFlightResponse).GetProperty(name)?.PropertyType);
        // The map decides where: no runway anywhere, and a stand carries its code, never its geometry.
        Assert.DoesNotContain(properties, property => property.Name.Contains("Runway", StringComparison.OrdinalIgnoreCase));
        Assert.Equal(["Id", "Code", "TerminalCode"], typeof(OccMapStandResponse).GetProperties().Select(property => property.Name));
        // An aircraft names its flight by the flight's key and how it was recognised, not by a nested object.
        Assert.Equal((typeof(string), typeof(string)), (
            typeof(OccAirPictureAircraftResponse).GetProperty("MatchedFlightKey")?.PropertyType,
            typeof(OccAirPictureAircraftResponse).GetProperty("MatchedBy")?.PropertyType));
    }

    [Fact]
    public void MapRoutesAreThreeReadsUnderOccMap()
    {
        var controller = typeof(OccMapController);
        var route = Assert.Single(controller.GetCustomAttributes<RouteAttribute>(inherit: false));
        Assert.Equal("api/v{version:apiVersion}/occ/map", route.Template);
        Assert.Single(controller.GetCustomAttributes<AuthorizeAttribute>(inherit: false));
        Assert.Single(controller.GetCustomAttributes<PrivateResponseAttribute>(inherit: false));
        Assert.Empty(controller.GetCustomAttributes<AllowAnonymousAttribute>(inherit: true));
        // A malformed query answers the map's coded 400, not the framework's uncoded validation problem.
        Assert.Single(controller.GetCustomAttributes(inherit: false),
            attribute => attribute.GetType().Name == "OccMapProblemDetailsAttribute");

        var actions = controller.GetMethods(BindingFlags.Instance | BindingFlags.Public | BindingFlags.DeclaredOnly)
            .Select(method => (Method: method, Http: method.GetCustomAttribute<HttpMethodAttribute>()))
            .ToArray();
        Assert.All(actions, action => Assert.NotNull(action.Http));
        // The operationIds the snapshot publishes, their verbs and their routes under occ/map: reads only.
        Assert.Equal(
            [
                "GetOccAirPicture GET air-picture",
                "GetOccAircraftTrack GET aircraft/{hex}/track",
                "GetOccMapFlights GET flights",
            ],
            actions.Select(item => $"{item.Http!.Name} {Assert.Single(item.Http.HttpMethods)} {item.Http.Template}")
                .Order(StringComparer.Ordinal));
        Assert.All(actions.Select(item => item.Method), read =>
        {
            Assert.DoesNotContain(read.GetParameters(), parameter =>
                parameter.GetCustomAttribute<FromBodyAttribute>() is not null ||
                parameter.GetCustomAttribute<FromHeaderAttribute>() is not null ||
                // The account, the station scope and the authority come from the session, never from the request.
                parameter.Name is "accountId" or "actorId" or "organizationId");
            // Every refusal is a Problem Details: 400, 401, 403 and 404 are declared besides the 200.
            Assert.Equal([200, 400, 401, 403, 404], read.GetCustomAttributes<ProducesResponseTypeAttribute>()
                .Select(attribute => attribute.StatusCode).Order());
        });
    }

    [Fact]
    public void ThePollWorkerDependsOnlyOnApplicationAbstractions()
    {
        var worker = typeof(OccMapController).Assembly.GetType("Elevant.Api.Integration.AirTrafficPollWorker");
        Assert.NotNull(worker);
        Assert.All(Assert.Single(worker.GetConstructors()).GetParameters(), parameter =>
            Assert.True(parameter.ParameterType.Namespace is { } name &&
                (name == "System" || name.StartsWith("Microsoft.Extensions.", StringComparison.Ordinal) ||
                 name.StartsWith("Elevant.Application.", StringComparison.Ordinal)),
                $"{parameter.Name}: {parameter.ParameterType.FullName}"));
    }
}
