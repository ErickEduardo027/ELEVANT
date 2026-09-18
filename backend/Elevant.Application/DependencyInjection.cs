using Elevant.Application.Identity.CreateSession;
using Elevant.Application.Identity.GetCurrentSession;
using Elevant.Application.Integration.RegisterMobileDevice;
using Elevant.Application.Operations.AssignOccOperation;
using Elevant.Application.Operations.GetOccPlanningOptions;
using Elevant.Application.Operations.GetOccPlanningSnapshot;
using Elevant.Application.Operations.GetRampAssignedOperations;
using Elevant.Application.Operations.StartRampOperation;
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
        services.AddScoped<GetOccPlanningSnapshotHandler>();
        services.AddScoped<GetOccPlanningOptionsHandler>();
        services.AddScoped<AssignOccOperationHandler>();
        services.AddScoped<GetRampAssignedOperationsHandler>();
        services.AddScoped<RegisterMobileDeviceHandler>();
        services.AddScoped<StartRampOperationHandler>();
        return services;
    }
}
