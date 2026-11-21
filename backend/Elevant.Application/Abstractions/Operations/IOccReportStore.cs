using Elevant.Application.Documents;
using Elevant.Domain.Enumerations;

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

    /// <summary>Who covers which stands, when, and who assigned and released it (ADR-0030, teacher review 16-nov).</summary>
    CoverageAssignments,
}

public enum OccReportCellType { Text, Number }

public sealed record OccReportCell(string Value, OccReportCellType Type = OccReportCellType.Text)
{
    /// <summary>
    /// A number with a dot and without the trailing zeros of its stored scale: a quantity of <c>decimal(18,4)</c> reads
    /// «1», not «1.0000» (3-N26).
    /// </summary>
    public static OccReportCell Number(decimal value) =>
        new(value.ToString("0.############################", System.Globalization.CultureInfo.InvariantCulture),
            OccReportCellType.Number);
}

/// <summary>
/// An OCC report: its columns are typed for the export engine (ADR-0048) and <see cref="Filters"/> lists the optional
/// filters it accepts besides the station and the period (<see cref="OccReportCatalog.AirlineFilter"/>…).
/// </summary>
public sealed record OccReportDefinition(OccReportKind Kind, string Key, string Title, string Description,
    IReadOnlyList<ReportColumn> Specs, IReadOnlyList<string> Filters)
{
    public IReadOnlyList<string> Columns { get; } = Specs.Select(column => column.Label).ToArray();

    /// <summary>OCC reports cover a period; none is «a una fecha de corte».</summary>
    public bool AsOfDate => false;
}

/// <summary>
/// The optional filters of an OCC report (ADR-0048): an airline, an operation status (its code, <c>Approved</c>), a ramp
/// agent and a terminal, by their public ids. A filter the report does not accept is an invalid query.
/// </summary>
public sealed record OccReportFilters(Guid? AirlineId = null, string? Status = null, Guid? AgentId = null,
    Guid? TerminalId = null)
{
    public static readonly OccReportFilters None = new();

    public bool IsEmpty => AirlineId is null && Status is null && AgentId is null && TerminalId is null;
}

public static class OccReportCatalog
{
    public const int MaxRangeDays = 366;

    /// <summary>
    /// Rows a CSV or Excel export carries at most (3-N13). An export is the whole period or nothing: over the limit
    /// it is refused (422 <c>report_too_large</c>), never cut.
    /// </summary>
    public const int MaxExportRows = 25_000;

    /// <summary>Rows a PDF export carries at most (3-N13); a longer period goes to Excel or CSV.</summary>
    public const int MaxPdfExportRows = 5_000;

    public const string AirlineFilter = "airline";
    public const string StatusFilter = "status";
    public const string AgentFilter = "agent";
    public const string TerminalFilter = "terminal";

    public const string Area = "Centro de Control Operacional";

    private static ReportColumn Text(string label) => ReportColumn.Text(label);

    private static ReportColumn Date(string label) => new(label, ReportColumnType.Date);

    private static ReportColumn Time(string label) => new(label, ReportColumnType.Time);

    private static ReportColumn Moment(string label) => new(label, ReportColumnType.DateTime);

    private static ReportColumn Number(string label, bool summable = false) => ReportColumn.Number(label, summable);

    public static IReadOnlyList<OccReportDefinition> All { get; } =
    [
        new(OccReportKind.Operations, "operations", "Operaciones del período",
            "Cada operación de la estación con su estado, horarios planificados y reales y sus agentes: los asignados " +
            "antes del inicio y, después, quienes la trabajaron.",
            [Date("Fecha"), Text("Operación"), Text("Aerolínea"), Text("Matrícula"), Text("Estado"),
                Time("Inicio planificado"), Time("Fin planificado"), Time("Inicio real"), Time("Fin real"), Text("Agentes")],
            [AirlineFilter, StatusFilter, AgentFilter]),
        new(OccReportKind.TurnaroundTimes, "turnaround-times", "Tiempos de turnaround",
            "Duración planificada frente a la real de las operaciones terminadas, con su desviación en minutos.",
            [Date("Fecha"), Text("Operación"), Text("Aerolínea"), Number("Minutos planificados"), Number("Minutos reales"),
                Number("Desviación (min)")],
            [AirlineFilter, StatusFilter, AgentFilter]),
        new(OccReportKind.ServicesByAirline, "services-by-airline", "Servicios ejecutados por aerolínea",
            "Servicios facturables de las operaciones aprobadas por OCC, con cantidades contratadas y ejecutadas, " +
            "agrupados por aerolínea.",
            [Text("Aerolínea"), Text("Servicio"), Text("Unidad"), Number("Operaciones"), Number("Cantidad contratada"),
                Number("Cantidad ejecutada")],
            [AirlineFilter]),
        new(OccReportKind.Reviews, "reviews", "Revisiones, devoluciones e incidencias",
            "Decisiones de revisión OCC de cada envío, con el motivo de las devoluciones y las incidencias reportadas.",
            [Date("Fecha"), Text("Operación"), Text("Aerolínea"), Number("Revisión"), Text("Resultado"), Text("Motivo"),
                Moment("Decidido"), Text("Incidencias")],
            [AirlineFilter, AgentFilter]),
        new(OccReportKind.AgentProductivity, "agent-productivity", "Productividad por agente",
            "Operaciones que cada agente trabajó o tiene asignadas, cuántas fueron aprobadas o devueltas y los minutos " +
            "de su tramo: quien fue liberado antes del inicio no cuenta y, en un relevo, cada agente suma su parte.",
            [Text("Agente"), Text("N.º de empleado"), Number("Operaciones", true), Number("Aprobadas", true),
                Number("Devueltas", true), Number("Minutos trabajados", true)],
            [AirlineFilter, AgentFilter]),
        new(OccReportKind.DailyClose, "daily-close", "Cierre operacional del día",
            "Por vuelo: horarios programados y reales, posición inicial y final, con cuántos minutos de antelación al " +
            "bloqueo llegó el último cambio de posición, tiempo en tierra frente al permitido por Finanzas, demoras IATA " +
            "y desviaciones (ADR-0034).",
            [Date("Fecha"), Text("Operación"), Text("Aerolínea"), Text("Vuelos"), Time("STA"), Time("ATA"), Time("STD"),
                Time("Push-back"), Text("Posición inicial"), Text("Posición final"), Number("Aviso del cambio (min)"),
                Number("Tiempo en tierra (min)"), Number("Permitido (min)"), Text("Demoras IATA"),
                Number("Desviaciones", true), Text("Estado")],
            [AirlineFilter, StatusFilter]),
        new(OccReportKind.CoverageAssignments, "coverage-assignments", "Asignaciones de cobertura",
            "Cada cobertura de posiciones del período: qué agente cubre qué posiciones de la terminal, desde y hasta " +
            "cuándo, cuándo y quién la asignó y, si se liberó, cuándo y quién la liberó. Las liberadas se conservan como " +
            "historial.",
            [Date("Fecha"), Text("Terminal"), Text("Posiciones"), Text("Agente"), Moment("Cubre desde"),
                Moment("Cubre hasta"), Moment("Asignada el"), Text("Asignada por"), Moment("Liberada el"),
                Text("Liberada por"), Text("Refuerzo")],
            [TerminalFilter, AgentFilter]),
    ];

    /// <summary>The labels of the optional filters, as the screens and the exports name them.</summary>
    public static string FilterLabel(string key) => key switch
    {
        AirlineFilter => "Aerolínea",
        StatusFilter => "Estado",
        AgentFilter => "Agente",
        TerminalFilter => "Terminal",
        _ => key,
    };

    /// <summary>The operation statuses the <c>status</c> filter accepts, with their Spanish label.</summary>
    public static IReadOnlyList<(string Code, string Label)> Statuses { get; } = Enum.GetValues<GroundOperationStatus>()
        .Select(status => (status.ToString(), Elevant.Application.Operations.OperationLabels.Status(status))).ToArray();

    public static OccReportDefinition? Find(string? key) =>
        All.FirstOrDefault(item => string.Equals(item.Key, key, StringComparison.Ordinal));

    public static bool ValidRange(DateOnly from, DateOnly to) =>
        from <= to && to.DayNumber - from.DayNumber < MaxRangeDays;

    /// <summary>Every filter given is one the report accepts, with no empty id and a known status code.</summary>
    public static bool ValidFilters(OccReportDefinition definition, OccReportFilters filters) =>
        (filters.AirlineId is null || filters.AirlineId != Guid.Empty && definition.Filters.Contains(AirlineFilter)) &&
        (filters.AgentId is null || filters.AgentId != Guid.Empty && definition.Filters.Contains(AgentFilter)) &&
        (filters.TerminalId is null || filters.TerminalId != Guid.Empty && definition.Filters.Contains(TerminalFilter)) &&
        (filters.Status is null || definition.Filters.Contains(StatusFilter) &&
            Statuses.Any(status => string.Equals(status.Code, filters.Status, StringComparison.Ordinal)));
}

public sealed record OccReportTable(OccReportDefinition Definition, Guid StationId, string StationCode,
    DateOnly From, DateOnly To, DateTimeOffset AsOf, IReadOnlyList<IReadOnlyList<OccReportCell>> Rows,
    int Page, int Limit, bool HasMore)
{
    public int RowCount => Rows.Count;

    /// <summary>
    /// The station's IANA zone: the exports write «Generado» in its local time (3-N26). Null is AVIAM's calendar
    /// (<c>BusinessCalendar</c>).
    /// </summary>
    public string? TimeZoneId { get; init; }

    public string? StationName { get; init; }

    /// <summary>The name of who asked for the report, for «Generado el … por …».</summary>
    public string? GeneratedBy { get; init; }

    /// <summary>The optional filters applied, with their readable names («Aerolínea: Arajet»).</summary>
    public IReadOnlyList<ReportFilter> Filters { get; init; } = [];

    /// <summary>Rows of the whole period (every page), the base of <see cref="Summary"/> and <see cref="Totals"/>.</summary>
    public int? TotalRows { get; init; }

    public IReadOnlyList<ReportMetric> Summary { get; init; } = [];

    public IReadOnlyList<ReportTotalRow> Totals { get; init; } = [];
}

public enum OccReportFailure { Forbidden, StationNotFound }

public sealed record OccReportResult(OccReportTable? Table, OccReportFailure? Failure);

public interface IOccReportStore
{
    /// <summary>
    /// One page of a report; <paramref name="limit"/> rows (at most <see cref="OccReportCatalog.MaxExportRows"/>)
    /// starting at <paramref name="page"/>. <see cref="OccReportTable.HasMore"/> says whether rows follow it.
    /// </summary>
    Task<OccReportResult> ReadAsync(Guid actorId, OccReportKind kind, Guid stationId, DateOnly from, DateOnly to,
        int page, int limit, OccReportFilters filters, CancellationToken cancellationToken = default);

    /// <summary>Audits a completed export; it needs «Exportar» on top of «Ver».</summary>
    Task<OccReportFailure?> RecordExportAsync(Guid actorId, OccReportKind kind, Guid stationId, DateOnly from,
        DateOnly to, string format, int rows, OccReportFilters filters, CancellationToken cancellationToken = default);
}
