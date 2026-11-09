using Elevant.Infrastructure.Authentication;
using Elevant.Application.Finance;
using Elevant.Domain.Enumerations;
using Elevant.Application.Abstractions.Finance;
using Elevant.Infrastructure.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Operations;
using Elevant.Infrastructure.Commercial;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Infrastructure.Integrations.FlightAware;
using Elevant.Infrastructure.Integrations.OpenSky;
using Elevant.Application.Abstractions.Operations;
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
        var environment = configuration["DOTNET_ENVIRONMENT"] ?? configuration["ASPNETCORE_ENVIRONMENT"] ?? "Production";
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
        var openSky = configuration.GetSection(OpenSkyOptions.SectionName).Get<OpenSkyOptions>() ?? new OpenSkyOptions();
        services.AddSingleton<IOccAircraftTrafficSource>(provider =>
            new OpenSkyAircraftTrafficSource(
                new HttpClient(new HttpClientHandler { AllowAutoRedirect = false })
                { Timeout = TimeSpan.FromSeconds(10) },
                openSky,
                provider.GetRequiredService<TimeProvider>()));
        // Public airline registries, asked in this order (ADR-0023).
        services.AddSingleton<Elevant.Application.Abstractions.Commercial.IAirlineRegistrySource>(_ =>
            new Elevant.Infrastructure.Integrations.AirlineRegistry.WikidataAirlineRegistrySource(
                new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(8) }));
        services.AddSingleton<Elevant.Application.Abstractions.Commercial.IAirlineRegistrySource,
            Elevant.Infrastructure.Integrations.AirlineRegistry.OpenFlightsAirlineRegistrySource>();
        services.AddSingleton<Elevant.Application.Abstractions.Commercial.IAirlineRegistryLookup,
            Elevant.Application.Commercial.AirlineRegistryLookup>();
        services.AddJwtAccessTokens(configuration);
        services.AddSingleton<IFinancialDocumentPdfRenderer, FinancialDocumentPdfRenderer>();
        services.AddSingleton<Elevant.Application.Finance.ICardPaymentGateway, SimulatedCardGateway>();
        services.AddSingleton<IFinanceReportXlsxRenderer, FinanceReportXlsxRenderer>();
        services.AddSingleton<IHumanResourcesReportPdfRenderer, HumanResourcesReportPdfRenderer>();
        services.AddSingleton<IOccReportRenderer, OccReportRenderer>();
        services.Configure<Elevant.Infrastructure.Messaging.SmtpOptions>(configuration.GetSection(Elevant.Infrastructure.Messaging.SmtpOptions.SectionName));
        services.AddSingleton<Elevant.Application.Abstractions.Messaging.IEmailSender, Elevant.Infrastructure.Messaging.SmtpEmailSender>();
        services.AddSingleton<IContractPdfRenderer, ContractPdfRenderer>();
        services.AddSingleton<Elevant.Application.Operations.IOperationDocumentPdfRenderer, Operations.OperationDocumentPdfRenderer>();
        services.AddSingleton<IHumanResourcesReportXlsxRenderer, HumanResourcesReportXlsxRenderer>();

        return services;
    }
}
