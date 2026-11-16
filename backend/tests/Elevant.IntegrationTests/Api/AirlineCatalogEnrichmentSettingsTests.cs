using Microsoft.Extensions.Configuration;

namespace Elevant.IntegrationTests.Api;

/// <summary>The Development image copies the fictitious demo RNCs; Production and the shared settings never do.</summary>
public sealed class AirlineCatalogEnrichmentSettingsTests
{
    [Fact]
    public void OnlyTheDevelopmentSettingsTurnTheDemoRncsOn()
    {
        static string? Include(string file) => new ConfigurationBuilder()
            .AddJsonFile(Path.Combine(AppContext.BaseDirectory, file), optional: false).Build()[
                Elevant.Infrastructure.DependencyInjection.DevelopmentTaxRegistrationsKey];

        Assert.Equal("True", Include("appsettings.Development.json"), ignoreCase: true);
        Assert.Equal("False", Include("appsettings.Production.json"), ignoreCase: true);
        Assert.Null(Include("appsettings.json"));
        Assert.Null(Include("appsettings.Testing.json"));
    }
}
