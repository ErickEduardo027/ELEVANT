namespace Elevant.Infrastructure.Persistence.Seed.History;

/// <summary>
/// The chunks of the history in execution order: commercial, workforce, fx, ops:&lt;ISO week&gt;…,
/// finance:&lt;month&gt;…, payables, then ops-extra:&lt;month&gt;… and finance-extra:&lt;month&gt;… (added later, so a
/// database with the rest only runs them). The last registered chunk is the final sentinel of the fast path, so a
/// generator that is still empty simply contributes nothing and the order of the others holds.
/// </summary>
internal static class HistoryChunkRegistry
{
    /// <summary>Generators in order. Each owns its file; adding one never edits another.</summary>
    public static readonly IReadOnlyList<HistoryChunkSource> Sources =
    [
        CommercialHistory.Chunks,
        WorkforceHistory.Chunks,
        ExchangeRateHistory.Chunks,
        OperationsHistory.Chunks,
        FinanceHistory.Chunks,
        PayablesHistory.Chunks,
        OperationsHistory.ExtraChunks,
        FinanceHistory.ExtraChunks,
    ];

    public static IReadOnlyList<HistoryChunk> Build(DevelopmentHistoryOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        var chunks = Sources.SelectMany(source => source(options)).ToArray();
        var duplicate = chunks.GroupBy(chunk => chunk.Name, StringComparer.Ordinal).FirstOrDefault(group => group.Count() > 1);
        if (duplicate is not null)
            throw new InvalidOperationException($"Development history chunk «{duplicate.Key}» is registered twice.");
        return chunks;
    }
}
