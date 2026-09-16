using Elevant.Application.Identity.CreateSession;
using Elevant.Application.Identity.GetCurrentSession;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.Application;

/// <summary>Registers application use cases and application-level technical services.</summary>
public static class DependencyInjection
{
    /// <summary>Adds the application use cases and application-level technical services.</summary>
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddSingleton(TimeProvider.System);
        services.AddScoped<CreateSessionHandler>();
        services.AddScoped<GetCurrentSessionHandler>();
        return services;
    }
}
