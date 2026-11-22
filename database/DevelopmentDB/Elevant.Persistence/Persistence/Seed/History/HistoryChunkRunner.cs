using Elevant.Domain.Entities.Commercial;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Infrastructure.Persistence.Seed.History;

/// <summary>
/// Runs one chunk atomically. Inside the execution strategy (a transient failure replays it from the start): clear
/// the change tracker, open the chunk's transaction, check the sentinel again (another runner may have finished it),
/// rebuild anchors and catalog, let the chunk insert its layers, insert the sentinel and commit.
/// <para>
/// The sentinel is a row of <c>commercial.finance_pricing_commands</c> (the idempotency receipts of the commercial
/// commands, which the seeder may insert and no screen lists) whose <c>request_id</c> and public id are
/// <c>HistoryKeys.Key("chunk:" + name)</c> and whose action is <see cref="SentinelAction"/>. No receipt of a real
/// command can collide with it: their keys are client UUIDs of another namespace.
/// </para>
/// </summary>
internal static class HistoryChunkRunner
{
    public const string SentinelAction = "dev-history.chunk";

    public static Guid SentinelKey(string chunkName) => HistoryKeys.Key("chunk:" + chunkName);

    public static Task<bool> IsCompleteAsync(ElevantDbContext context, string chunkName,
        CancellationToken cancellationToken)
    {
        var key = SentinelKey(chunkName);
        return context.Set<FinancePricingCommand>().AsNoTracking().AnyAsync(item => item.RequestId == key, cancellationToken);
    }

    /// <summary>True when the chunk ran now; false when its sentinel already existed.</summary>
    public static async Task<bool> RunAsync(ElevantDbContext context, HistoryChunk chunk,
        DevelopmentHistoryOptions options, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(chunk);
        ArgumentNullException.ThrowIfNull(options);
        if (await IsCompleteAsync(context, chunk.Name, cancellationToken)) return false;

        var strategy = context.Database.CreateExecutionStrategy();
        var ran = await strategy.ExecuteAsync(async () =>
        {
            context.ChangeTracker.Clear();
            await using var transaction = await context.Database.BeginTransactionAsync(chunk.Isolation, cancellationToken);
            if (await IsCompleteAsync(context, chunk.Name, cancellationToken))
            {
                await transaction.CommitAsync(cancellationToken);
                return false;
            }
            var anchors = await HistoryAnchors.LoadAsync(context, cancellationToken);
            var catalog = await HistoryCatalog.LoadAsync(context, anchors, cancellationToken);
            var chunkContext = new HistoryChunkContext(context, chunk.Name, options, anchors, catalog);
            await chunk.RunAsync(chunkContext, cancellationToken);

            // The sentinel's instant is the end of the window, never the clock: reruns stay byte-identical.
            var at = chunkContext.Clock.ToUtc(options.WindowEnd, HistoryClock.DayEnd);
            var key = SentinelKey(chunk.Name);
            await chunkContext.InsertAsync(
            [
                new FinancePricingCommand
                {
                    PublicId = key, RequestId = key, ResultId = key, ActorAccountId = anchors.Occ.Id,
                    Action = SentinelAction, PayloadHash = HistoryKeys.Sha256(chunk.Name + "|" + options.Fingerprint()),
                    CreatedAt = at, UpdatedAt = at,
                },
            ], cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return true;
        });
        context.ChangeTracker.Clear();
        return ran;
    }
}
