namespace Elevant.Infrastructure.Persistence.Seed.History;

/// <summary>
/// Placeholder of the generator owned by part C (operaciones): un chunk «ops:2026-W22»… por semana ISO (options.IsoWeeks()).
/// It returns no chunk until that part lands; <see cref="HistoryChunkRegistry"/> already lists it in order.
/// </summary>
internal static class OperationsHistory
{
    public static IEnumerable<HistoryChunk> Chunks(DevelopmentHistoryOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        return [];
    }
}
