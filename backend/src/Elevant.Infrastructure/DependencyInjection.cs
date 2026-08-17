using Elevant.Infrastructure.Integrations.FlightAware;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace Elevant.Infrastructure;

/// <summary>Registers infrastructure implementations and owned resources.</summary>
public static class DependencyInjection
{
    private const string DatabaseConnectionName = "ElevantDatabase";

    /// <summary>Adds SQL Server persistence and configuration shells.</summary>
    public static IServiceCollection AddInfrastructure(
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
            .AddHealthChecks()
            .AddDbContextCheck<ElevantDbContext>(
                name: "sql-server",
                failureStatus: HealthStatus.Unhealthy,
                tags: ["ready"]);

        services.AddFlightAwareShell(configuration);

        return services;
    }
}
