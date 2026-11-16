using Elevant.Api.HealthChecks;

namespace Elevant.IntegrationTests.Api;

public sealed class DatabaseRuntimeTargetTests
{
    [Theory]
    [InlineData("Development", "ElevantDevelopmentDb")]
    [InlineData("development", "ElevantDevelopmentDb")]
    [InlineData("Production", "ElevantProductionDb")]
    public void ExactEnvironmentAndCatalogAreResolved(
        string environment,
        string databaseName)
    {
        var connectionString =
            $"Server=sql;Initial Catalog={databaseName};User ID=elevant_app;Password=synthetic;";

        var target = DatabaseRuntimeTarget.Resolve(connectionString, environment);

        Assert.Equal(environment, target.EnvironmentName, ignoreCase: true);
        Assert.Equal(databaseName, target.DatabaseName);
    }

    [Fact]
    public void CrossEnvironmentCatalogIsRejected()
    {
        const string connectionString =
            "Server=sql;Initial Catalog=ElevantProductionDb;User ID=elevant_app;Password=synthetic;";

        var exception = Assert.Throws<InvalidOperationException>(() =>
            DatabaseRuntimeTarget.Resolve(connectionString, "Development"));

        Assert.DoesNotContain("synthetic", exception.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("Staging")]
    public void MissingOrUnknownEnvironmentIsRejected(string? environment)
    {
        const string connectionString =
            "Server=sql;Initial Catalog=ElevantDevelopmentDb;User ID=elevant_app;Password=synthetic;";

        Assert.Throws<InvalidOperationException>(() =>
            DatabaseRuntimeTarget.Resolve(connectionString, environment));
    }
}
