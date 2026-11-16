using Elevant.Application.Abstractions.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Infrastructure.Persistence.Seed;
using Elevant.Persistence.Commercial;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>
/// The catalog profile's tax identifier (an RNC for a Dominican airline) that Superadministración records and the
/// public request prefills, and a second «Completar fichas AVIAM» that completes the identities added to the AVIAM
/// reference after the first one without touching a profile a person edited.
/// </summary>
public sealed partial class SqlServerMigrationTests
{
    private const string ProfileTaxRegistrationMigration = "20261116145344_AddAirlineProfileTaxRegistration";

    [Fact]
    public async Task ProfileTaxRegistrationMigrationIsAdditiveAndRoundTrips()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var context = CreateContext(database.ConnectionString);
        async Task<int> ColumnsAsync() => await context.Database.SqlQuery<int>($"""
            SELECT COUNT(*) AS Value FROM sys.columns
            WHERE object_id = OBJECT_ID(N'commercial.airline_profiles')
              AND name IN (N'tax_registration', N'tax_registration_country_code')
            """).SingleAsync(ct);
        var chain = context.Database.GetMigrations().ToArray();
        var previous = chain[Array.IndexOf(chain, ProfileTaxRegistrationMigration) - 1];
        Assert.Equal(2, await ColumnsAsync());
        // The seed never writes it (no real RNC is known): every seeded profile keeps NULL.
        Assert.Equal(0, await context.CommercialAirlineProfiles.CountAsync(item => item.TaxRegistration != null, ct));
        await context.GetService<IMigrator>().MigrateAsync(previous, ct);
        Assert.Equal(0, await ColumnsAsync());
        await context.GetService<IMigrator>().MigrateAsync(cancellationToken: ct);
        Assert.Equal(2, await ColumnsAsync());
    }

    [Fact]
    public async Task SuperadminRecordsTheAirlineRncWithoutVoidingItsVerificationAndThePublicCatalogReturnsIt()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var store = scope.ServiceProvider.GetRequiredService<ICommercialAirlineManagementStore>();
        var catalogs = scope.ServiceProvider.GetRequiredService<ICommercialCatalogStore>();

        var input = new ManagedAirlineInput("RNC TEST", "Caribe Rnc", "Caribe Rnc S.R.L.", "Caribe", "DO", null, "QRN",
            null, "https://caribe-rnc.example.test/", "https://aoc.example.gob.do/qrn", IsVerified: true, IsPublished: true,
            Version: null, TaxRegistration: "1-30-00000-1", TaxRegistrationCountryCode: "DO");
        // A Dominican airline's identifier is an RNC of 9 digits: a shorter one or a foreign country is refused.
        Assert.Equal(CatalogMutationFailure.Invalid, (await store.SaveAsync(SuperAdministrator, null,
            input with { TaxRegistration = "13000000" }, null, ct)).Failure);
        Assert.Equal(CatalogMutationFailure.Invalid, (await store.SaveAsync(SuperAdministrator, null,
            input with { TaxRegistrationCountryCode = "US" }, null, ct)).Failure);
        Assert.Equal(CatalogMutationFailure.Invalid, (await store.SaveAsync(SuperAdministrator, null,
            input with { TaxRegistrationCountryCode = null }, null, ct)).Failure);

        // Stored canonical (the 9 digits), read back by Superadministración and by the public catalog.
        var created = (await store.SaveAsync(SuperAdministrator, null, input, null, ct)).Airline!;
        Assert.Equal(("130000001", "DO"), (created.TaxRegistration, created.TaxRegistrationCountryCode));
        var listed = Assert.Single((await catalogs.GetPublicAsync(ct)).Airlines, item => item.Id == created.Id);
        Assert.Equal(("130000001", "DO"), (listed.TaxRegistration, listed.TaxRegistrationCountryCode));
        // A profile without one omits both keys in the public catalog (expand phase).
        Assert.All((await catalogs.GetPublicAsync(ct)).Airlines.Where(item => item.Id != created.Id),
            item => Assert.Null(item.TaxRegistration));

        // A registry check is recorded; changing only the RNC keeps it and the manual verification.
        var key = (await store.RegistryKeyAsync(SuperAdministrator, created.Id, ct)).Key!;
        var checkedProfile = (await store.RecordRegistryCheckAsync(SuperAdministrator, key, new AirlineRegistryCheck(
            "Found", "OpenFlights", "Caribe Rnc", null, "QRN", "DO", null, [], DateTimeOffset.UtcNow), ct)).Airline!;
        var verifiedAt = await context.CommercialAirlineProfiles.AsNoTracking().Where(item => item.PublicId == created.Id)
            .Select(item => item.VerifiedAt).SingleAsync(ct);
        var edited = await store.SaveAsync(SuperAdministrator, created.Id, input with
        {
            TaxRegistration = "131234569", Version = checkedProfile.Version,
        }, Guid.NewGuid(), ct);
        Assert.Null(edited.Failure);
        Assert.Equal(("131234569", "Found", true), (edited.Airline!.TaxRegistration, edited.Airline.RegistryStatus,
            edited.Airline.IsVerified));
        Assert.Equal(verifiedAt, await context.CommercialAirlineProfiles.AsNoTracking()
            .Where(item => item.PublicId == created.Id).Select(item => item.VerifiedAt).SingleAsync(ct));
        var audit = await context.AuditEntries.AsNoTracking().Where(entry => entry.EntityPublicId == created.Id &&
            entry.Action == "commercial.airline.updated").Select(entry => entry.MetadataJson).SingleAsync(ct);
        Assert.Contains("airline.tax_registration", audit);
        Assert.Contains("RNC 1-31-23456-9", audit);

        // Emptying it clears both values.
        var cleared = (await store.SaveAsync(SuperAdministrator, created.Id, input with
        {
            TaxRegistration = "", TaxRegistrationCountryCode = "", Version = edited.Airline.Version,
        }, Guid.NewGuid(), ct)).Airline!;
        Assert.Equal((null, null), (cleared.TaxRegistration, cleared.TaxRegistrationCountryCode));
    }

    [Fact]
    public async Task ASecondEnrichmentCompletesNewReferenceIdentitiesButNeverAProfileAPersonEdited()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var store = scope.ServiceProvider.GetRequiredService<ICommercialAirlineManagementStore>();
        var superAdminId = await context.Users.Where(user => user.PublicId == SuperAdministrator).Select(user => user.Id)
            .SingleAsync(ct);

        // A database seeded and enriched before these identities were in the reference: the profiles have no
        // identity and an UpdatedAt the first «Completar fichas AVIAM» moved away from the fixture instant.
        async Task<Elevant.Domain.Entities.Commercial.CommercialAirlineProfile> EnrichedEarlierAsync(string name,
            string? personAction = null, bool registryChecked = false)
        {
            var profile = await context.CommercialAirlineProfiles.SingleAsync(item => item.SourceName == name, ct);
            profile.LegalName = null;
            profile.IataCode = null;
            profile.IcaoCode = null;
            profile.VerificationSourceUrl = null;
            profile.VerifiedAt = null;
            profile.VerifiedByAccountId = null;
            profile.UpdatedAt = DateTimeOffset.UtcNow.AddDays(-1);
            CommercialAuditWriter.Add(context, superAdminId, "commercial.airline.enriched", "commercial.airline_profiles",
                profile.PublicId);
            if (registryChecked)
            {
                profile.RegistryStatus = AirlineRegistryStatus.NotFound;
                profile.RegistrySource = "OpenFlights";
                profile.RegistryCheckedAt = DateTimeOffset.UtcNow.AddHours(-1);
                CommercialAuditWriter.Add(context, superAdminId, "commercial.airline.registry_checked",
                    "commercial.airline_profiles", profile.PublicId);
            }
            if (personAction is not null)
                CommercialAuditWriter.Add(context, superAdminId, personAction, "commercial.airline_profiles", profile.PublicId);
            return profile;
        }
        var airEuropa = await EnrichedEarlierAsync("AIR EUROPA");
        var copa = await EnrichedEarlierAsync("COPA AIRLINES", registryChecked: true);
        var delta = await EnrichedEarlierAsync("DELTA AIRLINES", personAction: "commercial.airline.updated");
        var jetBlue = await EnrichedEarlierAsync("JETBLUE");
        await context.SaveChangesAsync(ct);
        // Meanwhile Contratos verified another airline with JetBlue's IATA code: the designator is taken.
        Assert.Null((await store.SaveAsync(SuperAdministrator, null, new ManagedAirlineInput("B6 HOLDER", "B6 Holder",
            "B6 Holder Ltd.", "Caribe", "US", "B6", "QBS", null, "https://b6.example.test/", "https://b6.example.test/aoc",
            IsVerified: true, IsPublished: false, Version: null), null, ct)).Failure);

        var first = await store.EnrichHistoricalCatalogAsync(SuperAdministrator, ct);
        Assert.Null(first.Failure);
        Assert.True(first.Changed >= 2);
        foreach (var profile in new[] { airEuropa, copa, delta, jetBlue }) await context.Entry(profile).ReloadAsync(ct);
        var expected = AviamAirlineReference.Verified["AIR EUROPA"];
        Assert.Equal((expected.Legal, "UX", "AEA", expected.Source, superAdminId),
            (airEuropa.LegalName, airEuropa.IataCode, airEuropa.IcaoCode, airEuropa.VerificationSourceUrl,
                airEuropa.VerifiedByAccountId));
        Assert.NotNull(airEuropa.VerifiedAt);
        // A registry check is not a person's edit; it is about the codes it saw, so the new ones clear it.
        Assert.Equal(("CM", "CMP", (AirlineRegistryStatus?)null), (copa.IataCode, copa.IcaoCode, copa.RegistryStatus));
        // A profile a person saved is never touched; a designator another verified airline holds is not reused.
        Assert.Equal((null, null, null), (delta.IataCode, delta.IcaoCode, delta.VerifiedAt));
        Assert.Equal((null, null, null), (jetBlue.IataCode, jetBlue.IcaoCode, jetBlue.VerifiedAt));
        // The public wizard now shows the identity of the completed profile.
        var listed = Assert.Single((await scope.ServiceProvider.GetRequiredService<ICommercialCatalogStore>()
            .GetPublicAsync(ct)).Airlines, item => item.Id == airEuropa.PublicId);
        Assert.Equal(("UX", "AEA", "ES", true), (listed.IataCode, listed.IcaoCode, listed.CountryCode, listed.IsVerified));

        // Running it again changes nothing.
        Assert.Equal(0, (await store.EnrichHistoricalCatalogAsync(SuperAdministrator, ct)).Changed);
    }

    [Fact]
    public async Task TheDevelopmentEnrichmentCopiesTheFictitiousDemoRncsOnlyWhenTurnedOn()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var permissions = scope.ServiceProvider.GetRequiredService<CommercialPermissionGuard>();

        // Every active airline of the list has its identity in the seed; ARKEFLY, the historical brand of TUIFLY
        // NETHERLANDS, leaves the OR/TFL designators to it.
        var seeded = await context.CommercialAirlineProfiles.AsNoTracking().ToDictionaryAsync(item => item.SourceName, ct);
        Assert.Equal(("OR", "TFL"), (seeded["TUIFLY NETHERLANDS"].IataCode, seeded["TUIFLY NETHERLANDS"].IcaoCode));
        Assert.Null(seeded["ARKEFLY"].IcaoCode);
        Assert.All(AviamAirlineReference.Research.Keys.Where(name => name != "ARKEFLY" &&
            !AviamAirlineReference.Archived.Contains(name)), name => Assert.NotNull(seeded[name].IcaoCode));

        // Off (the default), the enrichment never writes an RNC.
        await new EfCommercialAirlineManagementStore(context, permissions).EnrichHistoricalCatalogAsync(SuperAdministrator, ct);
        Assert.Equal(0, await context.CommercialAirlineProfiles.CountAsync(item => item.TaxRegistration != null, ct));

        // On, a profile without identifier gets its demo RNC, audited; one that has an identifier keeps it.
        var kept = await context.CommercialAirlineProfiles.SingleAsync(item => item.SourceName == "AIR EUROPA", ct);
        kept.TaxRegistration = "B85850394";
        kept.TaxRegistrationCountryCode = "ES";
        await context.SaveChangesAsync(ct);
        var result = await new EfCommercialAirlineManagementStore(context, permissions,
            new AirlineCatalogEnrichmentSettings(true)).EnrichHistoricalCatalogAsync(SuperAdministrator, ct);
        Assert.Null(result.Failure);
        var wingo = await context.CommercialAirlineProfiles.AsNoTracking().SingleAsync(item => item.SourceName == "WINGO", ct);
        Assert.Equal((AviamAirlineReference.DevelopmentTaxRegistrations["WINGO"], "DO"),
            (wingo.TaxRegistration, wingo.TaxRegistrationCountryCode));
        Assert.Equal(("B85850394", "ES"), await context.CommercialAirlineProfiles.AsNoTracking()
            .Where(item => item.SourceName == "AIR EUROPA")
            .Select(item => new ValueTuple<string?, string?>(item.TaxRegistration, item.TaxRegistrationCountryCode)).SingleAsync(ct));
        var audit = await context.AuditEntries.AsNoTracking().Where(entry => entry.EntityPublicId == wingo.PublicId &&
            entry.Action == "commercial.airline.enriched").Select(entry => entry.MetadataJson).ToArrayAsync(ct);
        Assert.Contains(audit, json => json != null && json.Contains("airline.tax_registration", StringComparison.Ordinal));
        // The demo RNCs are distinct, 9 digits each.
        Assert.Equal(AviamAirlineReference.DevelopmentTaxRegistrations.Count,
            AviamAirlineReference.DevelopmentTaxRegistrations.Values.Distinct().Count());
        Assert.All(AviamAirlineReference.DevelopmentTaxRegistrations.Values,
            value => Assert.Matches("^13[01][0-9]{6}$", value));
    }
}
