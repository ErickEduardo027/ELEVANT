using Elevant.Infrastructure.Integrations.FlightAware;
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

        services.AddFlightAwareShell(configuration);

        return services;
    }
}
