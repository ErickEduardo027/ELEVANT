using Elevant.Application;
using Elevant.Application.Abstractions.Operations;
using Elevant.Infrastructure;
using Elevant.Infrastructure.Integrations.AviationWeather;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.UnitTests.Infrastructure;

/// <summary>
/// ADR-0043 (contracts 1.4): the <c>AviationWeather</c> section. Off by default, and then nothing is ever called. On, the
/// source is built only when it is first resolved and asks the service only when someone reads an airport's weather, so
/// the API starts without a network. <c>AviationWeather:BaseUrl</c> is checked on every start, also while it is off.
/// </summary>
public sealed class AviationWeatherConfigurationTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("false")]
    [InlineData("False")]
    public async Task OffByDefaultRegistersTheDisabledSourceAndCallsNothing(string? enabled)
    {
        var values = new Dictionary<string, string?>();
        if (enabled is not null) values["AviationWeather:Enabled"] = enabled;

        var descriptor = Registered(Compose(values));

        // A plain type: no factory, no client, nothing that could send a request.
        Assert.Equal((typeof(DisabledAerodromeWeatherSource), ServiceLifetime.Singleton),
            (descriptor.ImplementationType, descriptor.Lifetime));
        Assert.Null(descriptor.ImplementationFactory);
        Assert.Null(await new DisabledAerodromeWeatherSource().ReadAsync("MDPC", TestContext.Current.CancellationToken));

        // The region's weather (plan M6) follows the same switch.
        var region = RegisteredRegion(Compose(values));
        Assert.Equal((typeof(DisabledRegionWeatherSource), ServiceLifetime.Singleton), (region.ImplementationType, region.Lifetime));
        Assert.Null(region.ImplementationFactory);
        Assert.Null(await new DisabledRegionWeatherSource().ReadAsync(["MDPC"], TestContext.Current.CancellationToken));
    }

    [Fact]
    public void EnabledRegistersTheSourceWithoutCallingIt()
    {
        var descriptor = Registered(Compose(new() { ["AviationWeather:Enabled"] = "true" }));

        // A factory: the source and its client are built only when the source is first resolved, and building them sends
        // nothing; a request leaves only when someone reads an airport's weather.
        Assert.Equal(((Type?)null, ServiceLifetime.Singleton), (descriptor.ImplementationType, descriptor.Lifetime));
        var factory = descriptor.ImplementationFactory;
        Assert.NotNull(factory);
        using var source = Assert.IsType<AviationWeatherSource>(factory(new OnlyTime()));
        Assert.Equal("https://aviationweather.gov/api/data/", source.BaseUrl.AbsoluteUri);

        // The region's weather (plan M6): its own source, client and memory, built the same way and sending nothing.
        var region = RegisteredRegion(Compose(new() { ["AviationWeather:Enabled"] = "true" }));
        Assert.Equal(((Type?)null, ServiceLifetime.Singleton), (region.ImplementationType, region.Lifetime));
        Assert.NotNull(region.ImplementationFactory);
        using var regionSource = Assert.IsType<AviationWeatherRegionSource>(region.ImplementationFactory(new OnlyTime()));
        Assert.Equal("https://aviationweather.gov/api/data/", regionSource.BaseUrl.AbsoluteUri);
    }

    [Theory]
    [InlineData("http://aviationweather.gov/api/data/")]
    [InlineData("aviationweather.gov/api/data/")]
    [InlineData("/api/data/")]
    [InlineData("ftp://aviationweather.gov/api/data/")]
    [InlineData("https://aviationweather.gov/api/data/?format=json")]
    [InlineData("https://aviationweather.gov/api/data/#metar")]
    [InlineData("")]
    [InlineData(" ")]
    public void TheBaseUrlMustBeAnAbsoluteHttpsAddress(string baseUrl)
    {
        foreach (var enabled in new[] { "true", "false" })
        {
            var refused = Assert.Throws<InvalidOperationException>(() => Compose(new()
            {
                ["AviationWeather:Enabled"] = enabled,
                ["AviationWeather:BaseUrl"] = baseUrl,
            }));
            Assert.Equal("AviationWeather:BaseUrl must be an absolute https address.", refused.Message);
        }
    }

    [Theory]
    [InlineData("https://aviationweather.gov/api/data")]
    [InlineData(" https://aviationweather.gov/api/data ")]
    [InlineData("HTTPS://AVIATIONWEATHER.GOV/api/data")]
    public void ABaseUrlWithoutItsSlashStillReachesTheDataApi(string baseUrl)
    {
        var descriptor = Registered(Compose(new()
        {
            ["AviationWeather:Enabled"] = "true",
            ["AviationWeather:BaseUrl"] = baseUrl,
        }));
        var factory = descriptor.ImplementationFactory;
        Assert.NotNull(factory);
        using var source = Assert.IsType<AviationWeatherSource>(factory(new OnlyTime()));

        // Without the slash the queries would replace «data» instead of following it.
        Assert.Equal("https://aviationweather.gov/api/data/", source.BaseUrl.AbsoluteUri);
        Assert.Equal("https://aviationweather.gov/api/data/metar?ids=MDPC&format=json", source.MetarQuery("MDPC").AbsoluteUri);
        Assert.Equal("https://aviationweather.gov/api/data/taf?ids=MDPC&format=json", source.TafQuery("MDPC").AbsoluteUri);

        // The same for the region's queries.
        var regionFactory = RegisteredRegion(Compose(new()
        {
            ["AviationWeather:Enabled"] = "true",
            ["AviationWeather:BaseUrl"] = baseUrl,
        })).ImplementationFactory;
        Assert.NotNull(regionFactory);
        using var region = Assert.IsType<AviationWeatherRegionSource>(regionFactory(new OnlyTime()));
        Assert.Equal("https://aviationweather.gov/api/data/metar?ids=MDPC,MDSD&format=json",
            region.MetarQuery(["MDSD", "MDPC"]).AbsoluteUri);
        Assert.Equal("https://aviationweather.gov/api/data/taf?ids=MDPC,MDSD&format=json",
            region.TafQuery(["MDSD", "MDPC"]).AbsoluteUri);
    }

    /// <summary>
    /// Without Infrastructure (tools, tests) there is no <c>AviationWeather</c> section: the source is the disabled one,
    /// and a host that registered its own keeps it.
    /// </summary>
    [Fact]
    public void WithoutInfrastructureTheApplicationKeepsTheDisabledSource()
    {
        var byDefault = Assert.Single(new ServiceCollection().AddApplication(),
            item => item.ServiceType == typeof(IAerodromeWeatherSource));
        Assert.Equal(typeof(DisabledAerodromeWeatherSource), byDefault.ImplementationType);

        var own = new DisabledAerodromeWeatherSource();
        var kept = Assert.Single(new ServiceCollection().AddSingleton<IAerodromeWeatherSource>(own).AddApplication(),
            item => item.ServiceType == typeof(IAerodromeWeatherSource));
        Assert.Same(own, kept.ImplementationInstance);

        // The same for the region's weather (plan M6).
        var regionByDefault = Assert.Single(new ServiceCollection().AddApplication(),
            item => item.ServiceType == typeof(IRegionWeatherSource));
        Assert.Equal(typeof(DisabledRegionWeatherSource), regionByDefault.ImplementationType);
        var ownRegion = new DisabledRegionWeatherSource();
        var keptRegion = Assert.Single(new ServiceCollection().AddSingleton<IRegionWeatherSource>(ownRegion).AddApplication(),
            item => item.ServiceType == typeof(IRegionWeatherSource));
        Assert.Same(ownRegion, keptRegion.ImplementationInstance);
    }

    /// <summary>
    /// Plan M6: the region's SIGMETs follow <c>AviationWeather:Enabled</c>; the wind grid has its own switch,
    /// <c>OpenMeteo:Enabled</c> (the free tier is non-commercial), and the radar frames <c>WeatherRadar:Enabled</c>. Off by
    /// default, and then the disabled source; on, a factory that sends nothing until someone reads the layer.
    /// </summary>
    [Fact]
    public void TheRegionLayersHaveTheirOwnSwitchesOffByDefault()
    {
        var off = Compose(new());
        Assert.Equal(typeof(DisabledRegionSigmetSource), Layer<IRegionSigmetSource>(off).ImplementationType);
        Assert.Equal(typeof(DisabledRegionWindSource), Layer<IRegionWindSource>(off).ImplementationType);
        Assert.Equal(typeof(DisabledRegionRadarSource), Layer<IRegionRadarSource>(off).ImplementationType);

        // The METARs' switch turns the SIGMETs on, never the wind or the radar.
        var weatherOnly = Compose(new() { ["AviationWeather:Enabled"] = "true" });
        using (var sigmets = Assert.IsType<AviationWeatherSigmetSource>(
                   Layer<IRegionSigmetSource>(weatherOnly).ImplementationFactory!(new OnlyTime())))
            Assert.Equal("https://aviationweather.gov/api/data/isigmet?format=json", sigmets.Query.AbsoluteUri);
        Assert.Equal(typeof(DisabledRegionWindSource), Layer<IRegionWindSource>(weatherOnly).ImplementationType);
        Assert.Equal(typeof(DisabledRegionRadarSource), Layer<IRegionRadarSource>(weatherOnly).ImplementationType);

        var all = Compose(new() { ["OpenMeteo:Enabled"] = "true", ["WeatherRadar:Enabled"] = "true" });
        Assert.Equal(typeof(DisabledRegionSigmetSource), Layer<IRegionSigmetSource>(all).ImplementationType);
        var windDescriptor = Layer<IRegionWindSource>(all);
        Assert.Equal(((Type?)null, ServiceLifetime.Singleton), (windDescriptor.ImplementationType, windDescriptor.Lifetime));
        using (var wind = Assert.IsType<Elevant.Infrastructure.Integrations.OpenMeteo.OpenMeteoWindSource>(
                   windDescriptor.ImplementationFactory!(new OnlyTime())))
            Assert.Equal("https://api.open-meteo.com/v1/", wind.BaseUrl.AbsoluteUri);
        using (var radar = Assert.IsType<Elevant.Infrastructure.Integrations.WeatherRadar.IemRadarSource>(
                   Layer<IRegionRadarSource>(all).ImplementationFactory!(new OnlyTime())))
            Assert.Equal("https://mesonet.agron.iastate.edu/", radar.BaseUrl.AbsoluteUri);
    }

    [Theory]
    [InlineData("OpenMeteo")]
    [InlineData("WeatherRadar")]
    public void TheLayerAddressesMustBeAbsoluteHttpsAddresses(string section)
    {
        foreach (var enabled in new[] { "true", "false" })
        {
            var refused = Assert.Throws<InvalidOperationException>(() => Compose(new()
            {
                [$"{section}:Enabled"] = enabled,
                [$"{section}:BaseUrl"] = "http://example.test/",
            }));
            Assert.Equal($"{section}:BaseUrl must be an absolute https address.", refused.Message);
        }
    }

    /// <summary>Without Infrastructure the layers' sources are the disabled ones, and nothing is called.</summary>
    [Fact]
    public async Task WithoutInfrastructureTheLayersAreDisabled()
    {
        var services = new ServiceCollection().AddApplication();
        Assert.Equal(typeof(DisabledRegionSigmetSource), Layer<IRegionSigmetSource>(services).ImplementationType);
        Assert.Equal(typeof(DisabledRegionWindSource), Layer<IRegionWindSource>(services).ImplementationType);
        Assert.Equal(typeof(DisabledRegionRadarSource), Layer<IRegionRadarSource>(services).ImplementationType);
        var area = Elevant.Application.Operations.Weather.RegionWeatherStations.PuntaCanaArea;
        Assert.Null(await new DisabledRegionSigmetSource().ReadAsync(area, TestContext.Current.CancellationToken));
        Assert.Null(await new DisabledRegionWindSource().ReadAsync(area, TestContext.Current.CancellationToken));
        Assert.Null(await new DisabledRegionRadarSource().ReadAsync(area, TestContext.Current.CancellationToken));
    }

    private static ServiceDescriptor Layer<T>(IServiceCollection services) =>
        Assert.Single(services, item => item.ServiceType == typeof(T));

    private static IServiceCollection Compose(Dictionary<string, string?> values) =>
        new ServiceCollection().AddInfrastructure(new ConfigurationBuilder().AddInMemoryCollection(values).Build());

    private static ServiceDescriptor Registered(IServiceCollection services) =>
        Assert.Single(services, item => item.ServiceType == typeof(IAerodromeWeatherSource));

    private static ServiceDescriptor RegisteredRegion(IServiceCollection services) =>
        Assert.Single(services, item => item.ServiceType == typeof(IRegionWeatherSource));

    /// <summary>The one service the source's factory asks for.</summary>
    private sealed class OnlyTime : IServiceProvider
    {
        public object? GetService(Type serviceType) => serviceType == typeof(TimeProvider) ? TimeProvider.System : null;
    }
}
