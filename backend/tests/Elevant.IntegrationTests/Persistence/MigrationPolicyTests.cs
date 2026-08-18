using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;

namespace Elevant.IntegrationTests.Persistence;

public sealed class MigrationPolicyTests
{
    [Fact]
    public void SchemaMigrationsContainNoBusinessDataOperations()
    {
        var options = new DbContextOptionsBuilder<ElevantDbContext>()
            .UseSqlServer(
                "Server=localhost;Initial Catalog=ElevantDevelopmentDb;Integrated Security=true;",
                ElevantSqlServerOptions.Configure)
            .Options;
        using var context = new ElevantDbContext(options);
        var assembly = context.GetService<IMigrationsAssembly>();

        foreach (var migrationType in assembly.Migrations.Values)
        {
            var migration = assembly.CreateMigration(migrationType, "Microsoft.EntityFrameworkCore.SqlServer");
            Assert.DoesNotContain(migration.UpOperations, operation => operation is InsertDataOperation);
            Assert.DoesNotContain(
                migration.UpOperations.OfType<SqlOperation>(),
                operation => ContainsBusinessDataManipulation(operation.Sql));
        }
    }

    private static bool ContainsBusinessDataManipulation(string sql)
    {
        var normalized = sql.TrimStart();
        return normalized.StartsWith("INSERT ", StringComparison.OrdinalIgnoreCase) ||
               normalized.StartsWith("UPDATE ", StringComparison.OrdinalIgnoreCase) ||
               normalized.StartsWith("DELETE ", StringComparison.OrdinalIgnoreCase) ||
               normalized.StartsWith("MERGE ", StringComparison.OrdinalIgnoreCase);
    }
}
