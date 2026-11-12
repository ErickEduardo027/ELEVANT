using Elevant.Application.Integration.DemoFlights;
using Elevant.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.UnitTests.Infrastructure;

/// <summary>
/// ADR-0041: demo flights are chosen by <c>DemoFlights:Mode</c>. Disabled is the default, Enabled only runs in
/// Development or Test and any other environment refuses to start with it, so a demo flight never reaches a
/// Production database.
/// </summary>
public sealed class DemoFlightConfigurationTests
{
    private static IServiceCollection Compose(string environment, string? mode) =>
        new ServiceCollection().AddInfrastructure(new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?>
            {
                ["DOTNET_ENVIRONMENT"] = environment,
                [DependencyInjection.DemoFlightsModeKey] = mode,
            }).Build());

    private static DemoFlightAvailability Composed(IServiceCollection services) =>
        (DemoFlightAvailability)Assert.Single(services, item => item.ServiceType == typeof(DemoFlightAvailability))
            .ImplementationInstance!;

    [Theory]
    [InlineData("Development", "Enabled")]
    [InlineData("Test", "enabled")]
    [InlineData("Testing", " ENABLED ")]
    public void DemoFlightsRunOnlyInDevelopmentTestOrTesting(string environment, string mode)
    {
        var availability = Composed(Compose(environment, mode));
        Assert.Same(DemoFlightAvailability.On, availability);
        Assert.True(availability.Enabled);
    }

    [Theory]
    [InlineData("Production")]
    [InlineData("Staging")]
    [InlineData("Development ")]
    public void AnyOtherEnvironmentRefusesToStartWithDemoFlights(string environment)
    {
        var refused = Assert.Throws<InvalidOperationException>(() => Compose(environment, "Enabled"));
        Assert.Equal("Demo flights require Development or Test.", refused.Message);
    }

    [Fact]
    public void WithoutAnEnvironmentTheApiIsProductionAndRefusesThem()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            [DependencyInjection.DemoFlightsModeKey] = "Enabled",
        }).Build();
        var refused = Assert.Throws<InvalidOperationException>(() => new ServiceCollection().AddInfrastructure(configuration));
        Assert.Contains("Development or Test", refused.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("Production", null)]
    [InlineData("Production", "Disabled")]
    [InlineData("Development", null)]
    [InlineData("Development", " ")]
    [InlineData("Test", "disabled")]
    public void DisabledIsTheDefault(string environment, string? mode)
    {
        var availability = Composed(Compose(environment, mode));
        Assert.Same(DemoFlightAvailability.Disabled, availability);
        Assert.False(availability.Enabled);
    }

    [Theory]
    [InlineData("On")]
    [InlineData("true")]
    [InlineData("1")]
    [InlineData("Disabled,Enabled")]
    public void AnUnknownModeRefusesToStart(string mode)
    {
        var refused = Assert.Throws<InvalidOperationException>(() => Compose("Development", mode));
        Assert.Equal("DemoFlights:Mode must be Disabled or Enabled.", refused.Message);
    }
}
