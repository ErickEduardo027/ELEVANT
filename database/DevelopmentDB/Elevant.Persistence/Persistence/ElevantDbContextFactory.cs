using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Elevant.Infrastructure.Persistence;

/// <summary>Creates the DbContext for explicitly invoked EF Core design commands.</summary>
public sealed class ElevantDbContextFactory : IDesignTimeDbContextFactory<ElevantDbContext>
{
    private const string ConnectionStringEnvironmentVariable = "ConnectionStrings__ElevantDatabase";

    /// <inheritdoc />
    public ElevantDbContext CreateDbContext(string[] args)
    {
        var connectionString = Environment.GetEnvironmentVariable(ConnectionStringEnvironmentVariable);

        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException(
                $"Set {ConnectionStringEnvironmentVariable} before running an EF Core design command.");
        }

        DatabaseTargetGuard.Validate(
            connectionString,
            Environment.GetEnvironmentVariable(DatabaseTargetGuard.EnvironmentVariable),
            Environment.GetEnvironmentVariable(DatabaseTargetGuard.ProductionConfirmationVariable));

        var options = new DbContextOptionsBuilder<ElevantDbContext>()
            .UseSqlServer(connectionString, ElevantSqlServerOptions.Configure)
            .Options;

        return new ElevantDbContext(options);
    }
}
