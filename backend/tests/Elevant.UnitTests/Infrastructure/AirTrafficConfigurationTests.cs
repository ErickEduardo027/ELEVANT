using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations.AirPicture;
using Elevant.Infrastructure;
using Elevant.Infrastructure.Integrations.AirTraffic;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.UnitTests.Infrastructure;

/// <summary>
/// ADR-0042 (contracts 1.3): the <c>AirTraffic</c> section. Off by default, and off with an empty list: nothing is
/// called. <c>AirTraffic:Providers</c> takes only AdsbFi and AdsbLol, in the order they are tried, and every value is
/// checked on every start, also while the section is off, so a wrong one stops the API instead of waiting for the day
/// it is switched on.
/// </summary>
public sealed class AirTrafficConfigurationTests
{
    [Theory]
    [InlineData(null, null)]
    [InlineData("false", "AdsbFi")]
    [InlineData("False", "AdsbLol")]
    public async Task DisabledIsTheDefaultAndNeverCalls(string? enabled, string? provider)
    {
        var values = new Dictionary<string, string?>();
        if (enabled is not null) values["AirTraffic:Enabled"] = enabled;
        if (provider is not null) values["AirTraffic:Providers:0"] = provider;

        var (descriptor, settings) = Composed(Compose(values));

        // The provider without a network is a plain type: no factory, no client, nothing that could send a request.
        Assert.Equal(typeof(UnconfiguredAirTrafficProvider), descriptor.ImplementationType);
        Assert.Null(descriptor.ImplementationFactory);
        Assert.Same(AirTrafficSettings.Disabled, settings);
        Assert.Equal(new AirTrafficSettings(false, "PUJ", 18.5674, -68.3634, 250, TimeSpan.FromSeconds(10),
            TimeSpan.FromSeconds(900), TimeSpan.FromMinutes(180)), settings);
        var unconfigured = new UnconfiguredAirTrafficProvider();
        Assert.False(unconfigured.IsConfigured);
        Assert.Null(unconfigured.Attribution);
        var read = await unconfigured.ReadAsync(settings.Area, TestContext.Current.CancellationToken);
        Assert.Equal((AirTrafficOutcome.Failed, (AirTrafficAttribution?)null, (DateTimeOffset?)null),
            (read.Outcome, read.Source, read.ObservedAt));
        Assert.Empty(read.Aircraft);
    }

    [Fact]
    public void EnabledWithoutProvidersIsDisabled()
    {
        var key = "synthetic-lol-key";
        var (descriptor, settings) = Composed(Compose(new()
        {
            ["AirTraffic:Enabled"] = "true",
            ["AirTraffic:ApiKey"] = key,
        }));

        Assert.Equal(typeof(UnconfiguredAirTrafficProvider), descriptor.ImplementationType);
        Assert.Same(AirTrafficSettings.Disabled, settings);
    }

    [Theory]
    [InlineData("true", "OpenSky")]
    [InlineData("true", "None")]
    [InlineData("true", "adsb.fi")]
    [InlineData("true", "AdsbFi,AdsbLol")]
    [InlineData("true", " ")]
    [InlineData("false", "AdsbExchange")]
    public void AnUnknownProviderRefusesToStart(string enabled, string name)
    {
        var refused = Assert.Throws<InvalidOperationException>(() => Compose(new()
        {
            ["AirTraffic:Enabled"] = enabled,
            ["AirTraffic:Providers:0"] = "AdsbFi",
            ["AirTraffic:Providers:1"] = name,
        }));

        Assert.Equal("AirTraffic:Providers accepts only AdsbFi and AdsbLol.", refused.Message);
    }

    [Fact]
    public void AProviderNamedTwiceOrAListWrittenAsOneValueRefusesToStart()
    {
        var twice = Assert.Throws<InvalidOperationException>(() => Compose(new()
        {
            ["AirTraffic:Enabled"] = "true",
            ["AirTraffic:Providers:0"] = "AdsbFi",
            ["AirTraffic:Providers:1"] = " adsbfi ",
        }));
        Assert.Equal("AirTraffic:Providers names a provider more than once.", twice.Message);

        // «AirTraffic__Providers=AdsbFi» would otherwise bind to an empty list and switch the traffic off unnoticed.
        var single = Assert.Throws<InvalidOperationException>(() => Compose(new()
        {
            ["AirTraffic:Enabled"] = "true",
            ["AirTraffic:Providers"] = "AdsbFi",
        }));
        Assert.StartsWith("AirTraffic:Providers must be a list", single.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("RadiusNm", "0", "AirTraffic:RadiusNm must be from 1 to 250.")]
    [InlineData("RadiusNm", "251", "AirTraffic:RadiusNm must be from 1 to 250.")]
    [InlineData("IntervalSeconds", "9", "AirTraffic:IntervalSeconds must be at least 10.")]
    [InlineData("IdleAfterSeconds", "9", "AirTraffic:IdleAfterSeconds must be at least AirTraffic:IntervalSeconds.")]
    [InlineData("TrailMinutes", "0", "AirTraffic:TrailMinutes must be from 1 to 180.")]
    [InlineData("TrailMinutes", "181", "AirTraffic:TrailMinutes must be from 1 to 180.")]
    [InlineData("CenterLatitude", "90.5", "AirTraffic:CenterLatitude and AirTraffic:CenterLongitude must be a position on Earth.")]
    [InlineData("CenterLongitude", "-180.5", "AirTraffic:CenterLatitude and AirTraffic:CenterLongitude must be a position on Earth.")]
    [InlineData("CenterLatitude", "NaN", "AirTraffic:CenterLatitude and AirTraffic:CenterLongitude must be a position on Earth.")]
    [InlineData("StationCode", " ", "AirTraffic:StationCode is required.")]
    public void OutOfRangeSettingsRefuseToStart(string setting, string value, string message)
    {
        foreach (var enabled in new[] { "true", "false" })
        {
            var refused = Assert.Throws<InvalidOperationException>(() => Compose(new()
            {
                ["AirTraffic:Enabled"] = enabled,
                ["AirTraffic:Providers:0"] = "AdsbFi",
                [$"AirTraffic:{setting}"] = value,
            }));
            Assert.Equal(message, refused.Message);
        }
    }

    [Fact]
    public void TheListOrderBuildsTheFailoverChain()
    {
        var key = "synthetic-lol-key";
        var (descriptor, settings) = Composed(Compose(new()
        {
            ["AirTraffic:Enabled"] = "true",
            ["AirTraffic:Providers:0"] = " adsblol ",
            ["AirTraffic:Providers:1"] = "AdsbFi",
            ["AirTraffic:StationCode"] = " puj ",
            ["AirTraffic:RadiusNm"] = "120",
            ["AirTraffic:IntervalSeconds"] = "15",
            ["AirTraffic:IdleAfterSeconds"] = "600",
            ["AirTraffic:TrailMinutes"] = "60",
            ["AirTraffic:ApiKey"] = key,
        }));

        Assert.Equal(new AirTrafficSettings(true, "PUJ", 18.5674, -68.3634, 120, TimeSpan.FromSeconds(15),
            TimeSpan.FromSeconds(600), TimeSpan.FromMinutes(60)), settings);
        var factory = descriptor.ImplementationFactory;
        Assert.NotNull(factory);
        using var failover = Assert.IsType<FailoverAirTrafficProvider>(factory(new OnlyTime()));
        var chain = failover.Chain.Select(provider => Assert.IsType<ReadsbAirTrafficProvider>(provider)).ToArray();
        Assert.Equal(["AdsbLol", "AdsbFi"], chain.Select(provider => provider.Profile.Name));
        // The key goes to adsb.lol only.
        Assert.Equal([true, false], chain.Select(provider => provider.SendsKey));
        Assert.True(failover.IsConfigured);
        Assert.Equal(ReadsbProfile.AdsbLol.Attribution, failover.Attribution);
    }

    private static IServiceCollection Compose(Dictionary<string, string?> values) =>
        new ServiceCollection().AddInfrastructure(new ConfigurationBuilder().AddInMemoryCollection(values).Build());

    private static (ServiceDescriptor Provider, AirTrafficSettings Settings) Composed(IServiceCollection services) =>
        (Assert.Single(services, item => item.ServiceType == typeof(IAirTrafficProvider)),
            (AirTrafficSettings)Assert.Single(services, item => item.ServiceType == typeof(AirTrafficSettings))
                .ImplementationInstance!);

    /// <summary>The one service the provider's factory asks for.</summary>
    private sealed class OnlyTime : IServiceProvider
    {
        public object? GetService(Type serviceType) => serviceType == typeof(TimeProvider) ? TimeProvider.System : null;
    }
}
