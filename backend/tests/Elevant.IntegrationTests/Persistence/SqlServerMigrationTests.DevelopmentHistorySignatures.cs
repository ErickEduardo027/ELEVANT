using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence.Seed.History;
using Elevant.Persistence.Operations;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>
/// The signed Service Order of the history operations (chunks <c>ops-signatures:&lt;month&gt;</c>): added to a database
/// that already holds the rest of the history (the shared VPS), signed on the current content by the airline and the
/// agent who handed it off, so OCC reads it signed and approves a pending delivery.
/// </summary>
public sealed partial class SqlServerMigrationTests
{
    [Fact]
    public void DevelopmentHistoryServiceOrderSignaturesAreValidDrawingsSignedBetweenPushbackAndHandOff()
    {
        var representatives = ServiceOrderSignatureHistory.RepresentativesOf("CM");
        Assert.Equal(3, representatives.Distinct(StringComparer.Ordinal).Count());
        Assert.Equal(representatives, ServiceOrderSignatureHistory.RepresentativesOf("CM"));
        Assert.All(representatives, name => Assert.Equal(name, OperationDocumentRules.NormalizeSignerName(name)));

        for (var index = 0; index < 50; index++)
        {
            var strokes = ServiceOrderSignatureHistory.StrokesFor($"sample:{index}");
            var normalized = OperationDocumentRules.NormalizeStrokes(strokes);
            Assert.NotNull(normalized);
            Assert.Equal(OperationDocumentRules.StrokesJson(strokes), OperationDocumentRules.StrokesJson(normalized));
            Assert.Equal(OperationDocumentRules.StrokesJson(strokes),
                OperationDocumentRules.StrokesJson(ServiceOrderSignatureHistory.StrokesFor($"sample:{index}")));
        }

        var pushback = new DateTimeOffset(2026, 11, 20, 15, 40, 0, TimeSpan.Zero);
        foreach (var handOff in new[] { pushback.AddMinutes(12), pushback.AddSeconds(30), pushback, pushback.AddMinutes(-1) })
        {
            var (representative, agent) = ServiceOrderSignatureHistory.SigningTimes(pushback, handOff, "times");
            Assert.True(representative < agent && agent < handOff, $"{representative:O} {agent:O} {handOff:O}");
            if (handOff > pushback.AddMinutes(1)) Assert.True(representative > pushback);
        }
    }

    [Fact]
    public async Task DevelopmentHistoryServiceOrderSignaturesSignTheHistoryAndLetOccApproveAPendingDelivery()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        var options = DevelopmentHistoryOptions.Small;

        // The VPS: every chunk but the signatures already committed, then the seeder runs only the new ones.
        var chunks = HistoryChunkRegistry.Build(options);
        await using (var connection = await database.OpenAsDevelopmentSeederAsync(ct))
        await using (var context = CreateContext(connection))
        {
            context.ChangeTracker.AutoDetectChangesEnabled = false;
            foreach (var chunk in chunks.Where(item =>
                         !item.Name.StartsWith(ServiceOrderSignatureHistory.ChunkPrefix, StringComparison.Ordinal)))
                await HistoryChunkRunner.RunAsync(context, chunk, options, ct);
        }
        var before = await HistoryTableCountsAsync(database.ConnectionString, ct);
        Assert.Equal(0, before["[ops].[operation_document_signatures]"]);
        var ran = await SeedHistoryAsSeederAsync(database, options, ct);
        Assert.Equal(options.Months().Select(month => ServiceOrderSignatureHistory.ChunkPrefix + month.Name), ran);

        await using var db = CreateContext(database.ConnectionString);
        var anchors = await HistoryAnchors.LoadAsync(db, ct);
        var catalog = await HistoryCatalog.LoadAsync(db, anchors, ct);
        var agents = catalog.Agents.ToDictionary(agent => agent.RampAgentId);
        var agentIds = agents.Keys.ToArray();
        var handedOff = await db.OperationSubmissions.AsNoTracking()
            .Where(item => item.RevisionNumber == 1 && agentIds.Contains(item.SubmittedByRampAgentId))
            .ToArrayAsync(ct);
        Assert.NotEmpty(handedOff);
        var operationIds = handedOff.Select(item => item.GroundOperationId).ToArray();
        var versions = await db.Set<OperationDocumentVersion>().AsNoTracking()
            .Where(item => operationIds.Contains(item.GroundOperationId)).ToArrayAsync(ct);
        var versionIds = versions.Select(item => item.Id).ToArray();
        var signatures = await db.Set<OperationDocumentSignature>().AsNoTracking()
            .Where(item => versionIds.Contains(item.OperationDocumentVersionId)).ToArrayAsync(ct);
        var pushbacks = await db.Set<OperationMilestone>().AsNoTracking()
            .Where(item => operationIds.Contains(item.GroundOperationId) && item.Code == OperationCloseFacts.Pushback)
            .ToDictionaryAsync(item => item.GroundOperationId, item => item.ActualAt!.Value, ct);
        var statuses = await db.GroundOperations.AsNoTracking().Where(item => operationIds.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id, item => item.CurrentStatus, ct);

        // One Service Order version per delivered operation, signed by the airline and the agent who handed it off.
        Assert.Equal(handedOff.Length, versions.Length);
        Assert.All(versions, version => Assert.Equal(OperationDocumentKind.ServiceOrder, version.Kind));
        Assert.All(handedOff, submission =>
        {
            var version = versions.Single(item => item.GroundOperationId == submission.GroundOperationId);
            Assert.Equal(OperationDocumentRules.Sha256Of(version.ContentJson), version.ContentSha256);
            var mine = signatures.Where(item => item.OperationDocumentVersionId == version.Id).ToArray();
            Assert.Equal(2, mine.Length);
            var representative = mine.Single(item => item.Role == OperationSignatureRole.AirlineRepresentative);
            var agent = mine.Single(item => item.Role == OperationSignatureRole.AviamAgent);
            Assert.Equal(agents[submission.SubmittedByRampAgentId].DisplayName, agent.SignerName);
            Assert.NotEqual(agent.SignerName, representative.SignerName);
            Assert.All(mine, signature =>
            {
                Assert.Equal(version.ContentSha256, signature.DocumentSha256);
                Assert.Equal(OperationDocumentRules.Sha256Of(signature.StrokesJson), signature.StrokesSha256);
                Assert.NotNull(OperationDocumentRules.NormalizeStrokes(OperationDocumentRules.ParseStrokes(signature.StrokesJson)));
                Assert.Equal(anchors.Occ.Id, signature.CapturedByAccountId);
                Assert.True(signature.SignedAt < submission.SubmittedAt, $"{signature.SignedAt:O} ≥ {submission.SubmittedAt:O}");
                Assert.True(signature.SignedAt >= version.CreatedAt);
            });
            Assert.True(representative.SignedAt < agent.SignedAt);
            Assert.True(representative.SignedAt > pushbacks[submission.GroundOperationId] ||
                        submission.SubmittedAt <= pushbacks[submission.GroundOperationId].AddSeconds(20));
        });
        Assert.True(signatures.Where(item => item.Role == OperationSignatureRole.AirlineRepresentative)
            .Select(item => item.SignerName).Distinct(StringComparer.Ordinal).Count() > 3);

        // The signature covers the content OCC reads now: signed, never stale, for every state the history leaves.
        foreach (var operationId in operationIds)
        {
            var evaluation = await ServiceOrderSignatures.EvaluateAsync(db, operationId, null, ct);
            Assert.Equal(ServiceOrderStates.FullySigned, evaluation.State);
        }
        Assert.Contains(GroundOperationStatus.PendingReview, statuses.Values);
        Assert.Contains(GroundOperationStatus.Returned, statuses.Values);

        // OCC sees the order signed and approves a pending history delivery through its review store.
        var station = anchors.Station.PublicId;
        var pending = await db.GroundOperations.AsNoTracking()
            .Where(item => operationIds.Contains(item.Id) && item.CurrentStatus == GroundOperationStatus.PendingReview)
            .OrderBy(item => item.Id).Select(item => item.PublicId).FirstAsync(ct);
        await using (var scope = provider.CreateAsyncScope())
        {
            var view = await scope.ServiceProvider.GetRequiredService<IOperationDocumentStore>()
                .ReadForOccAsync([station], pending, ct);
            var order = view!.Documents.Single(item => item.Content.Kind == OperationDocumentKind.ServiceOrder);
            Assert.Equal(2, order.Signatures.Count);
            Assert.Empty(order.StaleRoles);
        }
        OccReviewDetailData detail;
        await using (var scope = provider.CreateAsyncScope())
            detail = (await scope.ServiceProvider.GetRequiredService<IOccReviewStore>().GetDetailAsync(pending, [station], ct))!;
        Assert.Equal(ServiceOrderStates.FullySigned, detail.ServiceOrderState);
        await using (var scope = provider.CreateAsyncScope())
        {
            var approved = await scope.ServiceProvider.GetRequiredService<IOccReviewStore>().DecideAsync(
                new OccReviewDecisionWriteRequest(HistoryOccAccount, [station], pending, detail.SubmissionId,
                    detail.ConcurrencyToken, "Approved", null, Guid.NewGuid(), "history-signed-approve", Guid.NewGuid()), ct);
            Assert.True(approved.IsSuccess, $"{approved.Failure} {approved.Code}");
        }
        await using (var check = CreateContext(database.ConnectionString))
            Assert.Equal(GroundOperationStatus.Approved, await check.GroundOperations.AsNoTracking()
                .Where(item => item.PublicId == pending).Select(item => item.CurrentStatus).SingleAsync(ct));

        // A second run takes the fast path and writes nothing.
        var complete = await HistoryTableCountsAsync(database.ConnectionString, ct);
        Assert.Empty(await SeedHistoryAsSeederAsync(database, options, ct));
        Assert.Equal(complete, await HistoryTableCountsAsync(database.ConnectionString, ct));
    }
}
