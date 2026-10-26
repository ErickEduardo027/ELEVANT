using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Commercial;
using Elevant.Domain.Entities.Commercial;
using Elevant.Infrastructure.Persistence;
using Elevant.Infrastructure.Persistence.Seed;
using Elevant.Persistence;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    private const string IdentityRulesMigration = "20261026143722_AddRepresentativeDistrictAndAirlineCodeUniqueness";

    [Fact]
    public async Task VerifiedAirlineDesignatorsAreUniqueAndDistrictHistoryBlocksRollback()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var context = CreateContext(database.ConnectionString);
        await context.Database.MigrateAsync(ct);
        await database.ConfigureDevelopmentSeederPermissionsAsync(ct);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(ct))
        await using (var seederContext = CreateContext(seederConnection))
            await new DevelopmentDataSeeder(seederContext).SeedAsync(InitialPasswords, ct);

        CommercialAirlineProfile Profile(string name, string iata, string icao, bool verified) => new()
        {
            PublicId = Guid.NewGuid(), SourceName = name, DisplayName = name, Region = "Caribe",
            SourceUrl = "https://example.test/" + name, IataCode = iata, IcaoCode = icao,
            VerifiedAt = verified ? DateTimeOffset.UtcNow : null,
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        // Unverified research leads may repeat codes; verified airlines may not.
        context.CommercialAirlineProfiles.AddRange(Profile("QA ONE", "Q1", "QAO", false), Profile("QA TWO", "Q1", "QAO", false));
        await context.SaveChangesAsync(ct);
        context.CommercialAirlineProfiles.Add(Profile("QA THREE", "Q2", "QAT", true));
        await context.SaveChangesAsync(ct);
        context.CommercialAirlineProfiles.Add(Profile("QA FOUR", "Q2", "QAF", true));
        var duplicate = await Assert.ThrowsAsync<DbUpdateException>(() => context.SaveChangesAsync(ct));
        Assert.IsType<SqlException>(duplicate.InnerException);
        context.ChangeTracker.Clear();

        // Rolling back would silently discard recorded municipal districts.
        await using var provider = new ServiceCollection().AddLogging()
            .AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
                { ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString }).Build())
            .BuildServiceProvider();
        await using (var scope = provider.CreateAsyncScope())
        {
            var catalog = await scope.ServiceProvider.GetRequiredService<ICommercialCatalogStore>().GetPublicAsync(ct);
            var submitted = await new SubmitCommercialRequestHandler(
                scope.ServiceProvider.GetRequiredService<ICommercialIntakeStore>()).HandleAsync(
                new SubmitCommercialRequestCommand(Guid.NewGuid(), catalog.Airlines[0].Id, [catalog.Services[0].Id],
                    "Rosa Díaz", "Representante legal", "rosa@example.test", "809-555-0100", true,
                    RepresentativeCountry: "República Dominicana", RepresentativeProvince: "El Seibo",
                    RepresentativeMunicipality: "Miches", RepresentativeDistrict: "La Gina"), ct);
            Assert.True(submitted.IsSuccess);
        }
        var chain = context.Database.GetMigrations().ToArray();
        var previous = chain[Array.IndexOf(chain, IdentityRulesMigration) - 1];
        var failure = await Assert.ThrowsAsync<SqlException>(() =>
            context.GetService<IMigrator>().MigrateAsync(previous, ct));
        Assert.Equal(52301, failure.Number);
        Assert.Equal(IdentityRulesMigration, (await context.Database.GetAppliedMigrationsAsync(ct)).Last());
    }
}
