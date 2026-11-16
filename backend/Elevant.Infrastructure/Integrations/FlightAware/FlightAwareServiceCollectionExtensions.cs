using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.Infrastructure.Integrations.FlightAware;

/// <summary>Registers only the configuration shell for the future adapter.</summary>
public static class FlightAwareServiceCollectionExtensions
{
    /// <summary>
    /// Binds namespaced options without registering a client, HTTP pipeline, or
    /// <c>IFlightInformationProvider</c> implementation.
    /// </summary>
    public static IServiceCollection AddFlightAwareShell(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        services
            .AddOptions<FlightAwareOptions>()
            .Bind(configuration.GetSection(FlightAwareOptions.SectionName));

        return services;
    }
}
