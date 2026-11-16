using Elevant.Application.Abstractions.Commercial;
using Elevant.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.UnitTests.Infrastructure;

/// <summary>
/// The FICTITIOUS demo RNCs «Completar fichas AVIAM» may copy are off by default and only Development or Test may
/// turn them on: any other environment refuses to start with them, so they never reach a Production database.
/// </summary>
public sealed class DevelopmentTaxRegistrationConfigurationTests
{
    private static IServiceCollection Compose(string? environment, string? include)
    {
        var values = new Dictionary<string, string?> { [DependencyInjection.DevelopmentTaxRegistrationsKey] = include };
        if (environment is not null) values["DOTNET_ENVIRONMENT"] = environment;
        return new ServiceCollection().AddInfrastructure(new ConfigurationBuilder().AddInMemoryCollection(values).Build());
    }

    private static AirlineCatalogEnrichmentSettings Composed(IServiceCollection services) =>
        (AirlineCatalogEnrichmentSettings)Assert.Single(services,
            item => item.ServiceType == typeof(AirlineCatalogEnrichmentSettings)).ImplementationInstance!;

    [Theory]
    [InlineData("Production", null)]
    [InlineData("Development", null)]
    [InlineData("Development", " ")]
    [InlineData("Production", "false")]
    [InlineData("Test", "False")]
    public void TheDemoRncsAreOffByDefault(string environment, string? include) =>
        Assert.False(Composed(Compose(environment, include)).IncludeDevelopmentTaxRegistrations);

    [Theory]
    [InlineData("Development", "true")]
    [InlineData("Test", "True")]
    [InlineData("Testing", " TRUE ")]
    public void OnlyDevelopmentOrTestTurnsThemOn(string environment, string include) =>
        Assert.True(Composed(Compose(environment, include)).IncludeDevelopmentTaxRegistrations);

    [Theory]
    [InlineData("Production")]
    [InlineData("Staging")]
    [InlineData(null)]
    public void AnyOtherEnvironmentRefusesToStartWithThem(string? environment)
    {
        var refused = Assert.Throws<InvalidOperationException>(() => Compose(environment, "true"));
        Assert.Equal("Development tax registrations require Development or Test.", refused.Message);
    }

    [Theory]
    [InlineData("1")]
    [InlineData("yes")]
    [InlineData("Enabled")]
    public void AnythingButTrueOrFalseRefusesToStart(string include) =>
        Assert.Throws<InvalidOperationException>(() => Compose("Development", include));
}
