namespace Elevant.Infrastructure.Persistence.Seed.History;

/// <summary>
/// Placeholder of the generator owned by part D (finanzas): chunks «finance:2026-06»… por mes (options.Months()), Serializable como la emisión real.
/// It returns no chunk until that part lands; <see cref="HistoryChunkRegistry"/> already lists it in order.
/// </summary>
internal static class FinanceHistory
{
    public static IEnumerable<HistoryChunk> Chunks(DevelopmentHistoryOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        return [];
    }
}
