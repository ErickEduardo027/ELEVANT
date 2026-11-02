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

        var modeText = configuration["FinanceFiscal:Mode"] ?? "Off";
        if (!Enum.TryParse<FiscalMode>(modeText, false, out var fiscalMode) || !Enum.IsDefined(fiscalMode))
            throw new InvalidOperationException("FinanceFiscal:Mode is invalid.");
        var environment = configuration["DOTNET_ENVIRONMENT"] ?? configuration["ASPNETCORE_ENVIRONMENT"] ?? "Production";
        services.AddSingleton(new FinanceFiscalOptions { Mode = fiscalMode, Environment = environment });
        var archiveMode = configuration["FinanceFiscal:ArchiveMode"] ?? "PrivateObjectStore";
        if (archiveMode == "LocalDirectory")
        {
            if (environment is not ("Development" or "Test")) throw new InvalidOperationException("Local fiscal archive requires Development or Test.");
            var directory = configuration["FinanceFiscal:ArchiveDirectory"];
            if (string.IsNullOrWhiteSpace(directory)) throw new InvalidOperationException("An explicit private fiscal archive directory is required.");
            services.AddSingleton<IFiscalArtifactArchive>(new FinanceFiscalFileArchive(directory));
        }
        else if (archiveMode != "PrivateObjectStore") throw new InvalidOperationException("FinanceFiscal:ArchiveMode is invalid.");
        services.AddSingleton<IOfficialEcfXmlValidator, OfficialEcfXmlValidator>();
        services.AddSingleton<IFiscalProvider, FinanceFiscalLocalSimulator>();
        services.AddSingleton<IFiscalCallbackAuthenticator, FinanceFiscalRejectCallbacks>();
        services.AddSingleton<IFiscalArtifactBuilder, FinanceFiscalArtifactBuilder>();
        services.AddFlightAwareShell(configuration);
        var openSky = configuration.GetSection(OpenSkyOptions.SectionName).Get<OpenSkyOptions>() ?? new OpenSkyOptions();
        services.AddSingleton<IOccAircraftTrafficSource>(provider =>
            new OpenSkyAircraftTrafficSource(
                new HttpClient(new HttpClientHandler { AllowAutoRedirect = false })
                { Timeout = TimeSpan.FromSeconds(10) },
                openSky,
                provider.GetRequiredService<TimeProvider>()));
        services.AddJwtAccessTokens(configuration);
        services.AddSingleton<IFinancialDocumentPdfRenderer, FinancialDocumentPdfRenderer>();
        services.AddSingleton<IFinanceReportXlsxRenderer, FinanceReportXlsxRenderer>();
        services.AddSingleton<IHumanResourcesReportPdfRenderer, HumanResourcesReportPdfRenderer>();
        services.AddSingleton<IOccReportRenderer, OccReportRenderer>();
        services.Configure<Elevant.Infrastructure.Messaging.SmtpOptions>(configuration.GetSection(Elevant.Infrastructure.Messaging.SmtpOptions.SectionName));
        services.AddSingleton<Elevant.Application.Abstractions.Messaging.IEmailSender, Elevant.Infrastructure.Messaging.SmtpEmailSender>();
        services.AddSingleton<IContractPdfRenderer, ContractPdfRenderer>();
        services.AddSingleton<IHumanResourcesReportXlsxRenderer, HumanResourcesReportXlsxRenderer>();

        return services;
    }
}
