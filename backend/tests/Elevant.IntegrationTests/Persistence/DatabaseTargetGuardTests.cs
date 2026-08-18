using Elevant.Infrastructure.Persistence;

namespace Elevant.IntegrationTests.Persistence;

public sealed class DatabaseTargetGuardTests
{
    [Fact]
    public void DevelopmentTargetAcceptsOnlyDevelopmentDatabase()
    {
        const string connectionString =
            "Server=localhost;Initial Catalog=ElevantDevelopmentDb;User ID=test;Password=not-a-secret;";

        var databaseName = DatabaseTargetGuard.Validate(connectionString, "Development", null);

        Assert.Equal(DatabaseTargetGuard.DevelopmentDatabaseName, databaseName);
    }

    [Fact]
    public void EnvironmentAndDatabaseMismatchIsRejected()
    {
        const string connectionString =
            "Server=localhost;Initial Catalog=ElevantProductionDb;User ID=test;Password=not-a-secret;";

        var exception = Assert.Throws<InvalidOperationException>(
            () => DatabaseTargetGuard.Validate(connectionString, "Development", null));

        Assert.Contains("target mismatch", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ProductionRequiresAnExactSecondConfirmation()
    {
        const string connectionString =
            "Server=localhost;Initial Catalog=ElevantProductionDb;User ID=test;Password=not-a-secret;";

        Assert.Throws<InvalidOperationException>(
            () => DatabaseTargetGuard.Validate(connectionString, "Production", null));

        var databaseName = DatabaseTargetGuard.Validate(
            connectionString,
            "Production",
            DatabaseTargetGuard.ProductionDatabaseName);

        Assert.Equal(DatabaseTargetGuard.ProductionDatabaseName, databaseName);
    }
}
