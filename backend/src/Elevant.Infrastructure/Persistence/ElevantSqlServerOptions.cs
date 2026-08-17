using Microsoft.EntityFrameworkCore.Infrastructure;

namespace Elevant.Infrastructure.Persistence;

/// <summary>Single SQL Server provider configuration shared by API, tooling and tests.</summary>
public static class ElevantSqlServerOptions
{
    public const int CompatibilityLevel = 160;
    public const string MigrationHistorySchema = "infra";
    public const string MigrationHistoryTable = "__EFMigrationsHistory";

    public static void Configure(SqlServerDbContextOptionsBuilder options)
    {
        ArgumentNullException.ThrowIfNull(options);
        options.MigrationsAssembly(typeof(ElevantDbContext).Assembly.FullName);
        options.MigrationsHistoryTable(MigrationHistoryTable, MigrationHistorySchema);
        options.UseCompatibilityLevel(CompatibilityLevel);
        options.EnableRetryOnFailure();
    }
}
