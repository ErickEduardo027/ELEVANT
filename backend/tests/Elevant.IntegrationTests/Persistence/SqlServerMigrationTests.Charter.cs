using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Commercial;
using Elevant.Application.Integration;
using Elevant.Domain.Entities.Commercial;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Enumerations;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    /// <summary>
    /// ADR-0033: OCC enters a flight of a carrier without contract as a charter, assigns it, the agent
    /// adds the services at Finance's base tariff and records the carrier data, the representative
    /// signs the service request (with ID), the Service Order is cash, and Finance confirms the prepayment.
    /// </summary>
    [Fact]
    public async Task CharterIsEnteredAssignedPricedAtTheBaseTariffSignedAndPrepaid()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(ct);
        await database.ConfigureDevelopmentSeederPermissionsAsync(ct);
        await using (var connection = await database.OpenAsDevelopmentSeederAsync(ct))
        await using (var seeder = CreateContext(connection))
            await new Elevant.Infrastructure.Persistence.Seed.DevelopmentDataSeeder(seeder).SeedAsync(InitialPasswords, ct);
        var occ = Guid.Parse("40000000-0000-7000-8000-000000000001");
        var rampAccount = Guid.Parse("40000000-0000-7000-8000-000000000002");
        var finance = await FinanceAccountAsync(database.ConnectionString, ct);
        var station = Guid.Parse("20000000-0000-7000-8000-000000000003");
        var turnaroundId = Guid.Parse("70000000-0000-7000-8000-000000000012");
        var agent = Guid.Parse("50000000-0000-7000-8000-000000000001");
        var installation = Guid.Parse("81000000-0000-7000-8000-000000000073");
        await using var provider = CreateAuthenticationProvider(database.ConnectionString, new PasswordHashCounter());
        async Task<T> Run<T>(Func<IServiceProvider, Task<T>> action)
        {
            await using var scope = provider.CreateAsyncScope();
            return await action(scope.ServiceProvider);
        }

        // 1. Manual entry: a carrier without contract can only come in as a charter; one with a contract never does.
        Guid charterAirline;
        Guid demoAirline;
        Guid standId;
        DateOnly date;
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var organization = new Organization
            {
                PublicId = Guid.CreateVersion7(), Code = "CHARTER-AIR", LegalName = "Charter Air Ltd.",
                DisplayName = "Charter Air", Type = OrganizationType.AirlineCustomer, Status = OrganizationStatus.Active,
                CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
            };
            setup.Organizations.Add(organization);
            await setup.SaveChangesAsync(ct);
            var airline = new Airline
            {
                PublicId = Guid.CreateVersion7(), OrganizationId = organization.Id, IataCode = "C9", IcaoCode = "CQZ",
                Name = "Charter Air", IsActive = true, CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
            };
            setup.Airlines.Add(airline);
            await setup.SaveChangesAsync(ct);
            charterAirline = airline.PublicId;
            var seeded = await setup.Turnarounds.SingleAsync(item => item.PublicId == turnaroundId, ct);
            demoAirline = await setup.Airlines.Where(item => item.Id == seeded.AirlineId).Select(item => item.PublicId)
                .SingleAsync(ct);
            date = seeded.OperationDate;
            standId = await setup.Stands.Where(item => item.Code == "B02").Select(item => item.PublicId).SingleAsync(ct);
        }
        var zone = TimeZoneInfo.FindSystemTimeZoneById("America/Santo_Domingo");
        DateTimeOffset At(int hour) => new(TimeZoneInfo.ConvertTimeToUtc(date.ToDateTime(new TimeOnly(hour, 0)), zone));
        Task<ManualTurnaroundWriteResult> Enter(Guid id, Guid airline, bool charter) => Run(services =>
            services.GetRequiredService<IManualTurnaroundStore>().CreateAsync(new ManualTurnaroundWriteRequest(occ, [station], id,
                station, airline, standId, date, "C9100", "MIA", At(22), "C9101", "MIA", At(23), Guid.NewGuid(), "charter-test",
                charter), ct));
        var manualOptionsList = await Run(services => services.GetRequiredService<IManualTurnaroundOptionsStore>()
            .GetAsync(occ, station, date, ct));
        Assert.Contains(manualOptionsList!.CharterAirlines!, item => item.Id == charterAirline);
        Assert.DoesNotContain(manualOptionsList.CharterAirlines!, item => item.Id == demoAirline);
        Assert.Contains(manualOptionsList.Airlines, item => item.Id == demoAirline);
        var manualCharter = Guid.CreateVersion7();
        Assert.Equal(ManualTurnaroundWriteFailure.Conflict, (await Enter(Guid.CreateVersion7(), charterAirline, false)).Failure);
        Assert.Equal(ManualTurnaroundWriteFailure.Conflict, (await Enter(Guid.CreateVersion7(), demoAirline, true)).Failure);
        Assert.True((await Enter(manualCharter, charterAirline, true)).IsSuccess);
        Assert.True((await Enter(manualCharter, charterAirline, true)).IsSuccess);
        var manualOptions = await Run(services => services.GetRequiredService<IOccPlanningReadStore>()
            .GetOptionsAsync([station], manualCharter, ct));
        Assert.True(manualOptions.Options!.IsCharter);
        Assert.Null(manualOptions.Options.Contract);

        // 2. The seeded flight becomes a charter (no contract, no services) and OCC assigns it.
        long operationInternalId;
        Guid operationId;
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var turnaround = await setup.Turnarounds.SingleAsync(item => item.PublicId == turnaroundId, ct);
            turnaround.ContractVersionId = null;
            var operation = await setup.GroundOperations.SingleAsync(item => item.TurnaroundId == turnaround.Id, ct);
            operationInternalId = operation.Id;
            operationId = operation.PublicId;
            await setup.OperationServices.Where(item => item.GroundOperationId == operation.Id).ExecuteDeleteAsync(ct);
            var occInternal = await setup.Users.Where(user => user.PublicId == occ).Select(user => user.Id).SingleAsync(ct);
            setup.Add(new CharterAgreement
            {
                PublicId = Guid.CreateVersion7(), TurnaroundId = turnaround.Id, AirlineId = turnaround.AirlineId,
                CurrencyCode = CharterRules.CurrencyCode, PrepaymentStatus = CharterPrepaymentStatus.Pending,
                CreatedByAccountId = occInternal, CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
            });
            await setup.SaveChangesAsync(ct);
        }
        var options = await Run(services => services.GetRequiredService<IOccPlanningReadStore>()
            .GetOptionsAsync([station], turnaroundId, ct));
        Assert.True(options.Options!.IsCharter);
        Assert.Empty(options.Options.Services);
        Assert.True(OccPlanningConcurrencyToken.TryDecode(options.Options.Turnaround.ConcurrencyToken, out var version));
        var assigned = await Run(services => services.GetRequiredService<IOccPlanningCommandStore>().AssignOperationAsync(
            new OccAssignmentWriteRequest(occ, [station], turnaroundId, agent, version, Guid.NewGuid(), "charter-assign"), ct));
        Assert.True(assigned.IsSuccess, assigned.Failure?.ToString());

        // 3. The agent adds services at the base tariff (USD) and records what the representative gives.
        Assert.True((await Run(services => services.GetRequiredService<IMobileDeviceCommandStore>().RegisterAsync(
            new MobileDeviceRegistrationWriteRequest(rampAccount, installation, MobilePlatform.Android, "1.2.3",
                "Charter SQL test tablet", "Android 16"), ct))).IsSuccess);
        var view = await Run(services => services.GetRequiredService<ICharterStore>()
            .ReadForAgentAsync(rampAccount, [station], operationId, ct));
        Assert.NotNull(view);
        var baggage = Assert.Single(view.Catalog, item => item.Code == "BAGGAGE");
        Assert.Equal(130m, baggage.UnitPrice);
        Task<CharterWriteResult> Add(Guid key, Guid service, decimal quantity) => Run(services =>
            services.GetRequiredService<ICharterStore>().AddServiceAsync(new CharterServiceWriteRequest(rampAccount, [station],
                operationId, service, quantity, installation, key, "charter-test"), ct));
        var addKey = Guid.NewGuid();
        Assert.True((await Add(addKey, baggage.ServiceDefinitionId, 2)).IsSuccess);
        Assert.True((await Add(addKey, baggage.ServiceDefinitionId, 2)).IsSuccess);
        Assert.Equal(RampExecutionWriteFailure.Conflict, (await Add(Guid.NewGuid(), baggage.ServiceDefinitionId, 1)).Failure);
        Assert.True((await Run(services => services.GetRequiredService<ICharterStore>().UpdateDetailsAsync(
            new CharterDetailsWriteRequest(rampAccount, [station], operationId, "1200 NW 72nd Ave, Miami",
                null, installation, Guid.NewGuid(), "charter-test"), ct))).IsSuccess);
        await using (var check = CreateContext(database.ConnectionString))
        {
            var line = await check.OperationServices.SingleAsync(item => item.GroundOperationId == operationInternalId, ct);
            Assert.Equal((null, 130m, "USD", 2m), (line.ContractServiceRateId, line.UnitPriceSnapshot, line.CurrencyCodeSnapshot,
                line.ContractedQuantity));
            var operation = await check.GroundOperations.SingleAsync(item => item.Id == operationInternalId, ct);
            operation.CurrentStatus = GroundOperationStatus.InProgress;
            operation.ActualStartAt = DateTimeOffset.UtcNow.AddMinutes(-30);
            await check.SaveChangesAsync(ct);
        }

        // 4. The forms: the service request comes first, the Service Order is cash; the request needs the ID.
        var documents = (await Run(services => services.GetRequiredService<IOperationDocumentStore>()
            .ReadForAgentAsync(rampAccount, [station], operationId, ct)))!;
        var request = documents.Documents[0];
        Assert.Equal(OperationDocumentKind.CharterServiceRequest, request.Content.Kind);
        Assert.Equal("MDPC/PUJ", request.Content.Charter!.StationLabel);
        Assert.Equal("1200 NW 72nd Ave, Miami", request.Content.Charter.CarrierAddress);
        // Nothing executed yet: the agreement shows the requested quantity and the total Finance will confirm.
        Assert.Equal((2m, 260m), (request.Content.Services.Single().Quantity, request.Content.TotalAmount!.Value));
        Assert.Equal("Cash", documents.Documents.Single(item => item.Content.Kind == OperationDocumentKind.ServiceOrder)
            .Content.BillingType);
        foreach (var (role, name, identification) in new[]
        {
            (OperationSignatureRole.AirlineRepresentative, "Ana Pérez", "PA1234567"),
            (OperationSignatureRole.AviamAgent, "Riley Ramp", "001-1234567-8"),
        })
            Assert.True((await Run(services => services.GetRequiredService<IOperationDocumentStore>().SignAsync(
                new OperationDocumentSignRequest(rampAccount, [station], operationId, OperationDocumentKind.CharterServiceRequest,
                    role, name, request.ContentSha256, [[0.1m, 0.5m, 0.4m, 0.2m]], DateTimeOffset.UtcNow, installation,
                    Guid.NewGuid(), "charter-test", identification), ct))).IsSuccess);
        var signed = (await Run(services => services.GetRequiredService<IOperationDocumentStore>()
            .ReadForAgentAsync(rampAccount, [station], operationId, ct)))!.Documents[0];
        Assert.True(signed.IsFullySigned);
        Assert.Equal("PA1234567", signed.Signatures.Single(item => item.Role == OperationSignatureRole.AirlineRepresentative)
            .SignerIdentification);

        // 5. Finance sees the charter (signed, 260 USD) and confirms the prepayment once.
        var charters = await Run(services => services.GetRequiredService<ICharterStore>().ListForFinanceAsync([station], ct));
        var charter = Assert.Single(charters, item => item.OperationId == operationId);
        Assert.Equal((true, 260m, "Pending"), (charter.RequestSigned, charter.ServicesTotal, charter.PrepaymentStatus));
        Task<(CharterPrepaymentItem? Item, CharterPrepaymentFailure? Failure)> Confirm(decimal amount, string reference) =>
            Run(services => services.GetRequiredService<ICharterStore>().ConfirmPrepaymentAsync(finance, [station], charter.Id,
                amount, reference, "charter-test", ct));
        Assert.Equal("Confirmed", (await Confirm(260m, "TRF-0001")).Item!.PrepaymentStatus);
        Assert.Null((await Confirm(260m, "TRF-0001")).Failure);
        Assert.Equal(CharterPrepaymentFailure.Conflict, (await Confirm(300m, "TRF-0002")).Failure);
        Assert.Equal(CharterPrepaymentFailure.NotFound, (await Run(services => services.GetRequiredService<ICharterStore>()
            .ConfirmPrepaymentAsync(finance, [Guid.NewGuid()], charter.Id, 260m, "TRF-0001", "charter-test", ct))).Failure);

        // 6. 3-N24: with the prepayment confirmed no service is added; the receipt keeps the code and replays it.
        var extra = view.Catalog.First(item => item.Code != "BAGGAGE");
        var lateKey = Guid.NewGuid();
        var late = await Add(lateKey, extra.ServiceDefinitionId, 1);
        Assert.Equal((RampExecutionWriteFailure.Conflict, CharterCodes.PrepaymentConfirmed), (late.Failure, late.Code));
        Assert.Equal(CharterCodes.PrepaymentConfirmed, (await Add(lateKey, extra.ServiceDefinitionId, 1)).Code);
        // Finance reopens the quotation with its key, its reason and the version it saw; amount and reference stay.
        Task<MasterDataResult<CharterPrepaymentItem>> Reopen(string version, string reason, Guid key) => Run(services =>
            services.GetRequiredService<ICharterStore>().ReopenPrepaymentAsync(finance, [station], charter.Id, reason,
                version, key, "charter-reopen", ct));
        var confirmed = Assert.Single(await Run(services => services.GetRequiredService<ICharterStore>()
            .ListForFinanceAsync([station], ct)), item => item.OperationId == operationId);
        Assert.Equal("version_conflict", (await Reopen("AAAAAAAAAAA=", "El transportista pidió más servicios",
            Guid.NewGuid())).Code);
        var reopenKey = Guid.NewGuid();
        var reopened = await Reopen(confirmed.Version!, "El transportista pidió más servicios", reopenKey);
        Assert.Equal(("Pending", (decimal?)260m, "TRF-0001"), (reopened.Value!.PrepaymentStatus,
            reopened.Value.PrepaymentAmount, reopened.Value.PrepaymentReference));
        Assert.True((await Reopen(confirmed.Version!, "El transportista pidió más servicios", reopenKey)).Replayed);
        Assert.Equal("idempotency_conflict", (await Reopen(confirmed.Version!, "Otro motivo con la misma clave",
            reopenKey)).Code);
        Assert.Equal(CharterCodes.PrepaymentNotConfirmed, (await Reopen(reopened.Value.Version!,
            "El transportista pidió más servicios", Guid.NewGuid())).Code);

        // 7. Services are added again; one added by mistake is retired as not performed and no longer counts.
        Assert.True((await Add(Guid.NewGuid(), extra.ServiceDefinitionId, 1)).IsSuccess);
        Guid extraLine;
        await using (var setup = CreateContext(database.ConnectionString))
        {
            extraLine = await (from line in setup.OperationServices
                               join definition in setup.ServiceDefinitions on line.ServiceDefinitionId equals definition.Id
                               where line.GroundOperationId == operationInternalId && definition.PublicId == extra.ServiceDefinitionId
                               select line.PublicId).SingleAsync(ct);
            await setup.Turnarounds.Where(item => item.PublicId == turnaroundId)
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.CurrentStatus, TurnaroundStatus.InProgress), ct);
        }
        var retireKey = Guid.NewGuid();
        var retired = await Run(services => services.GetRequiredService<IRampOperationServiceCommandStore>()
            .TransitionServiceAsync(new RampOperationServiceTransitionWriteRequest(rampAccount, [station], operationId,
                extraLine, ServiceExecutionStatus.NotPerformed, 0m, "Agregado por error", installation, retireKey, retireKey,
                "charter-retire"), ct));
        Assert.True(retired.IsSuccess, retired.Failure?.ToString());
        Assert.Equal(260m, Assert.Single(await Run(services => services.GetRequiredService<ICharterStore>()
            .ListForFinanceAsync([station], ct)), item => item.OperationId == operationId).ServicesTotal);
        var requested = (await Run(services => services.GetRequiredService<IOperationDocumentStore>()
            .ReadForAgentAsync(rampAccount, [station], operationId, ct)))!.Documents[0].Content;
        var retiredLine = requested.Services.Single(line => line.Code == extra.Code);
        Assert.Equal((0m, (decimal?)0m), (retiredLine.Quantity, retiredLine.Amount));
        Assert.Equal(260m, requested.TotalAmount);
        Assert.Equal("Confirmed", (await Confirm(260m, "TRF-0002")).Item!.PrepaymentStatus);
        await using var audit = CreateContext(database.ConnectionString);
        Assert.Equal(1, await audit.AuditEntries.CountAsync(entry => entry.Action == "finance.charter.prepayment_reopened", ct));
        Assert.Equal(CharterCodes.PrepaymentConfirmed, (await audit.MobileCommandReceipts.AsNoTracking()
            .SingleAsync(item => item.IdempotencyKey == lateKey.ToString("D"), ct)).ErrorCode);
        Assert.True(await audit.AuditEntries.AnyAsync(entry => entry.Action == "finance.charter.prepayment_confirmed", ct));
        Assert.True(await audit.AuditEntries.AnyAsync(entry => entry.Action == "ramp.charter.service.added", ct));
    }

    private static async Task<Guid> FinanceAccountAsync(string connectionString, CancellationToken cancellationToken)
    {
        await using var context = CreateContext(connectionString);
        return await context.Users.Where(user => user.Email == "finanzas@dev.elevant.test").Select(user => user.PublicId)
            .SingleAsync(cancellationToken);
    }

    /// <summary>
    /// 3-N21: OCC registers the minimal carrier of a charter (OCC- organization, unverified profile) and plans its flight;
    /// a taken designator names its airline and the replay creates nothing. A commercial request of the same codes is
    /// approved on that same airline instead of answering <c>airline_code_in_use</c>; a carrier OCC registered that
    /// already has a contract is never taken over.
    /// </summary>
    [Fact]
    public async Task OccRegistersACharterCarrierThatACommercialApprovalCompletes()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        async Task<T> Run<T>(Func<IServiceProvider, Task<T>> action)
        {
            await using var scope = provider.CreateAsyncScope();
            return await action(scope.ServiceProvider);
        }
        var occ = SeededOccAccount;
        var station = SeededPujStation;
        Task<MasterDataResult<OccCharterAirlineData>> Register(CharterAirlineInput input, Guid? key, Guid? actor = null) =>
            Run(services => services.GetRequiredService<IOccTurnaroundStore>().CreateCharterAirlineAsync(actor ?? occ, input, key, ct));

        Assert.Equal("idempotency_key_required", (await Register(new("Sky High Charter", "SHC", "9Z"), null)).Code);
        Assert.Equal("invalid_charter_airline", (await Register(new("Sky High Charter", "S1C", null), Guid.NewGuid())).Code);
        Assert.Equal(MasterDataFailure.Forbidden, (await Register(new("Sky High Charter", "SHC", "9Z"), Guid.NewGuid(),
            FinanceAccount)).Failure);
        var key = Guid.NewGuid();
        var created = await Register(new("  Sky High   Charter ", "shc", "9z"), key);
        Assert.Null(created.Failure);
        Assert.Equal(("SHC", "9Z", "Sky High Charter", false), (created.Value!.IcaoCode, created.Value.IataCode,
            created.Value.Name, created.Replayed));
        var replayed = await Register(new("  Sky High   Charter ", "shc", "9z"), key);
        Assert.Equal((created.Value.Id, true), (replayed.Value!.Id, replayed.Replayed));
        var taken = await Register(new("Otra aerolínea", "SHC", null), Guid.NewGuid());
        Assert.Equal(("airline_code_in_use", (Guid?)created.Value.Id), (taken.Code, taken.ExistingId));
        await using (var check = CreateContext(database.ConnectionString))
        {
            var airline = await check.Airlines.AsNoTracking().SingleAsync(item => item.PublicId == created.Value.Id, ct);
            var organization = await check.Organizations.AsNoTracking().SingleAsync(item => item.Id == airline.OrganizationId, ct);
            Assert.StartsWith("OCC-", organization.Code, StringComparison.Ordinal);
            Assert.Equal((OrganizationType.AirlineCustomer, OrganizationStatus.Active), (organization.Type, organization.Status));
            var profile = await check.CommercialAirlineProfiles.AsNoTracking()
                .SingleAsync(item => item.CanonicalAirlineId == airline.Id, ct);
            Assert.Equal(((DateTimeOffset?)null, false), (profile.VerifiedAt, profile.IsPublished));
            Assert.Equal(1, await check.Airlines.CountAsync(item => item.IcaoCode == "SHC", ct));
            Assert.True(await check.AuditEntries.AnyAsync(entry => entry.EntityPublicId == airline.PublicId &&
                entry.Action == "occ.airline.created", ct));
        }

        // It is a charter carrier of «Nuevo vuelo» and its charter is planned with it.
        var (_, stands) = await PlanningFixtureAsync(database.ConnectionString, ct);
        var standId = stands["B03"];
        DateOnly date;
        await using (var setup = CreateContext(database.ConnectionString))
            date = await setup.Turnarounds.Where(item => item.OperationCode == "DEV-TAT-0002").Select(item => item.OperationDate)
                .SingleAsync(ct);
        var options = await Run(services => services.GetRequiredService<IManualTurnaroundOptionsStore>().GetAsync(occ, station, date, ct));
        Assert.Contains(options!.CharterAirlines!, item => item.Id == created.Value.Id);
        Assert.True((await Run(services => services.GetRequiredService<IManualTurnaroundStore>().CreateAsync(
            new ManualTurnaroundWriteRequest(occ, [station], Guid.CreateVersion7(), station, created.Value.Id, standId, date, "9Z100",
                "MIA", LocalAt(date, 21), "9Z101", "MIA", LocalAt(date, 22), Guid.NewGuid(), "occ-charter-airline", true), ct)))
            .IsSuccess);

        // Contratos approves a request of the same carrier: the airline OCC registered is completed, not duplicated.
        var catalog = await Run(services => services.GetRequiredService<ICommercialCatalogStore>().GetPublicAsync(ct));
        var service = catalog.Services[0].Id;
        var workflowStation = (await Run(services => services.GetRequiredService<ICommercialWorkflowStore>()
            .ListStationsAsync(ContractsAdministrator, ct)))!.Single();
        async Task<Guid> RequestAsync(string name, string icao, string? iata, string email)
        {
            var id = Guid.NewGuid();
            Assert.True((await Run(services => new SubmitCommercialRequestHandler(services.GetRequiredService<ICommercialIntakeStore>())
                .HandleAsync(CommercialApplication(id, Guid.Empty, service, email) with
                {
                    ProposedAirline = new CommercialAirlineProposal(name, "DO", iata, icao, "https://www.skyhigh.example.com/"),
                }, ct))).IsSuccess);
            return id;
        }
        async Task<CommercialInboxRequestData> ItemAsync(Guid id) => (await Run(services => services
                .GetRequiredService<ICommercialWorkflowStore>().ListInboxAsync(ContractsAdministrator,
                    new CommercialInboxQuery(CommercialInboxQuery.All, null, 1, 50), ct)))!
            .Requests.Single(item => item.Id == id);
        async Task<CommercialWorkflowResult> ReviewAsync(Guid id, string legalName, string icao, string? iata)
        {
            Assert.True((await Run(async services => await services.GetRequiredService<ICommercialWorkflowStore>()
                .ConfirmRepresentativeAsync(ContractsAdministrator, id, Guid.NewGuid(), new ConfirmCommercialRepresentativeInput(
                    (await ItemAsync(id)).Version, "Confirmado con la central de operaciones de la aerolínea."), ct))).IsSuccess);
            var verified = await Run(async services => await services.GetRequiredService<ICommercialWorkflowStore>()
                .VerifyRequestAirlineAsync(ContractsAdministrator, id, Guid.NewGuid(), new VerifyRequestAirlineInput(
                    (await ItemAsync(id)).Version, null, legalName, "DO", iata, icao, $"https://aoc.example.gob.do/{icao}"), ct));
            Assert.True(verified.IsSuccess, verified.Code);
            return await Run(async services => await services.GetRequiredService<ICommercialWorkflowStore>().DecideAsync(
                ContractsAdministrator, id, new ReviewCommercialInput(true, null, [workflowStation.Id], (await ItemAsync(id)).Version),
                Guid.NewGuid(), ct));
        }
        var request = await RequestAsync("Sky High Charter", "SHC", "9Z", "ops@skyhigh.example.com");
        var approved = await ReviewAsync(request, "Sky High Charter S.A.", "SHC", "9Z");
        Assert.True(approved.IsSuccess, approved.Code);
        await using (var check = CreateContext(database.ConnectionString))
        {
            var airline = await check.Airlines.AsNoTracking().SingleAsync(item => item.IcaoCode == "SHC", ct);
            Assert.Equal(created.Value.Id, airline.PublicId);
            Assert.Equal("Sky High Charter S.A.", (await check.Organizations.AsNoTracking()
                .SingleAsync(item => item.Id == airline.OrganizationId, ct)).LegalName);
            Assert.Equal(ContractStatus.Draft, (await check.Contracts.AsNoTracking().SingleAsync(item => item.AirlineId == airline.Id,
                ct)).Status);
            Assert.True(await check.AuditEntries.AnyAsync(entry => entry.EntityPublicId == airline.PublicId &&
                entry.Action == "commercial.airline.linked", ct));
        }

        // A carrier OCC registered that already flies under a contract belongs to that contract: the code stays in use.
        var withContract = await Register(new("Contracted Charter", "CQX", null), Guid.NewGuid());
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var airline = await setup.Airlines.SingleAsync(item => item.PublicId == withContract.Value!.Id, ct);
            setup.Contracts.Add(new Contract
            {
                PublicId = Guid.CreateVersion7(), AirlineId = airline.Id, ContractCode = "OCC-CQX-TEST", Status = ContractStatus.Terminated,
                CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
            });
            await setup.SaveChangesAsync(ct);
        }
        var refused = await ReviewAsync(await RequestAsync("Contracted Charter", "CQX", null, "ops@cqx.example.com"),
            "Contracted Charter S.A.", "CQX", null);
        Assert.Equal("airline_code_in_use", refused.Code);
    }
}
