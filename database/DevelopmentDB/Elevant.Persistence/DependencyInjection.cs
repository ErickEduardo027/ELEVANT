using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Elevant.Persistence.Operations;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace Elevant.Persistence;

/// <summary>Registers the shared SQL Server persistence layer.</summary>
public static class DependencyInjection
{
    private const string DatabaseConnectionName = "ElevantDatabase";

    /// <summary>Adds the Elevant database context and readiness check.</summary>
    public static IServiceCollection AddPersistence(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        var connectionString = configuration.GetConnectionString(DatabaseConnectionName);
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException(
                $"ConnectionStrings:{DatabaseConnectionName} must be supplied by the environment or secret store.");
        }

        services.AddDbContext<ElevantDbContext>(options =>
            options.UseSqlServer(connectionString, ElevantSqlServerOptions.Configure));

        services
            .AddIdentityCore<ApplicationUser>(options =>
            {
                options.Password.RequiredLength = 14;
                options.Password.RequireDigit = true;
                options.Password.RequireLowercase = true;
                options.Password.RequireUppercase = true;
                options.Password.RequireNonAlphanumeric = true;
                options.User.RequireUniqueEmail = true;
                options.Lockout.AllowedForNewUsers = true;
                options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
                options.Lockout.MaxFailedAccessAttempts = 5;
            })
            .AddRoles<ApplicationRole>()
            .AddEntityFrameworkStores<ElevantDbContext>();

        services.AddScoped<ICredentialVerifier, IdentityCredentialVerifier>();
        services.AddScoped<IActorContextResolver, EfActorContextResolver>();
        services.AddScoped<IOccPlanningReadStore, EfOccPlanningReadStore>();
        services.AddScoped<IOccPlanningCommandStore, EfOccPlanningCommandStore>();
        services.AddScoped<IRampOperationsReadStore, EfRampOperationsReadStore>();

        services
            .AddHealthChecks()
            .AddDbContextCheck<ElevantDbContext>(
                name: "sql-server",
                failureStatus: HealthStatus.Unhealthy,
                tags: ["ready"]);

        return services;
    }
}
