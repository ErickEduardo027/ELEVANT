using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Commercial;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>
/// Professor's review: the airline's tax identifier travels from the public request to its organization, and the
/// public-registry check (ADR-0023) runs at submission and approval and blocks an unconfirmed airline unless
/// Superadministración verified it by hand with an official source. The registries are fakes: no test asks Wikidata.
/// </summary>
public sealed partial class SqlServerMigrationTests
{
    private const string TaxRegistrationMigration = "20261115233439_AddAirlineTaxRegistrationAndRequestRegistryCheck";

    [Fact]
    public async Task TaxRegistrationMigrationIsAdditiveAndRoundTrips()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var context = CreateContext(database.ConnectionString);
        async Task<int> ColumnsAsync() => await context.Database.SqlQuery<int>($"""
            SELECT COUNT(*) AS Value FROM sys.columns
            WHERE (object_id = OBJECT_ID(N'commercial.service_requests') AND name IN (N'tax_registration',
                N'tax_registration_country_code', N'registry_status', N'registry_source', N'registry_checked_at',
                N'registry_detail'))
               OR (object_id = OBJECT_ID(N'iam.organizations') AND name IN (N'tax_registration',
                N'tax_registration_country_code'))
            """).SingleAsync(ct);
        var chain = context.Database.GetMigrations().ToArray();
        var previous = chain[Array.IndexOf(chain, TaxRegistrationMigration) - 1];
        Assert.Equal(8, await ColumnsAsync());
        // The seed never writes them: existing rows keep NULL (no data update in the migration).
        Assert.Equal(0, await context.Organizations.CountAsync(item => item.TaxRegistration != null, ct));
        await context.GetService<IMigrator>().MigrateAsync(previous, ct);
        Assert.Equal(0, await ColumnsAsync());
        await context.GetService<IMigrator>().MigrateAsync(cancellationToken: ct);
        Assert.Equal(8, await ColumnsAsync());
    }

    [Fact]
    public async Task AnAirlineTheRegistriesDoNotFindIsApprovedOnlyAfterSuperadminVerifiesItByHand()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var catalog = await scope.ServiceProvider.GetRequiredService<ICommercialCatalogStore>().GetPublicAsync(ct);
        var registry = new FixedRegistry("NotFound");
        var intake = new SubmitCommercialRequestHandler(scope.ServiceProvider.GetRequiredService<ICommercialIntakeStore>(),
            registry);
        var workflow = scope.ServiceProvider.GetRequiredService<ICommercialWorkflowStore>();
        var decisions = new DecideCommercialRequestHandler(workflow, registry);
        var airlines = scope.ServiceProvider.GetRequiredService<ICommercialAirlineManagementStore>();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var station = (await workflow.ListStationsAsync(ContractsAdministrator, ct))!.Single();
        async Task<CommercialInboxRequestData> ItemAsync(Guid id) => (await workflow.ListInboxAsync(ContractsAdministrator,
                new CommercialInboxQuery(CommercialInboxQuery.All, null, 1, 50), ct))!
            .Requests.Single(item => item.Id == id);
        async Task<CommercialWorkflowResult> ApproveAsync(Guid id) => await decisions.HandleAsync(ContractsAdministrator,
            id, new ReviewCommercialInput(true, null, [station.Id], (await ItemAsync(id)).Version), Guid.NewGuid(), ct);

        // The proposal is checked when it is submitted; the RNC is stored as its 9 digits.
        var requestId = Guid.NewGuid();
        Assert.True((await intake.HandleAsync(CommercialApplication(requestId, Guid.Empty, catalog.Services[0].Id,
            "ops@quetzal.example.com") with
        {
            ProposedAirline = new CommercialAirlineProposal("Quetzal Air", "DO", null, "QZZ", "https://quetzal.example.com/"),
            TaxRegistration = "1-31-23456-9",
        }, ct)).IsSuccess);
        Assert.Equal(("Quetzal Air", "QZZ"), registry.Asked);
        var submitted = await ItemAsync(requestId);
        Assert.Equal(new CommercialTaxRegistrationData("131234569", "DO", "RNC 1-31-23456-9"), submitted.TaxRegistration);
        Assert.Equal(("NotFound", "OpenFlights", false), (submitted.RegistryCheck?.Status, submitted.RegistryCheck?.Source,
            submitted.RegistryCheck?.FromCatalog));
        Assert.Null(submitted.ManualVerification);

        // Contratos verifies it (a new profile) and corrects the RNC; a foreign id for a Dominican airline is refused.
        Assert.Equal("invalid_tax_registration", (await workflow.VerifyRequestAirlineAsync(ContractsAdministrator,
            requestId, Guid.NewGuid(), new VerifyRequestAirlineInput(submitted.Version, null, "Quetzal Air S.R.L.", "DO",
                null, "QZZ", "https://aoc.example.gob.do/qzz", "B-85850394", "ES"), ct)).Code);
        Assert.Equal("invalid_tax_registration", (await workflow.VerifyRequestAirlineAsync(ContractsAdministrator,
            requestId, Guid.NewGuid(), new VerifyRequestAirlineInput(submitted.Version, null, "Quetzal Air S.R.L.", "DO",
                null, "QZZ", "https://aoc.example.gob.do/qzz", "101-12345-6", "DO"), ct)).Code);
        var corrected = await workflow.VerifyRequestAirlineAsync(ContractsAdministrator, requestId, Guid.NewGuid(),
            new VerifyRequestAirlineInput(submitted.Version, null, "Quetzal Air S.R.L.", "DO", null, "QZZ",
                "https://aoc.example.gob.do/qzz", "130000001", "DO"), ct);
        Assert.True(corrected.IsSuccess, corrected.Code);
        Assert.Equal("RNC 1-30-00000-1", (await ItemAsync(requestId)).TaxRegistration?.Display);
        Assert.True((await workflow.ConfirmRepresentativeAsync(ContractsAdministrator, requestId, Guid.NewGuid(),
            new ConfirmCommercialRepresentativeInput((await ItemAsync(requestId)).Version,
                "Confirmado con la central de operaciones de la aerolínea."), ct)).IsSuccess);

        // Verified by Contratos only, the approval is refused and the verdict stays on the request.
        var refused = await ApproveAsync(requestId);
        Assert.Equal((CommercialWorkflowFailure.AirlineNotInPublicRegistry, "airline_not_in_public_registry"),
            (refused.Failure!.Value, refused.Code));
        var blocked = await ItemAsync(requestId);
        Assert.Equal(("InReview", "NotFound"), (blocked.Status, blocked.RegistryCheck?.Status));
        var internalId = await context.ServiceRequests.Where(item => item.PublicId == requestId).Select(item => item.Id)
            .SingleAsync(ct);
        Assert.False(await context.Contracts.AnyAsync(item => item.OriginatingServiceRequestId == internalId, ct));

        // Superadministración confirms the same verification in «Aerolíneas»: it takes it over as a manual one.
        var profile = (await airlines.ListAsync(SuperAdministrator, ct))!.Single(item => item.Id == blocked.AirlineProfileId);
        var saved = await airlines.SaveAsync(SuperAdministrator, profile.Id, new ManagedAirlineInput(profile.SourceName,
            profile.DisplayName, profile.LegalName, profile.Region, profile.CountryCode, profile.IataCode, profile.IcaoCode,
            profile.LogoUrl, profile.SourceUrl, profile.VerificationSourceUrl, true, true, profile.Version), Guid.NewGuid(), ct);
        Assert.Null(saved.Failure);
        var manual = await ItemAsync(requestId);
        Assert.Equal("https://aoc.example.gob.do/qzz", manual.ManualVerification?.VerificationSourceUrl);

        // A Contratos re-verification with the same evidence keeps the superadministrator as verifier.
        Assert.True((await workflow.VerifyRequestAirlineAsync(ContractsAdministrator, requestId, Guid.NewGuid(),
            new VerifyRequestAirlineInput(manual.Version, null, "Quetzal Air S.R.L.", "DO", null, "QZZ",
                "https://aoc.example.gob.do/qzz"), ct)).IsSuccess);
        Assert.NotNull((await ItemAsync(requestId)).ManualVerification);

        // Now the approval passes without asking the registries, and the RNC reaches the airline's organization.
        var calls = registry.Calls;
        var approved = await ApproveAsync(requestId);
        Assert.True(approved.IsSuccess, approved.Code);
        Assert.Equal(calls, registry.Calls);
        var organization = await (from airline in context.Airlines.AsNoTracking()
                                  join item in context.Organizations.AsNoTracking() on airline.OrganizationId equals item.Id
                                  where airline.IcaoCode == "QZZ"
                                  select item).SingleAsync(ct);
        Assert.Equal(("130000001", "DO"), (organization.TaxRegistration, organization.TaxRegistrationCountryCode));
    }

    [Fact]
    public async Task AnUnavailableRegistryDoesNotBlockAndAFoundVerdictIsStoredWithTheApproval()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var catalog = await scope.ServiceProvider.GetRequiredService<ICommercialCatalogStore>().GetPublicAsync(ct);
        var registry = new FixedRegistry(AirlineRegistryCheck.Unavailable);
        var intake = new SubmitCommercialRequestHandler(scope.ServiceProvider.GetRequiredService<ICommercialIntakeStore>(),
            registry);
        var workflow = scope.ServiceProvider.GetRequiredService<ICommercialWorkflowStore>();
        var decisions = new DecideCommercialRequestHandler(workflow, registry);
        var station = (await workflow.ListStationsAsync(ContractsAdministrator, ct))!.Single();
        async Task<CommercialInboxRequestData> ItemAsync(Guid id) => (await workflow.ListInboxAsync(ContractsAdministrator,
                new CommercialInboxQuery(CommercialInboxQuery.All, null, 1, 50), ct))!
            .Requests.Single(item => item.Id == id);

        var requestId = Guid.NewGuid();
        Assert.True((await intake.HandleAsync(CommercialApplication(requestId, Guid.Empty, catalog.Services[0].Id,
            "ops@ceiba.example.com") with
        {
            ProposedAirline = new CommercialAirlineProposal("Ceiba Cargo", "US", null, "CBZ", null),
            TaxRegistration = " EIN 12-3456789 ", TaxRegistrationCountryCode = "US",
        }, ct)).IsSuccess);
        Assert.Equal(("Unavailable", "Id. fiscal EIN 12-3456789 (US)"),
            ((await ItemAsync(requestId)).RegistryCheck?.Status, (await ItemAsync(requestId)).TaxRegistration?.Display));
        Assert.True((await workflow.VerifyRequestAirlineAsync(ContractsAdministrator, requestId, Guid.NewGuid(),
            new VerifyRequestAirlineInput((await ItemAsync(requestId)).Version, null, "Ceiba Cargo LLC", "US", null, "CBZ",
                "https://registry.example.gov/cbz"), ct)).IsSuccess);
        Assert.True((await workflow.ConfirmRepresentativeAsync(ContractsAdministrator, requestId, Guid.NewGuid(),
            new ConfirmCommercialRepresentativeInput((await ItemAsync(requestId)).Version,
                "Confirmado con la central de operaciones de la aerolínea."), ct)).IsSuccess);
        // «Unavailable» lets Contratos approve; the warning stays on the request.
        var approved = await decisions.HandleAsync(ContractsAdministrator, requestId,
            new ReviewCommercialInput(true, null, [station.Id], (await ItemAsync(requestId)).Version), Guid.NewGuid(), ct);
        Assert.True(approved.IsSuccess, approved.Code);
        Assert.Equal(("Approved", "Unavailable"), ((await ItemAsync(requestId)).Status, (await ItemAsync(requestId)).RegistryCheck?.Status));
    }

    /// <summary>A registry answering a fixed verdict; it never leaves the process.</summary>
    private sealed class FixedRegistry(string status) : IAirlineRegistryLookup
    {
        public (string, string?)? Asked { get; private set; }
        public int Calls { get; private set; }

        public Task<AirlineRegistryCheck> CheckAsync(string name, string? iataCode, string? icaoCode,
            CancellationToken cancellationToken = default)
        {
            Asked = (name, icaoCode);
            Calls++;
            return Task.FromResult(new AirlineRegistryCheck(status, status == AirlineRegistryCheck.Unavailable ? null : "OpenFlights",
                null, null, null, null, null, [$"Ninguna aerolínea del registro usa el ICAO {icaoCode}."], DateTimeOffset.UtcNow));
        }
    }
}
