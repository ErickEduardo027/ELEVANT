namespace Elevant.Infrastructure.Persistence.Seed.History;

/// <summary>
/// Placeholder of the generator owned by part D (cuentas por pagar): chunk «payables», el último registrado y por tanto el centinela final.
/// It returns no chunk until that part lands; <see cref="HistoryChunkRegistry"/> already lists it in order.
/// </summary>
internal static class PayablesHistory
{
    public static IEnumerable<HistoryChunk> Chunks(DevelopmentHistoryOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        return [];
    }
}
