using System.Text;
using System.Security.Cryptography;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Commercial;
using Elevant.Infrastructure.Persistence;
using Elevant.Infrastructure.Persistence.Seed;
using Elevant.Persistence;
using Elevant.Persistence.Finance;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    [Fact]
    public async Task RecordedLocalAcceptancesFormalizeOnlyAfterBothActorsAndNotRetroactively()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seed = CreateContext(seederConnection))
            await new DevelopmentDataSeeder(seed).SeedAsync(new DevelopmentAccountPasswords(
                InitialPasswords.AdminOcc, InitialPasswords.RampAgent,
                InitialPasswords.AirlineClient, InitialPasswords.HumanResources,
                InitialPasswords.Contracts, InitialPasswords.Finance,
                "Synthetic-SuperAdmin!987"), cancellationToken);

        var archive = Path.Combine(Path.GetTempPath(), "elevant-contract-acceptance-" + Guid.NewGuid().ToString("N"));
        try
        {
            var config = new ConfigurationBuilder().AddInMemoryCollection(
                new Dictionary<string, string?>
                {
                    ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString,
                    ["ContractSigning:Mode"] = "AcademicLocal",
                    ["ContractSigning:Enabled"] = "true",
                    ["ContractSigning:LocalArchiveDirectory"] = archive,
                }).Build();
            var services = new ServiceCollection().AddLogging()
                .AddSingleton<TimeProvider>(TimeProvider.System)
                .AddSingleton<IConfiguration>(config)
                .AddPersistence(config);
            services.AddSingleton<IRecordedContractPdfRenderer, RecordedContractPdfRenderer>();
            services.AddScoped<IContractObjectStore>(_ => new LocalContractObjectStore(archive));
            services.AddSingleton<IContractSignGateway>(new SyntheticSignGateway());
            services.AddSingleton<IContractDocumentGenerator>(new SyntheticContractGenerator());
            await using var provider = services.BuildServiceProvider();
            await using var scope = provider.CreateAsyncScope();
            var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
            var catalog = await scope.ServiceProvider.GetRequiredService<ICommercialCatalogStore>()
                .GetPublicAsync(cancellationToken);
            var intake = new SubmitCommercialRequestHandler(
                scope.ServiceProvider.GetRequiredService<ICommercialIntakeStore>());
            var requestId = Guid.NewGuid();
            Assert.True((await intake.HandleAsync(new SubmitCommercialRequestCommand(requestId,
                catalog.Airlines[0].Id, [catalog.Services[0].Id], "María Pérez",
                "Representante legal", "maria@example.test", "+1 809 555 0100", true),
                cancellationToken)).IsSuccess);
            var contractsActor = Guid.Parse("40000000-0000-7000-8000-000000000005");
            var financeActor = Guid.Parse("40000000-0000-7000-8000-000000000006");
            var superAdminActor = Guid.Parse("40000000-0000-7000-8000-000000000007");
            var occActor = Guid.Parse("40000000-0000-7000-8000-000000000001");
            var workflow = scope.ServiceProvider.GetRequiredService<ICommercialWorkflowStore>();
            var station = Assert.Single((await workflow.ListStationsAsync(contractsActor,
                cancellationToken))!);
            Assert.True((await workflow.VerifyAirlineAsync(contractsActor,
                catalog.Airlines[0].Id, new VerifyAirlineInput("Test Carrier LLC", "DO",
                    "ZX", "ZZX", "https://example.test/airline-record", null),
                cancellationToken)).IsSuccess);
            var decision = await workflow.DecideAsync(contractsActor, requestId,
                new ReviewCommercialInput(true, null, [station.Id]), cancellationToken);
            Assert.True(decision.IsSuccess, decision.Failure?.ToString());
            var contract = await context.Contracts.SingleAsync(item =>
                item.PublicId == decision.ResourceId, cancellationToken);
            var contractedAirlineId = (await context.Airlines.AsNoTracking()
                .SingleAsync(item => item.Id == contract.AirlineId, cancellationToken)).PublicId;
            var provisioned = await scope.ServiceProvider.GetRequiredService<ICommercialProvisioningStore>()
                .ProvisionAsync(superAdminActor, requestId,
                    new ProvisionAirlineInput("maria@example.test", "Synthetic-AirlineNew!234"),
                    cancellationToken);
            Assert.True(provisioned.IsSuccess, provisioned.Failure?.ToString());
            var airlineActor = provisioned.AccountId!.Value;
            var draftStore = scope.ServiceProvider.GetRequiredService<IContractDraftStore>();
            var draft = Assert.Single((await draftStore.ListForAirlineAsync(airlineActor,
                cancellationToken))!);
            var priorDate = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1);
            var update = await draftStore.UpdateAsync(contractsActor, draft.Id,
                new UpdateContractDraftInput(priorDate, null, "USD", "Condiciones de prueba aprobadas.",
                    draft.Rates.Select(rate => new UpdateDraftRateInput(rate.Id,
                        rate.BillingUnit, 125m, 0m, true)).ToArray()), cancellationToken);
            Assert.True(update.IsSuccess, update.Failure?.ToString());
            var aviamUser = await context.Users.SingleAsync(item => item.PublicId == contractsActor,
                cancellationToken);
            var airlineUser = await context.Users.SingleAsync(item => item.PublicId == airlineActor,
                cancellationToken);
            aviamUser.MustChangePassword = false;
            airlineUser.MustChangePassword = false;
            await context.SaveChangesAsync(cancellationToken);
            var signing = scope.ServiceProvider.GetRequiredService<IContractSigningStore>();
            Assert.True((await signing.SetSignersAsync(contractsActor, draft.Id, contractsActor,
                cancellationToken)).IsSuccess);
            Assert.True((await draftStore.ActivateAsync(contractsActor, draft.Id,
                cancellationToken)).IsSuccess);
            var finance = scope.ServiceProvider.GetRequiredService<IFinanceTariffBookStore>();
            var pending = Assert.Single((await finance.ListContractApprovalsAsync(financeActor,
                true, cancellationToken))!, item => item.VersionId == draft.Id);
            Assert.True((await finance.DecideContractApprovalAsync(financeActor, draft.Id,
                new DecideContractApprovalInput("Approved", null, pending.Version),
                cancellationToken)).IsSuccess);
            Assert.Equal(ContractStatus.Draft, (await context.Contracts.AsNoTracking()
                .SingleAsync(item => item.Id == contract.Id, cancellationToken)).Status);
            Assert.Null((await context.Contracts.AsNoTracking()
                .SingleAsync(item => item.Id == contract.Id, cancellationToken)).SignedOn);
            var options = scope.ServiceProvider.GetRequiredService<IManualTurnaroundOptionsStore>();
            Assert.DoesNotContain((await options.GetAsync(occActor, station.Id,
                DateOnly.FromDateTime(DateTime.UtcNow), cancellationToken))!.Airlines,
                item => item.Id == contractedAirlineId);

            var preview = await signing.PreviewAsync(contractsActor, draft.Id, cancellationToken);
            Assert.True(preview.IsSuccess, preview.Failure?.ToString());
            var issued = await signing.IssueAsync(contractsActor, draft.Id, cancellationToken);
            Assert.True(issued.IsSuccess, issued.Failure?.ToString());
            Assert.Equal(issued.Value!.DraftSha256, (await signing.IssueAsync(contractsActor,
                draft.Id, cancellationToken)).Value!.DraftSha256);
            Assert.True((await signing.GetAirlineDraftAsync(airlineActor, contract.PublicId,
                cancellationToken)).IsSuccess);
            var hash = issued.Value.DraftSha256!;
            Assert.Equal(ContractSigningFailure.Conflict,
                (await signing.AcceptAirlineAsync(airlineActor, contract.PublicId,
                    Guid.NewGuid(), hash, cancellationToken)).Failure);
            var aviamRequest = Guid.NewGuid();
            Assert.True((await signing.AcceptAviamAsync(contractsActor, draft.Id,
                aviamRequest, hash, cancellationToken)).IsSuccess);
            Assert.True((await signing.AcceptAviamAsync(contractsActor, draft.Id,
                aviamRequest, hash, cancellationToken)).IsSuccess);
            Assert.Equal(ContractStatus.Draft, (await context.Contracts.AsNoTracking()
                .SingleAsync(item => item.Id == contract.Id, cancellationToken)).Status);
            var airlineRequest = Guid.NewGuid();
            Assert.True((await signing.AcceptAirlineAsync(airlineActor, contract.PublicId,
                airlineRequest, hash, cancellationToken)).IsSuccess);
            Assert.True((await signing.AcceptAirlineAsync(airlineActor, contract.PublicId,
                airlineRequest, hash, cancellationToken)).IsSuccess);
            var formalized = await context.Contracts.AsNoTracking().SingleAsync(item =>
                item.Id == contract.Id, cancellationToken);
            Assert.Equal(ContractStatus.Active, formalized.Status);
            Assert.Equal(DateOnly.FromDateTime(DateTime.UtcNow), formalized.SignedOn);
            Assert.True((await signing.GetFinalPdfAsync(airlineActor, contract.PublicId,
                cancellationToken)).IsSuccess);
            Assert.True((await signing.GetManagedEvidenceAsync(contractsActor, draft.Id,
                true, cancellationToken)).IsSuccess);
            Assert.DoesNotContain((await options.GetAsync(occActor, station.Id,
                priorDate, cancellationToken))!.Airlines,
                item => item.Id == contractedAirlineId);
            Assert.Contains((await options.GetAsync(occActor, station.Id,
                DateOnly.FromDateTime(DateTime.UtcNow), cancellationToken))!.Airlines,
                item => item.Id == contractedAirlineId);
        }
        finally
        {
            var tempRoot = Path.GetFullPath(Path.GetTempPath());
            if (Directory.Exists(archive) &&
                Path.GetFullPath(archive).StartsWith(tempRoot, StringComparison.OrdinalIgnoreCase))
                Directory.Delete(archive, recursive: true);
        }
    }

    private static async Task<(ServiceProvider Provider, InMemoryFinancialObjects Objects,
        SyntheticSignGateway Gateway, SyntheticContractGenerator Generator)>
        CreateSyntheticSigningProviderAsync(string connectionString,
            CancellationToken cancellationToken)
    {
        var template = "PK\u0003\u0004Synthetic DOCX fixture"u8.ToArray();
        var objects = new InMemoryFinancialObjects();
        await objects.PutAsync("contracts/templates/synthetic.docx", template,
            cancellationToken);
        var gateway = new SyntheticSignGateway();
        var generator = new SyntheticContractGenerator();
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?>
            {
                ["ConnectionStrings:ElevantDatabase"] = connectionString,
                ["ContractSigning:Enabled"] = "true",
                ["ContractSigning:PolicyApproved"] = "true",
                ["ContractSigning:RetentionApproved"] = "true",
                ["ContractSigning:Template:LegalApproved"] = "true",
                ["ContractSigning:Template:ContractsApproved"] = "true",
                ["ContractSigning:Template:ObjectKey"] = "contracts/templates/synthetic.docx",
                ["ContractSigning:Template:Version"] = "synthetic-v1",
                ["ContractSigning:Template:Sha256"] = Convert.ToHexString(SHA256.HashData(template)),
                ["ContractSigning:AdobePdf:ClientId"] = "synthetic-test-only",
                ["ContractSigning:AdobePdf:ClientSecret"] = "synthetic-test-only",
                ["ContractSigning:AdobeSign:ApiBaseUrl"] = "https://api.echosign.com",
                ["ContractSigning:AdobeSign:ClientId"] = "synthetic-test-only",
                ["ContractSigning:AdobeSign:ClientSecret"] = "synthetic-test-only",
                ["ContractSigning:AdobeSign:RefreshToken"] = "synthetic-test-only",
                ["MediaStorage:Endpoint"] = "https://objects.example.test",
                ["MediaStorage:Bucket"] = "synthetic-only",
                ["MediaStorage:AccessKey"] = "synthetic-test-only",
                ["MediaStorage:SecretKey"] = "synthetic-test-only",
            }).Build();
        var services = new ServiceCollection()
            .AddLogging().AddSingleton<TimeProvider>(TimeProvider.System)
            .AddSingleton<IConfiguration>(configuration)
            .AddPersistence(configuration);
        services.AddSingleton<IPrivateFinancialObjectStore>(objects);
        services.AddSingleton<IContractSignGateway>(gateway);
        services.AddSingleton<IContractDocumentGenerator>(generator);
        services.AddSingleton<IRecordedContractPdfRenderer, RecordedContractPdfRenderer>();
        return (services.BuildServiceProvider(), objects, gateway, generator);
    }

    private sealed class SyntheticContractGenerator : IContractDocumentGenerator
    {
        public string? LastMergeJson { get; private set; }

        public Task<byte[]> GenerateAsync(byte[] templateDocx, string mergeJson,
            CancellationToken cancellationToken = default)
        {
            LastMergeJson = mergeJson;
            return Task.FromResult(Encoding.UTF8.GetBytes("%PDF-1.7\nSynthetic draft\n%%EOF"));
        }
    }

    private sealed class SyntheticSignGateway : IContractSignGateway
    {
        private string? _externalId;
        private string[] _signers = [];
        public int CreateCount { get; private set; }
        public string Status { get; set; } = "OUT_FOR_SIGNATURE";
        public bool AirlineTurn { get; set; }
        public byte[] SignedPdf { get; } = Encoding.UTF8.GetBytes("%PDF-1.7\nBoth signed\n%%EOF");
        public byte[] AuditPdf { get; } = Encoding.UTF8.GetBytes("%PDF-1.7\nAudit trail\n%%EOF");

        public Task<string?> FindByExternalIdAsync(string externalId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(_externalId == externalId ? "synthetic-adobe-agreement" : null);

        public Task<string> CreateAsync(string externalId, string title, byte[] pdf,
            string aviamEmail, string airlineEmail,
            CancellationToken cancellationToken = default)
        {
            CreateCount++;
            _externalId = externalId;
            _signers = [aviamEmail, airlineEmail];
            return Task.FromResult("synthetic-adobe-agreement");
        }

        public Task<SigningAgreementState> GetStateAsync(string agreementId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(new SigningAgreementState(Status, _signers));

        public Task<Uri?> GetSigningUrlAsync(string agreementId, string email,
            CancellationToken cancellationToken = default) =>
            Task.FromResult<Uri?>(AirlineTurn && _signers.Length == 2 &&
                string.Equals(email, _signers[1], StringComparison.OrdinalIgnoreCase)
                ? new Uri("https://secure.adobesign.com/sign/synthetic") : null);

        public Task<byte[]> GetSignedPdfAsync(string agreementId,
            CancellationToken cancellationToken = default) => Task.FromResult(SignedPdf);

        public Task<byte[]> GetAuditPdfAsync(string agreementId,
            CancellationToken cancellationToken = default) => Task.FromResult(AuditPdf);
    }
}
