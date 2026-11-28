using Elevant.Infrastructure.Authentication;
using Elevant.Application.Finance;
using Elevant.Domain.Enumerations;
using Elevant.Application.Abstractions.Finance;
using Elevant.Infrastructure.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Infrastructure.Operations;
using Elevant.Infrastructure.Commercial;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Infrastructure.Integrations.AirTraffic;
using Elevant.Infrastructure.Integrations.AviationWeather;
using Elevant.Infrastructure.Integrations.FlightAware;
using Elevant.Infrastructure.Integrations.OpenSky;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Integration.DemoFlights;
using Elevant.Application.Operations.AirPicture;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.Infrastructure;

/// <summary>Registers infrastructure implementations and owned resources.</summary>
public static class DependencyInjection
{
    /// <summary>Adds external-provider configuration shells.</summary>
    public static IServiceCollection AddInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        // 4-A, 4-N20: the fiscal simulation and the XML preflight were retired with «Documentos fiscales»; the
        // simulated e-CF of the invoice (ADR-0035) needs no FinanceFiscal configuration.
        // The host key «environment» is what WebApplicationFactory.UseEnvironment sets; the variables win when present.
        var environment = configuration["DOTNET_ENVIRONMENT"] ?? configuration["ASPNETCORE_ENVIRONMENT"] ??
            configuration["environment"] ?? "Production";
        services.AddFlightAwareShell(configuration);
        // Paid flight feed (ADR-0028): only the synchronizer calls it, within the unit budget.
        var aeroDataBox = configuration.GetSection(Elevant.Infrastructure.Integrations.AeroDataBox.AeroDataBoxOptions.SectionName)
            .Get<Elevant.Infrastructure.Integrations.AeroDataBox.AeroDataBoxOptions>() ?? new();
        services.AddSingleton(new Elevant.Application.Integration.FlightFeedBudget(
            Math.Max(0, aeroDataBox.DailyUnitLimit), Math.Max(0, aeroDataBox.MonthlyUnitLimit)));
        // The simulated feed (2-B) is opt-in, only for Development or Test and never next to AeroDataBox.
        var simulatedFeed = configuration.GetSection(Integrations.SimulatedFlightFeed.SimulatedFlightFeedOptions.SectionName)
            .Get<Integrations.SimulatedFlightFeed.SimulatedFlightFeedOptions>() ?? new();
        if (simulatedFeed.Enabled)
        {
            if (environment is not ("Development" or "Test"))
                throw new InvalidOperationException("The simulated flight feed requires Development or Test.");
            if (aeroDataBox.Enabled)
                throw new InvalidOperationException("The simulated flight feed cannot run while AeroDataBox is enabled.");
            services.AddSingleton<Elevant.Application.Abstractions.Integrations.IAirportFlightFeed,
                Integrations.SimulatedFlightFeed.SimulatedAirportFlightFeed>();
        }
        else if (aeroDataBox.Enabled && !string.IsNullOrWhiteSpace(aeroDataBox.ApiKey))
            services.AddSingleton<Elevant.Application.Abstractions.Integrations.IAirportFlightFeed>(_ =>
                new Elevant.Infrastructure.Integrations.AeroDataBox.AeroDataBoxAirportFlightFeed(
                    new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(20) },
                    aeroDataBox));
        else
            services.AddSingleton<Elevant.Application.Abstractions.Integrations.IAirportFlightFeed,
                Elevant.Infrastructure.Integrations.AeroDataBox.DisabledAirportFlightFeed>();
        AddAviationReference(services, aeroDataBox);
        var openSky = configuration.GetSection(OpenSkyOptions.SectionName).Get<OpenSkyOptions>() ?? new OpenSkyOptions();
        services.AddSingleton<IOccAircraftTrafficSource>(provider =>
            new OpenSkyAircraftTrafficSource(
                new HttpClient(new HttpClientHandler { AllowAutoRedirect = false })
                { Timeout = TimeSpan.FromSeconds(10) },
                openSky,
                provider.GetRequiredService<TimeProvider>()));
        AddAirTraffic(services, configuration);
        AddAviationWeather(services, configuration);
        // Public airline registries, asked in this order (ADR-0023).
        services.AddSingleton<Elevant.Application.Abstractions.Commercial.IAirlineRegistrySource>(_ =>
            new Elevant.Infrastructure.Integrations.AirlineRegistry.WikidataAirlineRegistrySource(
                new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(8) }));
        services.AddSingleton<Elevant.Application.Abstractions.Commercial.IAirlineRegistrySource,
            Elevant.Infrastructure.Integrations.AirlineRegistry.OpenFlightsAirlineRegistrySource>();
        services.AddSingleton<Elevant.Application.Abstractions.Commercial.IAirlineRegistryLookup,
            Elevant.Application.Commercial.AirlineRegistryLookup>();
        services.AddJwtAccessTokens(configuration);
        services.AddSingleton<FinancialDocumentPdfRenderer>();
        services.AddSingleton<IFinancialDocumentPdfRenderer>(provider => provider.GetRequiredService<FinancialDocumentPdfRenderer>());
        services.AddSingleton<IStatementDocumentRenderer>(provider => provider.GetRequiredService<FinancialDocumentPdfRenderer>());
        AddCardPayments(services, configuration, environment);
        AddDemoFlights(services, configuration, environment);
        AddAirlineCatalogEnrichment(services, configuration, environment);
        services.AddSingleton<Elevant.Application.Abstractions.Documents.IReportRenderer, Documents.ReportRenderer>();
        services.Configure<Elevant.Infrastructure.Messaging.SmtpOptions>(configuration.GetSection(Elevant.Infrastructure.Messaging.SmtpOptions.SectionName));
        services.AddSingleton<Elevant.Application.Abstractions.Messaging.IEmailSender, Elevant.Infrastructure.Messaging.SmtpEmailSender>();
        services.AddSingleton<IContractPdfRenderer, ContractPdfRenderer>();
        services.AddSingleton<Elevant.Application.Operations.IOperationDocumentPdfRenderer, Operations.OperationDocumentPdfRenderer>();

        return services;
    }

    /// <summary>
    /// ADR-0028 (note of 15 November 2026): the on-demand reference reads (airline fleet, aircraft by registration, daily
    /// routes, current delays) use the feed's key and run only while AeroDataBox is enabled with a key; otherwise the
    /// provider is the unconfigured one and nothing is ever called. A negative cap stops the start.
    /// </summary>
    private static void AddAviationReference(IServiceCollection services,
        Elevant.Infrastructure.Integrations.AeroDataBox.AeroDataBoxOptions options)
    {
        int[] caps =
        [
            options.PlanMonthlyUnitLimit, options.FleetDailyUnitLimit, options.FleetMonthlyUnitLimit,
            options.AircraftDailyUnitLimit, options.AircraftMonthlyUnitLimit, options.RoutesDailyUnitLimit,
            options.RoutesMonthlyUnitLimit, options.DelaysDailyUnitLimit, options.DelaysMonthlyUnitLimit,
        ];
        if (caps.Any(cap => cap < 0))
            throw new InvalidOperationException("The AeroDataBox reference caps must be zero or more.");
        var defaults = Elevant.Application.Integration.AviationReference.AviationReferenceLimits.Default;
        services.AddSingleton(new Elevant.Application.Integration.AviationReference.AviationReferenceLimits(
            defaults.AirlineFleet with { DailyUnits = options.FleetDailyUnitLimit, MonthlyUnits = options.FleetMonthlyUnitLimit },
            defaults.Aircraft with { DailyUnits = options.AircraftDailyUnitLimit, MonthlyUnits = options.AircraftMonthlyUnitLimit },
            defaults.AirportRoutes with { DailyUnits = options.RoutesDailyUnitLimit, MonthlyUnits = options.RoutesMonthlyUnitLimit },
            defaults.AirportDelays with { DailyUnits = options.DelaysDailyUnitLimit, MonthlyUnits = options.DelaysMonthlyUnitLimit },
            options.PlanMonthlyUnitLimit, options.DelaysEnabled));
        if (options.Enabled && !string.IsNullOrWhiteSpace(options.ApiKey))
            services.AddSingleton<Elevant.Application.Abstractions.Integrations.IAviationReferenceProvider>(_ =>
                new Elevant.Infrastructure.Integrations.AeroDataBox.AeroDataBoxReferenceProvider(
                    new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(15) },
                    options));
        else
            services.AddSingleton<Elevant.Application.Abstractions.Integrations.IAviationReferenceProvider,
                Elevant.Application.Abstractions.Integrations.UnconfiguredAviationReferenceProvider>();
    }

    /// <summary>Configuration section of the card gateway (4-N05).</summary>
    public const string CardPaymentsModeKey = "CardPayments:Mode";

    /// <summary>
    /// 4-N05: the card gateway is chosen explicitly. <c>CardPayments:Mode</c> is Disabled by default; Simulated
    /// (ADR-0036) only runs in Development or Test, so a Production API with it never starts. Without a gateway the
    /// portal shows card payment as unavailable and every payment is refused before the card is checked.
    /// </summary>
    private static void AddCardPayments(IServiceCollection services, IConfiguration configuration, string environment)
    {
        var configured = configuration[CardPaymentsModeKey]?.Trim();
        // Only the exact names: no numbers and no flag combinations.
        var mode = string.IsNullOrEmpty(configured) ? CardPaymentMode.Disabled
            : Enum.GetValues<CardPaymentMode>().Cast<CardPaymentMode?>().SingleOrDefault(value =>
                  string.Equals(value.ToString(), configured, StringComparison.OrdinalIgnoreCase))
              ?? throw new InvalidOperationException("CardPayments:Mode must be Disabled or Simulated.");
        if (mode == CardPaymentMode.Simulated)
        {
            if (environment is not ("Development" or "Test" or "Testing"))
                throw new InvalidOperationException("The simulated card gateway requires Development or Test.");
            services.AddSingleton<ICardPaymentGateway, SimulatedCardGateway>();
            services.AddSingleton(CardPaymentAvailability.SimulatedGateway);
            return;
        }
        services.AddSingleton<ICardPaymentGateway, DisabledCardGateway>();
        services.AddSingleton(CardPaymentAvailability.Disabled);
    }

    /// <summary>Configuration key of the fictitious Development RNCs «Completar fichas AVIAM» may copy.</summary>
    public const string DevelopmentTaxRegistrationsKey = "AirlineCatalogEnrichment:IncludeDevelopmentTaxRegistrations";

    /// <summary>
    /// The demo RNCs of the AVIAM reference are fictitious: off by default, and on only in Development or Test, so a
    /// Production API with it never starts. Only <c>true</c> or <c>false</c> are accepted.
    /// </summary>
    private static void AddAirlineCatalogEnrichment(IServiceCollection services, IConfiguration configuration,
        string environment)
    {
        var configured = configuration[DevelopmentTaxRegistrationsKey]?.Trim();
        var include = string.IsNullOrEmpty(configured) ? false
            : bool.TryParse(configured, out var value) ? value
            : throw new InvalidOperationException($"{DevelopmentTaxRegistrationsKey} must be true or false.");
        if (include && environment is not ("Development" or "Test" or "Testing"))
            throw new InvalidOperationException("Development tax registrations require Development or Test.");
        services.AddSingleton(include ? new AirlineCatalogEnrichmentSettings(true) : AirlineCatalogEnrichmentSettings.Default);
    }

    /// <summary>Configuration key of the demo flights the superadministrator triggers (ADR-0041).</summary>
    public const string DemoFlightsModeKey = "DemoFlights:Mode";

    /// <summary>
    /// ADR-0041: demo flights are chosen explicitly. <c>DemoFlights:Mode</c> is Disabled by default; Enabled only runs in
    /// Development or Test, so a Production API with it never starts. The endpoints exist in every environment (the
    /// OpenAPI document never depends on the mode): while it is off every command answers
    /// <c>demo_flights_unavailable</c>, the reads answer <c>enabled: false</c> and the progress worker does not run.
    /// </summary>
    private static void AddDemoFlights(IServiceCollection services, IConfiguration configuration, string environment)
    {
        var configured = configuration[DemoFlightsModeKey]?.Trim();
        // Only the exact names: no numbers and no flag combinations.
        var mode = string.IsNullOrEmpty(configured) ? DemoFlightMode.Disabled
            : Enum.GetValues<DemoFlightMode>().Cast<DemoFlightMode?>().SingleOrDefault(value =>
                  string.Equals(value.ToString(), configured, StringComparison.OrdinalIgnoreCase))
              ?? throw new InvalidOperationException("DemoFlights:Mode must be Disabled or Enabled.");
        if (mode == DemoFlightMode.Enabled && environment is not ("Development" or "Test" or "Testing"))
            throw new InvalidOperationException("Demo flights require Development or Test.");
        services.AddSingleton(mode == DemoFlightMode.Enabled ? DemoFlightAvailability.On : DemoFlightAvailability.Disabled);
    }

    /// <summary>
    /// ADR-0042 (contracts 1.3): the live aircraft of the OCC map. <c>AirTraffic:Enabled</c> is off by default and
    /// <c>AirTraffic:Providers</c> lists, in order, the networks to read (<c>AdsbFi</c>, <c>AdsbLol</c>). The section is
    /// checked on every start, also while it is off, so a wrong value never waits for the day it is switched on. Off or
    /// with an empty list the provider is <see cref="UnconfiguredAirTrafficProvider"/> and nothing is ever called. No
    /// environment is refused: <c>appsettings.json</c> leaves it off.
    /// </summary>
    private static void AddAirTraffic(IServiceCollection services, IConfiguration configuration)
    {
        var section = configuration.GetSection(AirTrafficOptions.SectionName);
        // «AirTraffic:Providers=AdsbFi» is one value, not a list: the binder would drop it and switch the traffic off.
        if (!string.IsNullOrWhiteSpace(section[nameof(AirTrafficOptions.Providers)]))
            throw new InvalidOperationException("AirTraffic:Providers must be a list (AirTraffic:Providers:0, :1).");
        var options = section.Get<AirTrafficOptions>() ?? new();
        var profiles = new List<ReadsbProfile>();
        foreach (var name in options.Providers)
        {
            var profile = ReadsbProfile.Find(name) ??
                throw new InvalidOperationException("AirTraffic:Providers accepts only AdsbFi and AdsbLol.");
            if (profiles.Contains(profile))
                throw new InvalidOperationException("AirTraffic:Providers names a provider more than once.");
            profiles.Add(profile);
        }
        var settings = AirTrafficSettingsFrom(options);
        if (!settings.Enabled || profiles.Count == 0)
        {
            services.AddSingleton<IAirTrafficProvider, UnconfiguredAirTrafficProvider>();
            services.AddSingleton(AirTrafficSettings.Disabled);
            return;
        }
        var key = options.ApiKey;
        services.AddSingleton(settings);
        services.AddSingleton<IAirTrafficProvider>(provider =>
        {
            var time = provider.GetRequiredService<TimeProvider>();
            return new FailoverAirTrafficProvider(
                [.. profiles.Select(profile => new ReadsbAirTrafficProvider(ReadsbAirTrafficProvider.CreateHttpClient(),
                    profile, profile.TakesKey ? key : null, time))],
                time);
        });
    }

    /// <summary>The settings of the section; a value out of range stops the start.</summary>
    private static AirTrafficSettings AirTrafficSettingsFrom(AirTrafficOptions options)
    {
        if (string.IsNullOrWhiteSpace(options.StationCode))
            throw new InvalidOperationException("AirTraffic:StationCode is required.");
        if (!double.IsFinite(options.CenterLatitude) || options.CenterLatitude is < -90 or > 90 ||
            !double.IsFinite(options.CenterLongitude) || options.CenterLongitude is < -180 or > 180)
            throw new InvalidOperationException("AirTraffic:CenterLatitude and AirTraffic:CenterLongitude must be a position on Earth.");
        if (options.RadiusNm is < 1 or > AirTrafficSettings.MaxRadiusNm)
            throw new InvalidOperationException("AirTraffic:RadiusNm must be from 1 to 250.");
        if (options.IntervalSeconds < AirTrafficSettings.MinimumInterval.TotalSeconds)
            throw new InvalidOperationException("AirTraffic:IntervalSeconds must be at least 10.");
        if (options.IdleAfterSeconds < options.IntervalSeconds)
            throw new InvalidOperationException("AirTraffic:IdleAfterSeconds must be at least AirTraffic:IntervalSeconds.");
        if (options.TrailMinutes is < 1 or > AirTrafficSettings.MaxTrailMinutes)
            throw new InvalidOperationException("AirTraffic:TrailMinutes must be from 1 to 180.");
        if (options.AirfieldRadiusNm is < 1 or > AirTrafficSettings.MaxAirfieldRadiusNm)
            throw new InvalidOperationException("AirTraffic:AirfieldRadiusNm must be from 1 to 25.");
        if (options.AirfieldIntervalSeconds < AirTrafficSettings.MinimumAirfieldInterval.TotalSeconds)
            throw new InvalidOperationException("AirTraffic:AirfieldIntervalSeconds must be at least 2.");
        return new AirTrafficSettings(options.Enabled, options.StationCode.Trim().ToUpperInvariant(), options.CenterLatitude,
            options.CenterLongitude, options.RadiusNm, TimeSpan.FromSeconds(options.IntervalSeconds),
            TimeSpan.FromSeconds(options.IdleAfterSeconds), TimeSpan.FromMinutes(options.TrailMinutes))
        {
            AirfieldReadsEnabled = options.AirfieldReadsEnabled,
            AirfieldRadiusNm = options.AirfieldRadiusNm,
            AirfieldInterval = TimeSpan.FromSeconds(options.AirfieldIntervalSeconds),
        };
    }

    /// <summary>
    /// ADR-0043 (contracts 1.4): the METAR and the TAF of the OCC, from aviationweather.gov: an airport's
    /// (<c>occ/weather</c>) and, since plan M6, those of the region's airports (<c>occ/weather/region</c>), each read with
    /// its own client and memory. <c>AviationWeather:Enabled</c> is off by default, and then both sources are the disabled
    /// ones (<see cref="DisabledAerodromeWeatherSource"/>, <see cref="DisabledRegionWeatherSource"/>) and nothing is ever
    /// called. <c>AviationWeather:BaseUrl</c> is checked on every start, also while it is off, and gets its final slash
    /// when it lacks one. On, each source is built only when it is first resolved, and it calls the service only when
    /// someone reads the weather: never while the API starts. No environment is refused: <c>appsettings.json</c> leaves it
    /// off.
    /// </summary>
    private static void AddAviationWeather(IServiceCollection services, IConfiguration configuration)
    {
        var options = configuration.GetSection(AviationWeatherOptions.SectionName).Get<AviationWeatherOptions>() ?? new();
        var baseUrl = AviationWeatherSource.DataApiAddress(options.BaseUrl) ??
            throw new InvalidOperationException("AviationWeather:BaseUrl must be an absolute https address.");
        if (!options.Enabled)
        {
            services.AddSingleton<IAerodromeWeatherSource, DisabledAerodromeWeatherSource>();
            services.AddSingleton<IRegionWeatherSource, DisabledRegionWeatherSource>();
            return;
        }
        services.AddSingleton<IAerodromeWeatherSource>(provider => new AviationWeatherSource(
            AviationWeatherSource.CreateHttpClient(), baseUrl, provider.GetRequiredService<TimeProvider>()));
        services.AddSingleton<IRegionWeatherSource>(provider => new AviationWeatherRegionSource(
            AviationWeatherSource.CreateHttpClient(), baseUrl, provider.GetRequiredService<TimeProvider>()));
    }
}
