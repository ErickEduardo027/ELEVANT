using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Commercial;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
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
                    RepresentativeMunicipality: "Miches", RepresentativeDistrict: "La Gina", RepresentativeDocumentType: "NationalId", RepresentativeDocumentNumber: "00112345673"), ct);
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
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var hidden = new ManagedServiceInput("RAMP-CATERING", "Catering de aeronaves",
            "Comidas y bebidas a bordo para tripulación y pasajeros", "operación", null, null, 900, false, true, null);

        // Finance prices services but no longer edits the catalog; it can still read it.
        Assert.Equal(CatalogMutationFailure.Forbidden, (await catalog.SaveAsync(FinanceAccount, null, hidden, null, ct)).Failure);
        Assert.NotNull(await catalog.ListAsync(FinanceAccount, ct));

        var unknownUnit = await catalog.SaveAsync(ContractsAccount, null, hidden with { BillingUnit = "galón" }, null, ct);
        Assert.Equal(("billing_unit_unknown", CatalogMutationFailure.Invalid), (unknownUnit.Code, unknownUnit.Failure!.Value));
        var withoutPhoto = await catalog.SaveAsync(ContractsAccount, null, hidden with { IsPublic = true }, null, ct);
        Assert.Equal("image_required", withoutPhoto.Code);
        var placeholder = await catalog.SaveAsync(ContractsAccount, null, hidden with
        {
            Code = "RAMP-PRUEBA", Name = "Servicio de prueba", IsPublic = true,
            ImageUrl = "/assets/services/cargo-loading.webp",
        }, null, ct);
        Assert.Equal("placeholder_name", placeholder.Code);
        var shortText = await catalog.SaveAsync(ContractsAccount, null, hidden with
        {
            Description = "Comidas", IsPublic = true, ImageUrl = "/assets/services/cargo-loading.webp",
        }, null, ct);
        Assert.Equal("description_too_short", shortText.Code);

        // Hidden it can be saved with a unit Finance maintains (any casing), then published with a photo.
        var saved = await catalog.SaveAsync(ContractsAccount, null, hidden with { BillingUnit = "Operación" }, null, ct);
        Assert.Null(saved.Failure);
        // 1-E: the catalog stores the unit code the name stands for, as Finance tariffs and packages do.
        Assert.Equal("operation", saved.Service!.BillingUnit);
        Assert.Equal("operation", await context.ServiceDefinitions.AsNoTracking()
            .Where(item => item.PublicId == saved.Service.Id).Select(item => item.DefaultBillingUnit).SingleAsync(ct));
        var published = await catalog.SaveAsync(ContractsAccount, saved.Service!.Id, hidden with
        {
            BillingUnit = "Operación", IsPublic = true, ImageUrl = "/assets/services/cargo-loading.webp",
            Version = saved.Service.Version,
        }, null, ct);
        Assert.Null(published.Failure);
        Assert.True(published.Service!.IsPublic);
        Assert.Equal(CatalogMutationFailure.Forbidden,
            (await catalog.DeleteAsync(FinanceAccount, saved.Service.Id, published.Service.Version, null, ct)).Failure);
        Assert.Null((await catalog.DeleteAsync(ContractsAccount, saved.Service.Id, published.Service.Version, null, ct)).Failure);
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
                RepresentativeMunicipality: "Miches", RepresentativeDocumentType: "NationalId", RepresentativeDocumentNumber: "00112345673"), ct);
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

public sealed partial class SqlServerMigrationTests
{
    [Fact]
    public async Task OccReportsAreBuiltOnTheServerForTheStationAndExportsAreAudited()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var reports = scope.ServiceProvider.GetRequiredService<IOccReportStore>();
        var occ = Guid.Parse("40000000-0000-7000-8000-000000000001");
        await using var context = CreateContext(database.ConnectionString);
        var station = await context.Stations.SingleAsync(item => item.Code == "PUJ", ct);
        DateOnly from = new(2026, 8, 1), to = new(2026, 8, 31);

        var operations = await reports.ReadAsync(occ, OccReportKind.Operations, station.PublicId, from, to, 1, 100, ct);
        Assert.Null(operations.Failure);
        var table = operations.Table!;
        Assert.Equal("PUJ", table.StationCode);
        Assert.NotEmpty(table.Rows);
        Assert.All(table.Rows, row => Assert.Equal(table.Definition.Columns.Count, row.Count));
        Assert.Equal(await context.GroundOperations.CountAsync(operation => context.Turnarounds.Any(turnaround =>
            turnaround.Id == operation.TurnaroundId && turnaround.StationId == station.Id &&
            turnaround.OperationDate >= from && turnaround.OperationDate <= to), ct), table.RowCount);
        var firstPage = await reports.ReadAsync(occ, OccReportKind.Operations, station.PublicId, from, to, 1, 1, ct);
        Assert.Equal(table.RowCount > 1, firstPage.Table!.HasMore);
        foreach (var kind in Enum.GetValues<OccReportKind>())
            Assert.Null((await reports.ReadAsync(occ, kind, station.PublicId, from, to, 1, 100, ct)).Failure);

        // Finance has no OCC «Reportes» option.
        Assert.Equal(OccReportFailure.Forbidden,
            (await reports.ReadAsync(FinanceAccount, OccReportKind.Operations, station.PublicId, from, to, 1, 10, ct)).Failure);
        Assert.Null(await reports.RecordExportAsync(occ, OccReportKind.Operations, station.PublicId, from, to, "xlsx",
            table.RowCount, ct));
        Assert.True(await context.AuditEntries.AnyAsync(entry => entry.Action == "operations.report.exported", ct));
        Assert.Equal(OccReportFailure.Forbidden, await reports.RecordExportAsync(FinanceAccount, OccReportKind.Operations,
            station.PublicId, from, to, "pdf", 0, ct));
    }
}

public sealed partial class SqlServerMigrationTests
{
    private const string ContractSignaturesMigration = "20261027000905_AddContractSignatures";

    [Fact]
    public async Task ApprovedContractsPrintAndAreSignedOncePerPartyOverTheExactContent()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var documents = scope.ServiceProvider.GetRequiredService<IContractDocumentStore>();
        var airlineAccount = Guid.Parse("40000000-0000-7000-8000-000000000003");
        await using var context = CreateContext(database.ConnectionString);
        var versionId = await context.ContractVersions.Where(version => version.Status == ContractVersionStatus.Approved)
            .Select(version => version.PublicId).FirstAsync(ct);

        var read = await documents.ReadAsync(ContractsAccount, versionId, ct);
        Assert.Null(read.Failure);
        // ADR-0025: until Contratos confirms validity nobody can sign.
        Assert.Null(read.Document!.SignableBy);
        Assert.Null(read.Document.Validity);
        // A contract still carrying its draft code gets the final CTR- code when validity is confirmed.
        var contractKey = await context.ContractVersions.Where(version => version.PublicId == versionId)
            .Select(version => version.ContractId).SingleAsync(ct);
        await context.Contracts.Where(contract => contract.Id == contractKey)
            .ExecuteUpdateAsync(update => update.SetProperty(contract => contract.ContractCode, "DRAFT-" + Guid.NewGuid().ToString("N")), ct);
        await ConfirmValidityAsync(documents, versionId, DateOnly.FromDateTime(DateTime.UtcNow), ct);
        var document = (await documents.ReadAsync(ContractsAccount, versionId, ct)).Document!;
        Assert.NotNull(document.Validity);
        Assert.Matches(@"^CTR-\d{4}-\d{4,}$", document.ContractCode);
        // The airline signs first; AVIAM waits for it.
        Assert.Null(document.SignableBy);
        Assert.Equal(64, document.ContentSha256.Length);
        Assert.Empty(document.Signatures);
        Assert.Equal("%PDF", System.Text.Encoding.ASCII.GetString(
            new Elevant.Infrastructure.Commercial.ContractPdfRenderer().Render(document)[..4]));

        // Finance reads contracts to approve prices but does not sign for AVIAM.
        var finance = await documents.ReadAsync(FinanceAccount, versionId, ct);
        Assert.Null(finance.Document!.SignableBy);
        Assert.Equal(ContractDocumentFailure.Forbidden, (await documents.SignAsync(FinanceAccount, versionId,
            new SignContractInput(Guid.NewGuid(), "Marta Gómez", "Analista", document.ContentSha256, true, SignaturePng), ct)).Failure);
        Assert.Equal(ContractDocumentFailure.Conflict, (await documents.SignAsync(ContractsAccount, versionId,
            new SignContractInput(Guid.NewGuid(), "Ana Pérez", "Gerente comercial", new string('0', 64), true, SignaturePng), ct)).Failure);
        Assert.Equal(ContractDocumentFailure.Invalid, (await documents.SignAsync(ContractsAccount, versionId,
            new SignContractInput(Guid.NewGuid(), "Ana Pérez", "Gerente comercial", document.ContentSha256, false, SignaturePng), ct)).Failure);
        Assert.Equal("signature_image_invalid", (await documents.SignAsync(airlineAccount, versionId,
            new SignContractInput(Guid.NewGuid(), "Luis Marte", "Director", document.ContentSha256, true), ct)).Code);
        Assert.Equal(ContractDocumentFailure.AirlineSignaturePending, (await documents.SignAsync(ContractsAccount, versionId,
            new SignContractInput(Guid.NewGuid(), "Ana Pérez", "Gerente comercial", document.ContentSha256, true, SignaturePng), ct)).Failure);

        var portal = await documents.ReadAsync(airlineAccount, versionId, ct);
        Assert.Equal("Airline", portal.Document!.SignableBy);
        var airlineRequest = new SignContractInput(Guid.NewGuid(), "Luis Marte", "Director de estación",
            document.ContentSha256, true, SignaturePng);
        Assert.Null((await documents.SignAsync(airlineAccount, versionId, airlineRequest, ct)).Failure);
        Assert.True((await documents.SignAsync(airlineAccount, versionId, airlineRequest, ct)).Replayed);
        Assert.Equal(ContractDocumentFailure.AlreadySigned, (await documents.SignAsync(airlineAccount, versionId,
            airlineRequest with { RequestId = Guid.NewGuid() }, ct)).Failure);
        Assert.Contains(await notificationsFor(ContractsAccount), item => item.Kind == "contract_signed");

        Assert.Equal("Aviam", (await documents.ReadAsync(ContractsAccount, versionId, ct)).Document!.SignableBy);
        var aviam = await documents.SignAsync(ContractsAccount, versionId,
            new SignContractInput(Guid.NewGuid(), "Ana Pérez", "Gerente comercial", document.ContentSha256, true, SignaturePng), ct);
        Assert.Null(aviam.Failure);
        Assert.Equal(["Airline", "Aviam"], aviam.Document!.Signatures.Select(item => item.Party));
        Assert.All(aviam.Document.Signatures, item => Assert.Equal(document.ContentSha256, item.DocumentSha256));
        Assert.All(aviam.Document.Signatures, item => Assert.NotNull(item.Image));
        Assert.NotNull(aviam.Document.SignedOn);

        // The activation email (ADR-0025) has its own rollback guard on the outbox; empty it so
        // this check reaches the signatures guard it is about.
        await context.EmailOutbox.ExecuteDeleteAsync(ct);
        var chain = context.Database.GetMigrations().ToArray();
        var previous = chain[Array.IndexOf(chain, ContractSignaturesMigration) - 1];
        var failure = await Assert.ThrowsAsync<SqlException>(() => context.GetService<IMigrator>().MigrateAsync(previous, ct));
        Assert.Equal(52320, failure.Number);

        async Task<IReadOnlyList<DepartmentNotificationData>> notificationsFor(Guid account) =>
            (await scope.ServiceProvider.GetRequiredService<IDepartmentNotificationStore>().ListAsync(account, ct)).Value!.Notifications;
    }
}

public sealed partial class SqlServerMigrationTests
{
    [Fact]
    public async Task OccRecordsArrivalsAndAssignsReassignsAndReleasesStandsWithoutOverlaps()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var positions = scope.ServiceProvider.GetRequiredService<IOccPositionStore>();
        var occ = Guid.Parse("40000000-0000-7000-8000-000000000001");
        await using var context = CreateContext(database.ConnectionString);
        var station = await context.Stations.SingleAsync(item => item.Code == "PUJ", ct);
        var assigned = await (from assignment in context.Set<StandAssignment>()
                              join turnaround in context.Turnarounds on assignment.TurnaroundId equals turnaround.Id
                              where assignment.AssignedTo == null && turnaround.StationId == station.Id &&
                                    turnaround.CurrentStatus != TurnaroundStatus.Cancelled &&
                                    turnaround.CurrentStatus != TurnaroundStatus.Completed &&
                                    context.FlightLegs.Any(leg => leg.TurnaroundId == turnaround.Id && leg.Direction == FlightDirection.Arrival)
                              orderby turnaround.OperationDate, turnaround.Id
                              select new { turnaround.Id, turnaround.PublicId, turnaround.OperationDate, assignment.StandId })
            .FirstAsync(ct);

        var board = await positions.ReadAsync(occ, station.PublicId, assigned.OperationDate, ct);
        Assert.Null(board.Failure);
        Assert.True(board.Board!.CanAssign);
        var stand = Assert.Single(board.Board.Positions, item => item.Turnarounds.Any(turnaround => turnaround.TurnaroundId == assigned.PublicId));
        Assert.Equal("planned", stand.Status);
        Assert.Equal(OccPositionFailure.Forbidden, (await positions.ReadAsync(FinanceAccount, station.PublicId, assigned.OperationDate, ct)).Failure);
        Assert.Equal(OccPositionFailure.Forbidden, (await positions.ReleaseAsync(FinanceAccount, assigned.PublicId, ct)).Failure);

        // The aircraft arrives: the stand shows it occupied with its registration.
        Assert.Equal(OccPositionFailure.Invalid, (await positions.RecordArrivalAsync(occ, assigned.PublicId,
            new RecordArrivalInput("hi 1055!", null), ct)).Failure);
        Assert.Equal(OccPositionFailure.Invalid, (await positions.RecordArrivalAsync(occ, assigned.PublicId,
            new RecordArrivalInput("HI1055", DateTimeOffset.UtcNow.AddHours(2)), ct)).Failure);
        var arrived = await positions.RecordArrivalAsync(occ, assigned.PublicId, new RecordArrivalInput("hi1055", null), ct);
        var occupied = Assert.Single(arrived.Board!.Positions, item => item.StandId == stand.StandId);
        Assert.Equal("occupied", occupied.Status);
        Assert.Equal("HI1055", occupied.Turnarounds.Single(item => item.TurnaroundId == assigned.PublicId).AircraftRegistration);
        Assert.Equal(TurnaroundStatus.InProgress, (await context.Turnarounds.AsNoTracking().SingleAsync(item => item.Id == assigned.Id, ct)).CurrentStatus);

        // Reassigning to a free stand moves the aircraft; the previous assignment is kept closed.
        var free = board.Board.Positions.First(item => item.Status == "available" && item.StandId != stand.StandId);
        var moved = await positions.AssignAsync(occ, assigned.PublicId, free.StandId, "Cambio por mantenimiento", ct);
        Assert.Null(moved.Failure);
        Assert.Equal("occupied", moved.Board!.Positions.Single(item => item.StandId == free.StandId).Status);
        Assert.Equal("available", moved.Board.Positions.Single(item => item.StandId == stand.StandId).Status);
        Assert.Equal(2, await context.Set<StandAssignment>().CountAsync(item => item.TurnaroundId == assigned.Id, ct));

        // Another turnaround whose window overlaps cannot take the occupied stand.
        var other = await context.Turnarounds.Where(item => item.StationId == station.Id && item.Id != assigned.Id &&
            item.CurrentStatus != TurnaroundStatus.Cancelled && item.CurrentStatus != TurnaroundStatus.Completed)
            .Select(item => item.PublicId).FirstOrDefaultAsync(ct);
        if (other != Guid.Empty)
        {
            var window = await context.GroundOperations.AsNoTracking().Where(item => item.TurnaroundId == assigned.Id)
                .Select(item => new { item.PlannedStartAt, item.PlannedEndAt }).FirstAsync(ct);
            await context.GroundOperations.Where(item => context.Turnarounds.Any(turnaround => turnaround.PublicId == other &&
                    turnaround.Id == item.TurnaroundId))
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.PlannedStartAt, window.PlannedStartAt)
                    .SetProperty(item => item.PlannedEndAt, window.PlannedEndAt), ct);
            Assert.Equal(OccPositionFailure.Conflict, (await positions.AssignAsync(occ, other, free.StandId, null, ct)).Failure);
        }

        var released = await positions.ReleaseAsync(occ, assigned.PublicId, ct);
        Assert.Equal("available", released.Board!.Positions.Single(item => item.StandId == free.StandId).Status);
        Assert.False(await context.Set<StandAssignment>().AnyAsync(item => item.TurnaroundId == assigned.Id && item.AssignedTo == null, ct));
        Assert.True(await context.AuditEntries.CountAsync(entry => entry.EntityPublicId == assigned.PublicId &&
            entry.Action.StartsWith("occ."), ct) >= 3);
    }
}

public sealed partial class SqlServerMigrationTests
{
    private sealed class MovableTimeProvider(DateTimeOffset start) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = start;

        public override DateTimeOffset GetUtcNow() => Now;
    }

    [Fact]
    public async Task RefreshTokensRotateRevokeOnReuseStampChangeIdlenessAndLogout()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var context = CreateContext(database.ConnectionString);
        var clock = new MovableTimeProvider(DateTimeOffset.UtcNow);
        var store = new Elevant.Persistence.Identity.EfRefreshTokenStore(context, clock);
        var occ = Guid.Parse("40000000-0000-7000-8000-000000000001");

        // A login starts a family; each use replaces the token.
        var first = (await store.IssueAsync(occ, ct))!;
        var second = await store.RotateAsync(first.Value, ct);
        Assert.True(second.IsSuccess);
        Assert.Equal(occ, second.AccountId);
        Assert.NotEqual(first.Value, second.Token!.Value);
        Assert.DoesNotContain(await context.Set<RefreshToken>().AsNoTracking().Select(token => token.TokenHash).ToArrayAsync(ct),
            hash => hash == first.Value || hash == second.Token.Value);

        // Two tabs renewing at once: the slower one is told to re-read, nothing is revoked.
        Assert.Equal(RefreshTokenFailure.AlreadyRotated, (await store.RotateAsync(first.Value, ct)).Failure);
        var third = await store.RotateAsync(second.Token.Value, ct);
        Assert.True(third.IsSuccess);

        // The same replaced token much later means it leaked: the whole family ends.
        clock.Now += TimeSpan.FromMinutes(5);
        Assert.Equal(RefreshTokenFailure.Invalid, (await store.RotateAsync(first.Value, ct)).Failure);
        Assert.Equal(RefreshTokenFailure.Invalid, (await store.RotateAsync(third.Token!.Value, ct)).Failure);

        // A password change (new security stamp) ends the session.
        var afterStamp = (await store.IssueAsync(occ, ct))!;
        await context.Users.Where(user => user.PublicId == occ)
            .ExecuteUpdateAsync(update => update.SetProperty(user => user.SecurityStamp, Guid.NewGuid().ToString("N")), ct);
        Assert.Equal(RefreshTokenFailure.Invalid, (await store.RotateAsync(afterStamp.Value, ct)).Failure);

        // 30 days without use, or a logout, also end it.
        var idle = (await store.IssueAsync(occ, ct))!;
        clock.Now += Elevant.Persistence.Identity.EfRefreshTokenStore.IdleLifetime + TimeSpan.FromMinutes(1);
        Assert.Equal(RefreshTokenFailure.Invalid, (await store.RotateAsync(idle.Value, ct)).Failure);
        var loggedOut = (await store.IssueAsync(occ, ct))!;
        await store.RevokeFamilyAsync(loggedOut.Value, ct);
        Assert.Equal(RefreshTokenFailure.Invalid, (await store.RotateAsync(loggedOut.Value, ct)).Failure);
        Assert.Equal(RefreshTokenFailure.Invalid, (await store.RotateAsync("unknown-token", ct)).Failure);
    }
}
