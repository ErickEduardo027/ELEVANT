using Elevant.Api.Controllers;

namespace Elevant.ArchitectureTests.Architecture;

/// <summary>
/// ADR-0042: the air traffic worker is only a host loop. It reaches the network through the Application's air picture,
/// never through an adapter or the database.
/// </summary>
public sealed class AirPictureArchitectureTests
{
    [Fact]
    public void TheAirTrafficWorkerDependsOnlyOnApplicationAbstractions()
    {
        var worker = typeof(DemoFlightsController).Assembly.GetType("Elevant.Api.Integration.AirTrafficPollWorker");
        Assert.NotNull(worker);
        Assert.All(Assert.Single(worker.GetConstructors()).GetParameters(), parameter =>
            Assert.True(parameter.ParameterType.Namespace is { } name &&
                (name == "System" || name.StartsWith("Microsoft.Extensions.", StringComparison.Ordinal) ||
                 name.StartsWith("Elevant.Application.", StringComparison.Ordinal)),
                $"{parameter.Name}: {parameter.ParameterType.FullName}"));
    }
}
