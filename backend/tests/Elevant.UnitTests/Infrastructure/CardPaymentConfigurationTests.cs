using Elevant.Application.Finance;
using Elevant.Infrastructure;
using Elevant.Infrastructure.Finance;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.UnitTests.Infrastructure;

/// <summary>
/// 4-N05: the card gateway is chosen by <c>CardPayments:Mode</c>. Disabled is the default, the simulated gateway only
/// runs in Development or Test and any other environment refuses to start with it, so a test card never settles a real
/// invoice in Production.
/// </summary>
public sealed class CardPaymentConfigurationTests
{
    private static IServiceCollection Compose(string environment, string? mode) =>
        new ServiceCollection().AddInfrastructure(new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?>
            {
                ["DOTNET_ENVIRONMENT"] = environment,
                [DependencyInjection.CardPaymentsModeKey] = mode,
            }).Build());

    private static (Type? Gateway, CardPaymentAvailability Availability) Composed(IServiceCollection services) =>
        (Assert.Single(services, item => item.ServiceType == typeof(ICardPaymentGateway)).ImplementationType,
            (CardPaymentAvailability)Assert.Single(services, item => item.ServiceType == typeof(CardPaymentAvailability))
                .ImplementationInstance!);

    [Theory]
    [InlineData("Development")]
    [InlineData("Test")]
    [InlineData("Testing")]
    public void TheSimulatedGatewayRunsOnlyInDevelopmentOrTest(string environment)
    {
        var (gateway, availability) = Composed(Compose(environment, "Simulated"));
        Assert.Equal(typeof(SimulatedCardGateway), gateway);
        Assert.Equal(new CardPaymentAvailability(true, true), availability);
    }

    [Theory]
    [InlineData("Production")]
    [InlineData("Staging")]
    [InlineData("Development ")]
    public void AnyOtherEnvironmentRefusesToStartWithTheSimulatedGateway(string environment)
    {
        var refused = Assert.Throws<InvalidOperationException>(() => Compose(environment, "simulated"));
        Assert.Contains("Development or Test", refused.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void WithoutAnEnvironmentTheApiIsProductionAndRefusesTheSimulation()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            [DependencyInjection.CardPaymentsModeKey] = "Simulated",
        }).Build();
        Assert.Throws<InvalidOperationException>(() => new ServiceCollection().AddInfrastructure(configuration));
    }

    [Theory]
    [InlineData("Production", null)]
    [InlineData("Production", "Disabled")]
    [InlineData("Development", null)]
    [InlineData("Development", " ")]
    [InlineData("Test", "disabled")]
    public void DisabledIsTheDefaultAndNeverAuthorizesACard(string environment, string? mode)
    {
        var (gateway, availability) = Composed(Compose(environment, mode));
        Assert.Equal(typeof(DisabledCardGateway), gateway);
        Assert.Equal(CardPaymentAvailability.Disabled, availability);
        Assert.False(availability.Available);
        Assert.Throws<InvalidOperationException>(() => new DisabledCardGateway().Authorize(
            new CardCharge("4111111111111111", 12, 2030, "123", 10m, "USD")));
    }

    [Theory]
    [InlineData("Real")]
    [InlineData("1")]
    [InlineData("Disabled,Simulated")]
    public void AnUnknownModeRefusesToStart(string mode) =>
        Assert.Throws<InvalidOperationException>(() => Compose("Development", mode));
}
