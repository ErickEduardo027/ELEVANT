namespace Elevant.Application.Abstractions.Operations;

/// <summary>Server-generated OCC reports (teacher review, Phase 5); every one is a station-scoped table.</summary>
public enum OccReportKind
{
    Operations,
    TurnaroundTimes,
    ServicesByAirline,
    Reviews,
    AgentProductivity,
    DailyClose,
}

public enum OccReportCellType { Text, Number }

public sealed record OccReportCell(string Value, OccReportCellType Type = OccReportCellType.Text)
{
    public static OccReportCell Number(decimal value) =>
        new(value.ToString(System.Globalization.CultureInfo.InvariantCulture), OccReportCellType.Number);
}

public sealed record OccReportDefinition(OccReportKind Kind, string Key, string Title, string Description,
    IReadOnlyList<string> Columns);

public static class OccReportCatalog
{
    public const int MaxRangeDays = 366;

    public static IReadOnlyList<OccReportDefinition> All { get; } =
    [
        new(OccReportKind.Operations, "operations", "Operaciones del período",
            "Cada operación de la estación con su estado, horarios planificados y reales y agentes asignados.",
            ["Fecha", "Operación", "Aerolínea", "Matrícula", "Estado", "Inicio planificado", "Fin planificado",
                "Inicio real", "Fin real", "Agentes"]),
        new(OccReportKind.TurnaroundTimes, "turnaround-times", "Tiempos de turnaround",
            "Duración planificada frente a la real de las operaciones terminadas, con su desviación en minutos.",
            ["Fecha", "Operación", "Aerolínea", "Minutos planificados", "Minutos reales", "Desviación (min)"]),
        new(OccReportKind.ServicesByAirline, "services-by-airline", "Servicios ejecutados por aerolínea",
            "Cantidades contratadas y ejecutadas de cada servicio, agrupadas por aerolínea.",
            ["Aerolínea", "Servicio", "Unidad", "Operaciones", "Cantidad contratada", "Cantidad ejecutada"]),
        new(OccReportKind.Reviews, "reviews", "Revisiones, devoluciones e incidencias",
            "Decisiones de revisión OCC de cada envío, con el motivo de las devoluciones y las incidencias reportadas.",
            ["Fecha", "Operación", "Aerolínea", "Revisión", "Resultado", "Motivo", "Decidido", "Incidencias"]),
        new(OccReportKind.AgentProductivity, "agent-productivity", "Productividad por agente",
            "Operaciones asignadas a cada agente, cuántas fueron aprobadas o devueltas y los minutos trabajados.",
            ["Agente", "N.º de empleado", "Operaciones", "Aprobadas", "Devueltas", "Minutos trabajados"]),
        new(OccReportKind.DailyClose, "daily-close", "Cierre operacional del día",
            "Por vuelo: horarios programados y reales, posición inicial y final, con cuántos minutos de antelación al " +
            "bloqueo llegó el último cambio de posición, tiempo en tierra frente al permitido por Finanzas, demoras IATA " +
            "y desviaciones (ADR-0034).",
            ["Fecha", "Operación", "Aerolínea", "Vuelos", "STA", "ATA", "STD", "Push-back", "Posición inicial",
                "Posición final", "Aviso del cambio (min)", "Tiempo en tierra (min)", "Permitido (min)", "Demoras IATA",
                "Desviaciones", "Estado"]),
    ];

    public static OccReportDefinition? Find(string? key) =>
        All.FirstOrDefault(item => string.Equals(item.Key, key, StringComparison.Ordinal));

    public static bool ValidRange(DateOnly from, DateOnly to) =>
        from <= to && to.DayNumber - from.DayNumber < MaxRangeDays;
}

public sealed record OccReportTable(OccReportDefinition Definition, Guid StationId, string StationCode,
    DateOnly From, DateOnly To, DateTimeOffset AsOf, IReadOnlyList<IReadOnlyList<OccReportCell>> Rows,
    int Page, int Limit, bool HasMore)
{
    public int RowCount => Rows.Count;
}

public enum OccReportFailure { Forbidden, StationNotFound }

public sealed record OccReportResult(OccReportTable? Table, OccReportFailure? Failure);

public interface IOccReportStore
{
    /// <summary>One page of a report; <paramref name="limit"/> rows starting at <paramref name="page"/>.</summary>
    Task<OccReportResult> ReadAsync(Guid actorId, OccReportKind kind, Guid stationId, DateOnly from, DateOnly to,
        int page, int limit, CancellationToken cancellationToken = default);

    /// <summary>Audits a completed export; it needs «Exportar» on top of «Ver».</summary>
    Task<OccReportFailure?> RecordExportAsync(Guid actorId, OccReportKind kind, Guid stationId, DateOnly from,
        DateOnly to, string format, int rows, CancellationToken cancellationToken = default);
}

public interface IOccReportRenderer
{
    byte[] RenderCsv(OccReportTable table);

    byte[] RenderXlsx(OccReportTable table);

    byte[] RenderPdf(OccReportTable table);
}
