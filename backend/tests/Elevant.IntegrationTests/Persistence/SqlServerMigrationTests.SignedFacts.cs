using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Operations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>
/// CN-27: renaming master data (the station, the airline, a service) after the Service Order was signed keeps the
/// signatures on the tablet and in OCC, which keep showing the content as signed; an operational change (push-back)
/// still asks for the order to be signed again, and OCC approves the signed order after a rename.
/// </summary>
public sealed partial class SqlServerMigrationTests
{
    [Fact]
    public async Task RenamingMasterDataKeepsTheSignedServiceOrderValid()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await TimingProviderAsync(database, ct);
        async Task<T> Run<T>(Func<IServiceProvider, Task<T>> action)
        {
            await using var scope = provider.CreateAsyncScope();
            return await action(scope.ServiceProvider);
        }
        var installation = await RegisterTimingTabletAsync(provider, "81000000-0000-7000-8000-0000000000e7", ct);
        var blockOn = new DateTimeOffset(2026, 8, 18, 15, 10, 0, TimeSpan.FromHours(-4)).ToUniversalTime();
        ReviewOperationState state;
        await using (var setup = CreateContext(database.ConnectionString))
            state = await PrepareReviewOperationAsync(setup, blockOn, 2m, ct);
        Task<OperationDocumentData> TabletOrderAsync() => Run(async services =>
            (await services.GetRequiredService<IOperationDocumentStore>()
                .ReadForAgentAsync(TimingAgent, [TimingStation], TimingOperation, ct))!
            .Documents.Single(item => item.Content.Kind == OperationDocumentKind.ServiceOrder));

        // 1. The airline's representative signs; then the station, the airline and a service are renamed.
        var unsigned = await TabletOrderAsync();
        var representative = await Run(services => services.GetRequiredService<IOperationDocumentStore>().SignAsync(
            new OperationDocumentSignRequest(TimingAgent, [TimingStation], TimingOperation, OperationDocumentKind.ServiceOrder,
                OperationSignatureRole.AirlineRepresentative, "Ana Pérez", unsigned.ContentSha256,
                [[0.1m, 0.5m, 0.4m, 0.2m]], DateTimeOffset.UtcNow, installation, Guid.NewGuid(), "cn27-sign"), ct));
        Assert.True(representative.IsSuccess, representative.Failure?.ToString());
        string stationName, airlineName, serviceName;
        async Task RenameAsync(string station, string airline, string service)
        {
            await using var rename = CreateContext(database.ConnectionString);
            var operation = await rename.GroundOperations.SingleAsync(item => item.Id == state.OperationId, ct);
            var turnaround = await rename.Turnarounds.SingleAsync(item => item.Id == operation.TurnaroundId, ct);
            (await rename.Stations.SingleAsync(item => item.Id == turnaround.StationId, ct)).Name = station;
            (await rename.Airlines.SingleAsync(item => item.Id == turnaround.AirlineId, ct)).Name = airline;
            var definition = await (from line in rename.OperationServices
                                    join item in rename.ServiceDefinitions on line.ServiceDefinitionId equals item.Id
                                    where line.Id == state.ServiceIds[0]
                                    select item).SingleAsync(ct);
            definition.Name = service;
            await rename.SaveChangesAsync(ct);
        }
        stationName = unsigned.Content.Flight.StationName;
        airlineName = unsigned.Content.Flight.AirlineName;
        serviceName = unsigned.Content.Services[0].Name;
        await RenameAsync("AVIAM Punta Cana", "Aerolínea Renombrada", "Servicio renombrado");

        // 2. The tablet still shows the signed content (old labels, same hash) and the AVIAM agent signs it.
        var renamed = await TabletOrderAsync();
        Assert.Equal(unsigned.ContentSha256, renamed.ContentSha256);
        Assert.Equal(stationName, renamed.Content.Flight.StationName);
        Assert.Equal(OperationSignatureRole.AirlineRepresentative, Assert.Single(renamed.Signatures).Role);
        Assert.Empty(renamed.StaleRoles);
        await SignServiceOrderAsync(provider, TimingAgent, TimingStation, TimingOperation, installation, ct);
        var signed = await TabletOrderAsync();
        Assert.True(signed.IsFullySigned);
        Assert.Empty(signed.StaleRoles);
        Assert.Equal(airlineName, signed.Content.Flight.AirlineName);
        Assert.Equal(serviceName, signed.Content.Services[0].Name);
        Assert.All(signed.Signatures, signature => Assert.Equal(unsigned.ContentSha256, signature.DocumentSha256));
        await using (var check = CreateContext(database.ConnectionString))
            Assert.Equal(1, await check.Set<OperationDocumentVersion>().CountAsync(item =>
                item.GroundOperationId == state.OperationId && item.Kind == OperationDocumentKind.ServiceOrder, ct));

        // 3. Handed off: OCC sees it fully signed, also after a second rename.
        var handOffKey = Guid.NewGuid();
        var handedOff = await Run(services => services.GetRequiredService<IRampOperationSubmissionStore>().SubmitAsync(
            new RampOperationSubmissionWriteRequest(TimingAgent, [TimingStation], TimingOperation, installation, handOffKey,
                null, Guid.NewGuid(), "cn27-handoff"), ct));
        Assert.True(handedOff.IsSuccess, handedOff.Failure?.ToString());
        await RenameAsync("AVIAM PUJ Otra Vez", "Aerolínea Otra Vez", "Servicio otra vez");
        Task<OccReviewDetailData> DetailAsync() => Run(async services =>
            (await services.GetRequiredService<IOccReviewStore>().GetDetailAsync(TimingOperation, [TimingStation], ct))!);
        var detail = await DetailAsync();
        Assert.Equal(ServiceOrderStates.FullySigned, detail.ServiceOrderState);
        var occ = (await Run(services => services.GetRequiredService<IOperationDocumentStore>()
                .ReadForOccAsync([TimingStation], TimingOperation, ct)))!
            .Documents.Single(item => item.Content.Kind == OperationDocumentKind.ServiceOrder);
        Assert.True(occ.IsFullySigned);
        Assert.Empty(occ.StaleRoles);
        Assert.Equal(stationName, occ.Content.Flight.StationName);
        var pdf = new OperationDocumentPdfRenderer().Render(occ.Content, occ.ContentSha256, occ.Signatures,
            new Dictionary<Guid, DamagePhoto>());
        Assert.Equal("%PDF"u8.ToArray(), pdf[..4]);

        // 4. An operational fact changes (push-back five minutes later): the order is stale and cannot be approved.
        async Task MovePushbackAsync(int minutes)
        {
            await using var move = CreateContext(database.ConnectionString);
            var pushback = await move.Set<OperationMilestone>().SingleAsync(item =>
                item.GroundOperationId == state.OperationId && item.Code == "PUSHBACK", ct);
            pushback.ActualAt = pushback.ActualAt!.Value.AddMinutes(minutes);
            await move.SaveChangesAsync(ct);
        }
        await MovePushbackAsync(5);
        detail = await DetailAsync();
        Assert.Equal(ServiceOrderStates.Stale, detail.ServiceOrderState);
        var stale = (await Run(services => services.GetRequiredService<IOperationDocumentStore>()
                .ReadForOccAsync([TimingStation], TimingOperation, ct)))!
            .Documents.Single(item => item.Content.Kind == OperationDocumentKind.ServiceOrder);
        Assert.Empty(stale.Signatures);
        Assert.Equal([OperationSignatureRole.AirlineRepresentative, OperationSignatureRole.AviamAgent], stale.StaleRoles);
        Assert.Equal("AVIAM PUJ Otra Vez", stale.Content.Flight.StationName);
        Task<OccReviewDecisionWriteResult> Approve(string token) =>
            Run(services => services.GetRequiredService<IOccReviewStore>().DecideAsync(new OccReviewDecisionWriteRequest(
                TimingOcc, [TimingStation], TimingOperation, handOffKey, token, "Approved", null, Guid.NewGuid(),
                "cn27-decide", Guid.NewGuid()), ct));
        var refused = await Approve(detail.ConcurrencyToken);
        Assert.Equal((OccReviewFailure.Conflict, "service_order_stale"), (refused.Failure, refused.Code));

        // 5. Back to the signed push-back: signed again, and OCC approves it after the renames.
        await MovePushbackAsync(-5);
        detail = await DetailAsync();
        Assert.Equal(ServiceOrderStates.FullySigned, detail.ServiceOrderState);
        var approved = await Approve(detail.ConcurrencyToken);
        Assert.True(approved.IsSuccess, approved.Code);
    }
}
