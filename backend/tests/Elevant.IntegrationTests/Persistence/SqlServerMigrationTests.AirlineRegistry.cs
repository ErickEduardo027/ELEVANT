using Elevant.Application.Abstractions.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    private const string RegistryMigration = "20261102161112_AddAirlineRegistryCheck";

    [Fact]
    public async Task AirlinesArePublishedOnlyWithAGreenRegistryCheckOrAManualVerification()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var store = scope.ServiceProvider.GetRequiredService<ICommercialAirlineManagementStore>();
        var superAdmin = Guid.Parse("40000000-0000-7000-8000-000000000007");
        var contracts = Guid.Parse("40000000-0000-7000-8000-000000000005");

        var input = new ManagedAirlineInput("REGISTRY TEST", "Copa Airlines", null, "Centroamérica", "PA", "CM", "CMP",
            null, "https://www.copaair.com/", null, IsVerified: false, IsPublished: false, Version: null);
        var created = (await store.SaveAsync(superAdmin, null, input, null, ct)).Airline!;
        Assert.Null(created.RegistryStatus);

        // Without a check or a manual verification it cannot be published.
        var refused = await store.SaveAsync(superAdmin, created.Id, input with { IsPublished = true, Version = created.Version }, null, ct);
        Assert.Equal((CatalogMutationFailure.Invalid, "registry_check_required"), (refused.Failure!.Value, refused.Code));

        Assert.Equal(CatalogMutationFailure.Forbidden, (await store.RegistryKeyAsync(contracts, created.Id, ct)).Failure);
        var key = (await store.RegistryKeyAsync(superAdmin, created.Id, ct)).Key!;
        Assert.Equal(("Copa Airlines", "CM", "CMP"), (key.Name, key.IataCode, key.IcaoCode));
        var found = new AirlineRegistryCheck("Found", "Wikidata", "Copa Airlines", "CM", "CMP", "PA",
            "https://www.wikidata.org/wiki/Q849404", [], DateTimeOffset.UtcNow);

        // «Unavailable» keeps the previous state; a verdict is stored with its source.
        var unavailable = await store.RecordRegistryCheckAsync(superAdmin, key, found with { Status = AirlineRegistryCheck.Unavailable }, ct);
        Assert.Null(unavailable.Airline!.RegistryStatus);
        var recorded = (await store.RecordRegistryCheckAsync(superAdmin, key, found, ct)).Airline!;
        Assert.Equal(("Found", "Wikidata", "https://www.wikidata.org/wiki/Q849404"),
            (recorded.RegistryStatus, recorded.RegistrySource, recorded.RegistryEntityUrl));

        var published = (await store.SaveAsync(superAdmin, created.Id, input with { IsPublished = true, Version = recorded.Version }, null, ct)).Airline!;
        Assert.True(published.IsPublished);
        var catalog = await scope.ServiceProvider.GetRequiredService<ICommercialCatalogStore>().GetPublicAsync(ct);
        Assert.Equal("Wikidata", Assert.Single(catalog.Airlines, airline => airline.Id == created.Id).RegistrySource);

        // Changing a code makes the check stale: it is cleared and publishing needs a new check.
        var changed = await store.SaveAsync(superAdmin, created.Id, input with { IcaoCode = "CMQ", IsPublished = true,
            Version = published.Version }, null, ct);
        Assert.Equal("registry_check_required", changed.Code);
        var unpublished = (await store.SaveAsync(superAdmin, created.Id, input with { IcaoCode = "CMQ", Version = published.Version }, null, ct)).Airline!;
        Assert.Null(unpublished.RegistryStatus);
        Assert.Equal(CatalogMutationFailure.Conflict, (await store.RecordRegistryCheckAsync(superAdmin, key, found, ct)).Failure);

        // A manual verification with its source remains the alternative to the registry.
        var manual = await store.SaveAsync(superAdmin, created.Id, input with
        {
            IcaoCode = "CMQ", LegalName = "Compañía Panameña de Aviación, S.A.", IsVerified = true,
            VerificationSourceUrl = "https://www.copaair.com/es-gs/legal/", IsPublished = true, Version = unpublished.Version,
        }, null, ct);
        Assert.Null(manual.Failure);
        Assert.True(await context.AuditEntries.AnyAsync(entry => entry.Action == "commercial.airline.registry_checked" &&
            entry.EntityPublicId == created.Id, ct));

        var chain = context.Database.GetMigrations().ToArray();
        var previous = chain[Array.IndexOf(chain, RegistryMigration) - 1];
        await context.CommercialAirlineProfiles.Where(item => item.PublicId == created.Id).ExecuteUpdateAsync(update => update
            .SetProperty(item => item.RegistryStatus, AirlineRegistryStatus.Found)
            .SetProperty(item => item.RegistryCheckedAt, DateTimeOffset.UtcNow), ct);
        var failure = await Assert.ThrowsAsync<SqlException>(() => context.GetService<IMigrator>().MigrateAsync(previous, ct));
        Assert.Equal(52332, failure.Number);
    }
}
