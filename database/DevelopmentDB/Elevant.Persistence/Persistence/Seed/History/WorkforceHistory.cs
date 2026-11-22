namespace Elevant.Infrastructure.Persistence.Seed.History;

/// <summary>
/// Placeholder of the generator owned by part B (Gestión Humana): chunk «workforce» — agentes HIST-RA-001…, expedientes, habilitaciones, permisos, turnos y coberturas.
/// It returns no chunk until that part lands; <see cref="HistoryChunkRegistry"/> already lists it in order.
/// </summary>
internal static class WorkforceHistory
{
    public static IEnumerable<HistoryChunk> Chunks(DevelopmentHistoryOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        return [];
    }
}
