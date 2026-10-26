using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;
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
        // The request also raised Contracts alerts; clear them so only the district history blocks the rollback.
        await context.Database.ExecuteSqlRawAsync("DELETE FROM iam.department_notifications", ct);
        var chain = context.Database.GetMigrations().ToArray();
        var previous = chain[Array.IndexOf(chain, IdentityRulesMigration) - 1];
        var failure = await Assert.ThrowsAsync<SqlException>(() =>
            context.GetService<IMigrator>().MigrateAsync(previous, ct));
        Assert.Equal(52301, failure.Number);
        Assert.Equal(IdentityRulesMigration, (await context.Database.GetAppliedMigrationsAsync(ct)).Last());
    }
}

public sealed partial class SqlServerMigrationTests
{
    [Fact]
    public async Task ContractsOwnsTheCatalogAndPublishingNeedsARealPhotoDescriptionAndName()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var catalog = scope.ServiceProvider.GetRequiredService<ICommercialCatalogManagementStore>();
        var hidden = new ManagedServiceInput("RAMP-CATERING", "Catering de aeronaves",
            "Comidas y bebidas a bordo para tripulación y pasajeros", "operación", null, null, 900, false, true, null);

        // Finance prices services but no longer edits the catalog; it can still read it.
        Assert.Equal(CatalogMutationFailure.Forbidden, (await catalog.SaveAsync(FinanceAccount, null, hidden, ct)).Failure);
        Assert.NotNull(await catalog.ListAsync(FinanceAccount, ct));

        var unknownUnit = await catalog.SaveAsync(ContractsAccount, null, hidden with { BillingUnit = "galón" }, ct);
        Assert.Equal(("billing_unit_unknown", CatalogMutationFailure.Invalid), (unknownUnit.Code, unknownUnit.Failure!.Value));
        var withoutPhoto = await catalog.SaveAsync(ContractsAccount, null, hidden with { IsPublic = true }, ct);
        Assert.Equal("image_required", withoutPhoto.Code);
        var placeholder = await catalog.SaveAsync(ContractsAccount, null, hidden with
        {
            Code = "RAMP-PRUEBA", Name = "Servicio de prueba", IsPublic = true,
            ImageUrl = "/assets/services/cargo-loading.webp",
        }, ct);
        Assert.Equal("placeholder_name", placeholder.Code);
        var shortText = await catalog.SaveAsync(ContractsAccount, null, hidden with
        {
            Description = "Comidas", IsPublic = true, ImageUrl = "/assets/services/cargo-loading.webp",
        }, ct);
        Assert.Equal("description_too_short", shortText.Code);

        // Hidden it can be saved with a unit Finance maintains (any casing), then published with a photo.
        var saved = await catalog.SaveAsync(ContractsAccount, null, hidden with { BillingUnit = "Operación" }, ct);
        Assert.Null(saved.Failure);
        var published = await catalog.SaveAsync(ContractsAccount, saved.Service!.Id, hidden with
        {
            BillingUnit = "Operación", IsPublic = true, ImageUrl = "/assets/services/cargo-loading.webp",
            Version = saved.Service.Version,
        }, ct);
        Assert.Null(published.Failure);
        Assert.True(published.Service!.IsPublic);
        Assert.Equal(CatalogMutationFailure.Forbidden,
            (await catalog.DeleteAsync(FinanceAccount, saved.Service.Id, published.Service.Version, ct)).Failure);
        Assert.Null((await catalog.DeleteAsync(ContractsAccount, saved.Service.Id, published.Service.Version, ct)).Failure);
    }
}

public sealed partial class SqlServerMigrationTests
{
    private const string DepartmentNotificationsMigration = "20261026192634_AddDepartmentNotifications";

    [Fact]
    public async Task CommercialRequestsRaiseOnScreenAlertsOnlyForContractsAndHistoryBlocksRollback()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var notifications = scope.ServiceProvider.GetRequiredService<IDepartmentNotificationStore>();
        var before = await notifications.ListAsync(ContractsAccount, ct);
        Assert.True(before.IsSuccess);

        var catalog = await scope.ServiceProvider.GetRequiredService<ICommercialCatalogStore>().GetPublicAsync(ct);
        var submitted = await new SubmitCommercialRequestHandler(
            scope.ServiceProvider.GetRequiredService<ICommercialIntakeStore>()).HandleAsync(
            new SubmitCommercialRequestCommand(Guid.NewGuid(), catalog.Airlines[0].Id, [catalog.Services[0].Id],
                "Rosa Díaz", "Representante legal", "rosa@example.test", "809-555-0100", true,
                RepresentativeCountry: "República Dominicana", RepresentativeProvince: "El Seibo",
                RepresentativeMunicipality: "Miches"), ct);
        Assert.True(submitted.IsSuccess);

        var after = (await notifications.ListAsync(ContractsAccount, ct)).Value!;
        var alert = Assert.Single(after.Notifications, item => item.Kind == "commercial_request");
        Assert.Equal("Contracts", alert.Department);
        Assert.Equal(catalog.Airlines[0].Name, alert.Subject);
        Assert.Null(alert.ReadAt);
        Assert.Equal(before.Value!.UnreadCount + 1, after.UnreadCount);
        // Finance reads its own feed and never sees the Contracts alert.
        var finance = await notifications.ListAsync(FinanceAccount, ct);
        Assert.True(finance.IsSuccess);
        Assert.DoesNotContain(finance.Value!.Notifications, item => item.Id == alert.Id);
        Assert.Equal(DepartmentNotificationFailure.NotFound,
            (await notifications.SetReadAsync(FinanceAccount, alert.Id, true, ct)).Failure);

        var read = await notifications.SetReadAsync(ContractsAccount, alert.Id, true, ct);
        Assert.NotNull(read.Value!.ReadAt);
        Assert.Equal(after.UnreadCount - 1, (await notifications.ListAsync(ContractsAccount, ct)).Value!.UnreadCount);

        await using var context = CreateContext(database.ConnectionString);
        // The bell and the toast learn about it through the account change feed.
        var signals = await context.OutboxMessages.AsNoTracking().Select(message => message.PayloadJson).ToArrayAsync(ct);
        Assert.Contains(signals, payload => payload.Contains("\"notifications\"") && payload.Contains(alert.Id.ToString("D")));
        var chain = context.Database.GetMigrations().ToArray();
        var previous = chain[Array.IndexOf(chain, DepartmentNotificationsMigration) - 1];
        var failure = await Assert.ThrowsAsync<SqlException>(() => context.GetService<IMigrator>().MigrateAsync(previous, ct));
        Assert.Equal(52310, failure.Number);
    }
}
