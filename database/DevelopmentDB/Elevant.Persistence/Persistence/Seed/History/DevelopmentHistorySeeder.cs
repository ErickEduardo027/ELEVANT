namespace Elevant.Infrastructure.Persistence.Seed.History;

/// <summary>
/// Adds six months of synthetic, deterministic history at PUJ to a marked Development database (after
/// <see cref="DevelopmentDataSeeder"/>, which it never changes), so every report has data. Insert-only: it runs with
/// the seeder login (SELECT + INSERT on iam/ref/hr/commercial/ops), never updates or deletes a row, and writes no
/// audit, outbox or email. The work is split into chunks (<see cref="HistoryChunkRegistry"/>); each commits with its
/// sentinel, so a failed run leaves a consistent prefix and the next run (the CD's <c>--retry</c>) resumes it.
/// </summary>
public sealed class DevelopmentHistorySeeder(ElevantDbContext context, TextWriter? log = null)
{
    /// <summary>
    /// Runs the missing chunks in order and returns their names (empty when the history was already complete). The
    /// fast path is one query: the sentinel of the last registered chunk.
    /// </summary>
    public async Task<IReadOnlyList<string>> SeedAsync(DevelopmentHistoryOptions? options = null,
        CancellationToken cancellationToken = default)
    {
        options ??= DevelopmentHistoryOptions.Default;
        await DatabaseInstanceVerifier.RequireEnvironmentAsync(context, "Development", cancellationToken);
        context.ChangeTracker.AutoDetectChangesEnabled = false;

        var chunks = HistoryChunkRegistry.Build(options);
        if (chunks.Count == 0 ||
            await HistoryChunkRunner.IsCompleteAsync(context, chunks[^1].Name, cancellationToken))
            return [];

        // Fail before any write when the base seed is missing, with the list of what is absent.
        await HistoryAnchors.LoadAsync(context, cancellationToken);

        var ran = new List<string>();
        foreach (var chunk in chunks)
        {
            if (!await HistoryChunkRunner.RunAsync(context, chunk, options, cancellationToken)) continue;
            ran.Add(chunk.Name);
            log?.WriteLine($"Development history: chunk {chunk.Name} committed.");
            if (string.Equals(options.FailAfterChunk, chunk.Name, StringComparison.Ordinal))
                throw new DevelopmentHistoryInterruptedException(chunk.Name);
        }
        return ran;
    }
}
