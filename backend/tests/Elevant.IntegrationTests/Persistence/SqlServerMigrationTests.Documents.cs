using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Integration;
using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Operations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    /// <summary>
    /// ADR-0032: the forms are assembled from the operation record; a signature is accepted only
    /// against the exact content hash, a later billable change asks for it again, walk-around marks
    /// keep one photo each in private storage, and the airline sees only its fully signed order.
    /// </summary>
    [Fact]
    public async Task FormsAreSignedAgainstTheirContentHashAndReSignedAfterABillableChange()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var storage = await GarageCompatibleS3Server.StartAsync(ct);
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(ct);
        await database.ConfigureDevelopmentSeederPermissionsAsync(ct);
        await using (var connection = await database.OpenAsDevelopmentSeederAsync(ct))
        await using (var seeder = CreateContext(connection))
            await new Elevant.Infrastructure.Persistence.Seed.DevelopmentDataSeeder(seeder).SeedAsync(InitialPasswords, ct);
        var agent = Guid.Parse("40000000-0000-7000-8000-000000000002");
        var station = Guid.Parse("20000000-0000-7000-8000-000000000003");
        var operationId = Guid.Parse("70000000-0000-7000-8000-000000000005");
        var installation = Guid.Parse("81000000-0000-7000-8000-000000000072");
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(TimeProvider.System);
        services.AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString,
            ["MediaStorage:Endpoint"] = storage.Endpoint,
            ["MediaStorage:AccessKey"] = "synthetic-access",
            ["MediaStorage:SecretKey"] = "synthetic-secret",
            ["MediaStorage:Bucket"] = "synthetic-bucket",
            ["MediaStorage:Region"] = "garage",
        }).Build());
        services.AddScoped<IPasswordHasher<ApplicationUser>, PasswordHasher<ApplicationUser>>();
        await using var provider = services.BuildServiceProvider();
        async Task<T> Run<T>(Func<IServiceProvider, Task<T>> action)
        {
            await using var scope = provider.CreateAsyncScope();
            return await action(scope.ServiceProvider);
        }
        Task<T> Documents<T>(Func<IOperationDocumentStore, Task<T>> action) =>
            Run(provider => action(provider.GetRequiredService<IOperationDocumentStore>()));

        Assert.True((await Run(provider => provider.GetRequiredService<IMobileDeviceCommandStore>().RegisterAsync(
            new MobileDeviceRegistrationWriteRequest(agent, installation, MobilePlatform.Android, "1.2.3",
                "Documents SQL test tablet", "Android 16"), ct))).IsSuccess);
        var startKey = Guid.NewGuid();
        Assert.True((await Run(provider => provider.GetRequiredService<IRampOperationsCommandStore>().StartOperationAsync(
            new RampOperationStartWriteRequest(agent, [station], operationId, installation, startKey, startKey, "doc-start"),
            ct))).IsSuccess);

        var view = await Documents(store => store.ReadForAgentAsync(agent, [station], operationId, ct));
        Assert.NotNull(view);
        var order = Assert.Single(view.Documents, item => item.Content.Kind == OperationDocumentKind.ServiceOrder);
        Assert.Contains(view.Documents, item => item.Content.Kind == OperationDocumentKind.FlightReport);
        Assert.Matches("^PUJ[0-9]{9}$", order.Content.Number);
        Assert.Equal([OperationSignatureRole.AirlineRepresentative, OperationSignatureRole.AviamAgent], order.RequiredRoles);
        Assert.Empty(order.Signatures);
        // The same data always produces the same hash.
        Assert.Equal(order.ContentSha256, (await Documents(store => store.ReadForAgentAsync(agent, [station], operationId, ct)))!
            .Documents.Single(item => item.Content.Kind == OperationDocumentKind.ServiceOrder).ContentSha256);

        IReadOnlyList<IReadOnlyList<decimal>> strokes = [[0.1m, 0.5m, 0.4m, 0.2m, 0.7m, 0.6m], [0.2m, 0.8m, 0.9m, 0.8m]];
        Task<OperationDocumentWriteResult> Sign(Guid key, OperationSignatureRole role, string sha, string name) =>
            Documents(store => store.SignAsync(new OperationDocumentSignRequest(agent, [station], operationId,
                OperationDocumentKind.ServiceOrder, role, name, sha, strokes, DateTimeOffset.UtcNow, installation, key,
                "doc-test"), ct));

        // A signature against content the signer did not see is refused.
        Assert.Equal(RampExecutionWriteFailure.Conflict,
            (await Sign(Guid.NewGuid(), OperationSignatureRole.AirlineRepresentative, new string('a', 64), "Ana Pérez")).Failure);
        var representativeKey = Guid.NewGuid();
        var representative = await Sign(representativeKey, OperationSignatureRole.AirlineRepresentative, order.ContentSha256,
            "Ana Pérez");
        Assert.True(representative.IsSuccess);
        var signedOrder = representative.Data!.Documents.Single(item => item.Content.Kind == OperationDocumentKind.ServiceOrder);
        Assert.Equal("Ana Pérez", Assert.Single(signedOrder.Signatures).SignerName);
        Assert.False(signedOrder.IsFullySigned);
        Assert.Equal(representative.CommitReceiptId, (await Sign(representativeKey,
            OperationSignatureRole.AirlineRepresentative, order.ContentSha256, "Ana Pérez")).CommitReceiptId);
        // A role signs a given content once.
        Assert.Equal(RampExecutionWriteFailure.Conflict, (await Sign(Guid.NewGuid(),
            OperationSignatureRole.AirlineRepresentative, order.ContentSha256, "Otra Persona")).Failure);
        var aviam = await Sign(Guid.NewGuid(), OperationSignatureRole.AviamAgent, order.ContentSha256, "Riley Ramp");
        Assert.True(aviam.Data!.Documents.Single(item => item.Content.Kind == OperationDocumentKind.ServiceOrder).IsFullySigned);

        await using var check = CreateContext(database.ConnectionString);
        var organization = await (from operation in check.GroundOperations
                                  join turnaround in check.Turnarounds on operation.TurnaroundId equals turnaround.Id
                                  join airline in check.Airlines on turnaround.AirlineId equals airline.Id
                                  join item in check.Organizations on airline.OrganizationId equals item.Id
                                  where operation.PublicId == operationId
                                  select item.PublicId).SingleAsync(ct);
        var portal = await Documents(store => store.ReadSignedServiceOrderForAirlineAsync(organization, operationId, ct));
        Assert.Equal(order.ContentSha256, portal!.ContentSha256);
        Assert.Equal(2, portal.Signatures.Count);
        Assert.Null(await Documents(store => store.ReadSignedServiceOrderForAirlineAsync(Guid.NewGuid(), operationId, ct)));

        // A billable change (passengers) yields a new content: both roles must sign again, only this form.
        Assert.True((await Run(provider => provider.GetRequiredService<IRampExecutionCommandStore>().UpdateFlightDataAsync(
            new RampFlightDataWriteRequest(agent, [station], operationId, 151, 147, 77_500, null, installation, Guid.NewGuid(),
                "doc-test"), ct))).IsSuccess);
        var changed = (await Documents(store => store.ReadForAgentAsync(agent, [station], operationId, ct)))!
            .Documents.Single(item => item.Content.Kind == OperationDocumentKind.ServiceOrder);
        Assert.NotEqual(order.ContentSha256, changed.ContentSha256);
        Assert.Empty(changed.Signatures);
        Assert.Equal([OperationSignatureRole.AirlineRepresentative, OperationSignatureRole.AviamAgent], changed.StaleRoles);
        // The airline keeps seeing the order it signed until the new one is signed.
        Assert.Equal(order.ContentSha256,
            (await Documents(store => store.ReadSignedServiceOrderForAirlineAsync(organization, operationId, ct)))!.ContentSha256);

        // Walk-around: a mark with its id from the tablet, then one photo.
        var markId = Guid.NewGuid();
        var mark = await Documents(store => store.RecordDamageMarkAsync(new DamageMarkWriteRequest(agent, [station],
            operationId, markId, 0.45m, 0.3m, "Abolladura en el borde de ataque", DateTimeOffset.UtcNow, installation,
            Guid.NewGuid(), "doc-test"), ct));
        Assert.True(mark.IsSuccess);
        Assert.False(Assert.Single(mark.Data!.DamageMarks).HasPhoto);
        Assert.Equal(RampExecutionWriteFailure.Conflict, (await Documents(store => store.RecordDamageMarkAsync(
            new DamageMarkWriteRequest(agent, [station], operationId, markId, 0.5m, 0.5m, "Otra marca con el mismo id",
                DateTimeOffset.UtcNow, installation, Guid.NewGuid(), "doc-test"), ct))).Failure);
        byte[] photo = [0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4];
        Task<OperationDocumentWriteResult> Attach(byte[] content) => Documents(store => store.AttachDamagePhotoAsync(
            new DamagePhotoWriteRequest(agent, [station], operationId, markId, content, "image/jpeg", installation, "doc-test"),
            ct));
        Assert.True(Assert.Single((await Attach(photo)).Data!.DamageMarks).HasPhoto);
        Assert.True((await Attach(photo)).IsSuccess);
        Assert.Equal(RampExecutionWriteFailure.Conflict, (await Attach([0xFF, 0xD8, 0xFF, 9, 9])).Failure);
        Assert.Equal(photo, (await Documents(store => store.ReadDamagePhotoForOccAsync([station], operationId, markId, ct)))!
            .Content);
        Assert.Null(await Documents(store => store.ReadForOccAsync([Guid.NewGuid()], operationId, ct)));

        // OCC renders the Flight Report with the mark on the silhouette and the photo appended.
        var occ = (await Documents(store => store.ReadForOccAsync([station], operationId, ct)))!;
        var report = occ.Documents.Single(item => item.Content.Kind == OperationDocumentKind.FlightReport);
        Assert.Single(report.Content.Damages);
        var pdf = new OperationDocumentPdfRenderer().Render(report.Content, report.ContentSha256, report.Signatures,
            new Dictionary<Guid, DamagePhoto>());
        Assert.Equal("%PDF"u8.ToArray(), pdf[..4]);
        Assert.True(await check.AuditEntries.AnyAsync(entry => entry.Action == "ramp.operation.document.signed", ct));
    }
}
