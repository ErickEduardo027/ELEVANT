using Elevant.Infrastructure.Persistence;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace Elevant.Api.HealthChecks;

/// <summary>Verifies the configured catalog and immutable environment marker before serving traffic.</summary>
internal sealed class DatabaseReadinessHealthCheck(
    IServiceScopeFactory scopeFactory,
    IConfiguration configuration) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(context);

        try
        {
            var connectionString = configuration.GetConnectionString("ElevantDatabase");
            var target = DatabaseRuntimeTarget.Resolve(
                connectionString ?? string.Empty,
                configuration[DatabaseTargetGuard.EnvironmentVariable]);

            using var scope = scopeFactory.CreateScope();
            var databaseContext = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();

            await databaseContext.Database.OpenConnectionAsync(cancellationToken);

            var connectedDatabase = databaseContext.Database.GetDbConnection().Database;
            if (!string.Equals(connectedDatabase, target.DatabaseName, StringComparison.Ordinal))
            {
                return HealthCheckResult.Unhealthy(
                    "The connected SQL Server catalog does not match the declared runtime target.");
            }

            await DatabaseInstanceVerifier.RequireEnvironmentAsync(
                databaseContext,
                target.EnvironmentName,
                cancellationToken);

            return HealthCheckResult.Healthy();
        }
        catch (Exception exception) when (
            exception is InvalidOperationException or SqlException)
        {
            return HealthCheckResult.Unhealthy(
                "The database runtime target could not be verified.");
        }
    }
}
