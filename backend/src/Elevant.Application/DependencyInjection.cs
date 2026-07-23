using Microsoft.Extensions.DependencyInjection;

namespace Elevant.Application;

/// <summary>Registers application-level technical services.</summary>
public static class DependencyInjection
{
    /// <summary>Adds the application layer without registering speculative use cases.</summary>
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddSingleton(TimeProvider.System);
        return services;
    }
}
