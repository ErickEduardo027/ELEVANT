using Elevant.Domain.Entities.Reference;
using Elevant.Infrastructure.Persistence;
using Elevant.Infrastructure.Persistence.Seed;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Elevant.IntegrationTests.Persistence;

public sealed class SqlServerMigrationTests
{
    private const string MasterConnectionEnvironmentVariable = "ELEVANT_TEST_SQLSERVER_MASTER";

    [Fact]
    public async Task ProductionSchemaStartsWithoutBusinessRows()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null)
        {
            return;
        }

        await using var database = await TemporaryDatabase.CreateAsync(masterConnection, "Production", cancellationToken);
        await using var context = CreateContext(database.ConnectionString);

        await context.Database.MigrateAsync(cancellationToken);

        Assert.Empty(await context.Organizations.AsNoTracking().ToListAsync(cancellationToken));
        Assert.Empty(await context.Users.AsNoTracking().ToListAsync(cancellationToken));
        Assert.Empty(await context.Turnarounds.AsNoTracking().ToListAsync(cancellationToken));
        Assert.Equal(5, (await context.Database.GetAppliedMigrationsAsync(cancellationToken)).Count());

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => new DevelopmentDataSeeder(context).SeedAsync("Synthetic-Test-Only!234", cancellationToken));
        Assert.Empty(await context.Organizations.AsNoTracking().ToListAsync(cancellationToken));
    }

    [Fact]
    public async Task DevelopmentSeederIsIdempotentAndPreservesExistingRows()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null)
        {
            return;
        }

        await using var database = await TemporaryDatabase.CreateAsync(masterConnection, "Development", cancellationToken);
        await using var context = CreateContext(database.ConnectionString);
        await context.Database.MigrateAsync(cancellationToken);

        var seeder = new DevelopmentDataSeeder(context);
        await seeder.SeedAsync("Synthetic-Test-Only!234", cancellationToken);

        var organizationCount = await context.Organizations.CountAsync(cancellationToken);
        var accountCount = await context.Users.CountAsync(cancellationToken);
        var turnaroundCount = await context.Turnarounds.CountAsync(cancellationToken);

        context.ServiceDefinitions.Add(new ServiceDefinition
        {
            PublicId = Guid.CreateVersion7(),
            Code = "USER-SENTINEL",
            Name = "Existing row preserved by seed",
            DefaultBillingUnit = "test",
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
        await context.SaveChangesAsync(cancellationToken);

        await seeder.SeedAsync("Synthetic-Test-Only!234", cancellationToken);

        Assert.Equal(organizationCount, await context.Organizations.CountAsync(cancellationToken));
        Assert.Equal(accountCount, await context.Users.CountAsync(cancellationToken));
        Assert.Equal(turnaroundCount, await context.Turnarounds.CountAsync(cancellationToken));
        Assert.True(await context.ServiceDefinitions.AnyAsync(
            item => item.Code == "USER-SENTINEL",
            cancellationToken));
    }

    private static ElevantDbContext CreateContext(string connectionString)
    {
        var options = new DbContextOptionsBuilder<ElevantDbContext>()
            .UseSqlServer(connectionString, ElevantSqlServerOptions.Configure)
            .Options;
        return new ElevantDbContext(options);
    }

    private static string? ResolveMasterConnection()
    {
        var configured = Environment.GetEnvironmentVariable(MasterConnectionEnvironmentVariable);
        if (!string.IsNullOrWhiteSpace(configured))
        {
            return configured;
        }

        return OperatingSystem.IsWindows()
            ? "Server=(localdb)\\MSSQLLocalDB;Initial Catalog=master;Integrated Security=true;TrustServerCertificate=true;Connect Timeout=30"
            : null;
    }

    private sealed class TemporaryDatabase : IAsyncDisposable
    {
        private readonly string _masterConnectionString;
        private readonly string _databaseName;

        private TemporaryDatabase(string masterConnectionString, string databaseName, string connectionString)
        {
            _masterConnectionString = masterConnectionString;
            _databaseName = databaseName;
            ConnectionString = connectionString;
        }

        public string ConnectionString { get; }

        public static async Task<TemporaryDatabase> CreateAsync(
            string masterConnectionString,
            string environmentName,
            CancellationToken cancellationToken)
        {
            var databaseName = $"ElevantDbV1Test_{Guid.NewGuid():N}";
            var quotedName = QuoteIdentifier(databaseName);

            await using (var master = new SqlConnection(masterConnectionString))
            {
                await master.OpenAsync(cancellationToken);
                await using var create = master.CreateCommand();
                create.CommandText = $"CREATE DATABASE {quotedName};";
                await create.ExecuteNonQueryAsync(cancellationToken);
            }

            try
            {
                var databaseBuilder = new SqlConnectionStringBuilder(masterConnectionString)
                {
                    InitialCatalog = databaseName,
                };

                await using (var database = new SqlConnection(databaseBuilder.ConnectionString))
                {
                    await database.OpenAsync(cancellationToken);
                    await using (var createSchema = database.CreateCommand())
                    {
                        createSchema.CommandText = "CREATE SCHEMA [infra];";
                        await createSchema.ExecuteNonQueryAsync(cancellationToken);
                    }

                    await using var bootstrap = database.CreateCommand();
                    bootstrap.CommandText = """
                        CREATE TABLE [infra].[database_instances]
                        (
                            [id] tinyint NOT NULL CONSTRAINT [pk_database_instances] PRIMARY KEY,
                            [instance_id] uniqueidentifier NOT NULL,
                            [environment_name] nvarchar(32) NOT NULL,
                            [created_at] datetimeoffset(3) NOT NULL,
                            CONSTRAINT [ck_database_instances_singleton] CHECK ([id] = 1),
                            CONSTRAINT [ck_database_instances_environment] CHECK ([environment_name] IN (N'Development', N'Production'))
                        );
                        INSERT INTO [infra].[database_instances] ([id], [instance_id], [environment_name], [created_at])
                        VALUES (1, @instanceId, @environmentName, SYSUTCDATETIME());
                        """;
                    bootstrap.Parameters.AddWithValue("@instanceId", Guid.NewGuid());
                    bootstrap.Parameters.AddWithValue("@environmentName", environmentName);
                    await bootstrap.ExecuteNonQueryAsync(cancellationToken);
                }

                return new TemporaryDatabase(masterConnectionString, databaseName, databaseBuilder.ConnectionString);
            }
            catch
            {
                await DropDatabaseAsync(masterConnectionString, databaseName);
                throw;
            }
        }

        public async ValueTask DisposeAsync()
        {
            if (!_databaseName.StartsWith("ElevantDbV1Test_", StringComparison.Ordinal))
            {
                throw new InvalidOperationException("Refusing to remove a database outside the test namespace.");
            }

            await DropDatabaseAsync(_masterConnectionString, _databaseName);
        }

        private static async Task DropDatabaseAsync(string masterConnectionString, string databaseName)
        {
            if (!databaseName.StartsWith("ElevantDbV1Test_", StringComparison.Ordinal))
            {
                throw new InvalidOperationException("Refusing to remove a database outside the test namespace.");
            }

            SqlConnection.ClearAllPools();
            await using var master = new SqlConnection(masterConnectionString);
            await master.OpenAsync();
            await using var drop = master.CreateCommand();
            var quotedName = QuoteIdentifier(databaseName);
            drop.CommandText = $"IF DB_ID(@databaseName) IS NOT NULL BEGIN ALTER DATABASE {quotedName} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE {quotedName}; END";
            drop.Parameters.AddWithValue("@databaseName", databaseName);
            await drop.ExecuteNonQueryAsync();
        }

        private static string QuoteIdentifier(string value) => $"[{value.Replace("]", "]]", StringComparison.Ordinal)}]";
    }
}
