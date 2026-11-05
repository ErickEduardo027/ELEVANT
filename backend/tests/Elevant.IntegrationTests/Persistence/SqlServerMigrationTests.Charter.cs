using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Integration;
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
        await using var audit = CreateContext(database.ConnectionString);
        Assert.True(await audit.AuditEntries.AnyAsync(entry => entry.Action == "finance.charter.prepayment_confirmed", ct));
        Assert.True(await audit.AuditEntries.AnyAsync(entry => entry.Action == "ramp.charter.service.added", ct));
    }

    private static async Task<Guid> FinanceAccountAsync(string connectionString, CancellationToken cancellationToken)
    {
        await using var context = CreateContext(connectionString);
        return await context.Users.Where(user => user.Email == "finanzas@dev.elevant.test").Select(user => user.PublicId)
            .SingleAsync(cancellationToken);
    }
}
