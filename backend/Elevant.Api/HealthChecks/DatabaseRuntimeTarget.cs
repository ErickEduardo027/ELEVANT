using Elevant.Infrastructure.Persistence;
using Microsoft.Data.SqlClient;

namespace Elevant.Api.HealthChecks;

/// <summary>Resolved, canonical identity of a database runtime target.</summary>
internal sealed record DatabaseRuntimeTarget(string EnvironmentName, string DatabaseName)
{
    public static DatabaseRuntimeTarget Resolve(string connectionString, string? environmentName)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException("The API database connection string is required.");
        }

        var target = environmentName?.Trim() switch
        {
            string value when value.Equals("Development", StringComparison.OrdinalIgnoreCase) =>
                new DatabaseRuntimeTarget("Development", DatabaseTargetGuard.DevelopmentDatabaseName),
            string value when value.Equals("Production", StringComparison.OrdinalIgnoreCase) =>
                new DatabaseRuntimeTarget("Production", DatabaseTargetGuard.ProductionDatabaseName),
            _ => throw new InvalidOperationException(
                $"Set {DatabaseTargetGuard.EnvironmentVariable} to Development or Production."),
        };

        var configuredDatabase = new SqlConnectionStringBuilder(connectionString).InitialCatalog;
        if (!string.Equals(configuredDatabase, target.DatabaseName, StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                $"The declared {target.EnvironmentName} environment requires database {target.DatabaseName}.");
        }

        return target;
    }
}
