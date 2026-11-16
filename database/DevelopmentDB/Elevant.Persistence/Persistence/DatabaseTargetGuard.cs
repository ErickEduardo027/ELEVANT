using Microsoft.Data.SqlClient;

namespace Elevant.Infrastructure.Persistence;

/// <summary>Rejects ambiguous or cross-environment database targets before EF tooling runs.</summary>
public static class DatabaseTargetGuard
{
    public const string EnvironmentVariable = "ELEVANT_DATABASE_ENVIRONMENT";
    public const string ProductionConfirmationVariable = "ELEVANT_CONFIRM_PRODUCTION_SCHEMA_CHANGE";
    public const string DevelopmentDatabaseName = "ElevantDevelopmentDb";
    public const string ProductionDatabaseName = "ElevantProductionDb";

    /// <summary>Validates the declared environment against the physical database name.</summary>
    public static string Validate(string connectionString, string? environmentName, string? productionConfirmation)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException("A SQL Server connection string is required.");
        }

        if (!Enum.TryParse<DatabaseEnvironment>(environmentName, ignoreCase: true, out var environment))
        {
            throw new InvalidOperationException(
                $"Set {EnvironmentVariable} to Development or Production before running database tooling.");
        }

        var builder = new SqlConnectionStringBuilder(connectionString);
        var expectedDatabase = environment == DatabaseEnvironment.Development
            ? DevelopmentDatabaseName
            : ProductionDatabaseName;

        if (!string.Equals(builder.InitialCatalog, expectedDatabase, StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                $"Database target mismatch: {environment} requires Initial Catalog={expectedDatabase}.");
        }

        if (environment == DatabaseEnvironment.Production &&
            !string.Equals(productionConfirmation, ProductionDatabaseName, StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                $"Production schema changes require {ProductionConfirmationVariable}={ProductionDatabaseName}.");
        }

        return expectedDatabase;
    }

    private enum DatabaseEnvironment
    {
        Development,
        Production,
    }
}
