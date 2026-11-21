using System.Globalization;
using System.Text;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Common;
using Elevant.Application.Documents;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations;

/// <summary>
/// An OCC report as the common engine prints it (ADR-0048): its typed cells, the summary with context computed over the
/// whole period, the totals and the readable filters. The CSV keeps its own plain format (UTF-8 with BOM, the heading
/// lines, RFC 4180 quoting and neutralised formulas).
/// </summary>
public static class OccReportDocuments
{
    public static ReportDocument ToDocument(OccReportTable table)
    {
        ArgumentNullException.ThrowIfNull(table);
        var specs = table.Definition.Specs;
        if (string.IsNullOrWhiteSpace(table.StationCode) || table.Rows.Any(row => row.Count != specs.Count))
            throw new ArgumentException("The report table is incomplete.", nameof(table));
        return new ReportDocument(OccReportCatalog.Area, table.Definition.Title, specs, Cells(specs, table.Rows))
        {
            Description = table.Definition.Description,
            StationCode = table.StationCode,
            StationName = table.StationName,
            From = table.From,
            To = table.To,
            Filters = table.Filters,
            GeneratedAt = table.AsOf,
            TimeZoneId = table.TimeZoneId,
            GeneratedBy = table.GeneratedBy,
            Summary = table.Summary,
            Totals = table.Totals.Count > 0 ? table.Totals : null,
        };
    }

    /// <summary>The typed cells of a report's rows: dates, times and numbers parse by their column.</summary>
    public static IReadOnlyList<IReadOnlyList<ReportCell>> Cells(IReadOnlyList<ReportColumn> specs,
        IReadOnlyList<IReadOnlyList<OccReportCell>> rows) =>
        rows.Select(row => (IReadOnlyList<ReportCell>)row.Select((cell, index) =>
            specs[index].Type == ReportColumnType.Text ? ReportCell.Of(cell.Value) : ReportFormat.Parse(specs[index].Type,
                cell.Value)).ToArray()).ToArray();

    /// <summary>The totals of the whole period (every row, not one page).</summary>
    public static IReadOnlyList<ReportTotalRow> Totals(OccReportDefinition definition,
        IReadOnlyList<IReadOnlyList<OccReportCell>> rows) =>
        ReportTotals.Compute(definition.Specs, Cells(definition.Specs, rows));

    /// <summary>
    /// The figures of the whole period with their context (G3): «Aprobadas 32 de 40 operaciones (80.0 %)».
    /// </summary>
    public static IReadOnlyList<ReportMetric> Summary(OccReportKind kind, IReadOnlyList<IReadOnlyList<OccReportCell>> rows)
    {
        var count = rows.Count;
        decimal? Number(IReadOnlyList<OccReportCell> row, int index) =>
            row[index].Type == OccReportCellType.Number &&
            decimal.TryParse(row[index].Value, NumberStyles.Number, CultureInfo.InvariantCulture, out var value) ? value : null;
        int Where(Func<IReadOnlyList<OccReportCell>, bool> predicate) => rows.Count(predicate);
        int Distinct(int index) => rows.Select(row => row[index].Value).Distinct(StringComparer.Ordinal).Count();
        string Of(int part, int whole, string singular, string plural) => ReportFormat.OfTotal(part, whole, singular, plural);
        var approved = OperationLabels.Status(GroundOperationStatus.Approved);
        var returned = OperationLabels.Status(GroundOperationStatus.Returned);
        switch (kind)
        {
            case OccReportKind.Operations:
                return
                [
                    new("Operaciones", ReportFormat.Integer(count), $"de {ReportFormat.Count(Distinct(2), "aerolínea", "aerolíneas")}"),
                    new("Aprobadas", ReportFormat.Integer(Where(row => row[4].Value == approved)),
                        Of(Where(row => row[4].Value == approved), count, "operación", "operaciones")),
                    new("Devueltas", ReportFormat.Integer(Where(row => row[4].Value == returned)),
                        Of(Where(row => row[4].Value == returned), count, "operación", "operaciones")),
                    new("Sin agente asignado", ReportFormat.Integer(Where(row => row[9].Value == "Sin asignar")),
                        Of(Where(row => row[9].Value == "Sin asignar"), count, "operación", "operaciones")),
                ];
            case OccReportKind.TurnaroundTimes:
            {
                var actual = rows.Select(row => Number(row, 4)).OfType<decimal>().ToArray();
                var compared = rows.Where(row => Number(row, 5) is not null).ToArray();
                var late = compared.Count(row => Number(row, 5) > 0);
                return
                [
                    new("Operaciones terminadas", ReportFormat.Integer(count)),
                    new("Duración real promedio", actual.Length == 0 ? "—" : ReportFormat.Duration(actual.Average()),
                        "horas:minutos"),
                    new("Más largas que lo planificado", ReportFormat.Integer(late), Of(late, compared.Length, "con plan", "con plan")),
                ];
            }
            case OccReportKind.ServicesByAirline:
            {
                var contracted = rows.Sum(row => Number(row, 4) ?? 0m);
                var executed = rows.Sum(row => Number(row, 5) ?? 0m);
                return
                [
                    new("Aerolíneas con servicios", ReportFormat.Integer(Distinct(0))),
                    new("Servicios distintos", ReportFormat.Integer(Distinct(1)), $"en {ReportFormat.Count(count, "fila", "filas")}"),
                    new("Cantidad ejecutada", ReportFormat.Decimal(executed, executed == decimal.Truncate(executed) ? 0 : 2),
                        ReportFormat.Share(executed, contracted) is { } share ? $"{share} de lo contratado" : null),
                ];
            }
            case OccReportKind.Reviews:
            {
                var back = Where(row => row[4].Value == "Devuelta");
                var incidents = Where(row => row[7].Value != "Ninguna");
                return
                [
                    new("Decisiones de revisión", ReportFormat.Integer(count),
                        $"de {ReportFormat.Count(Distinct(1), "operación", "operaciones")}"),
                    new("Devueltas", ReportFormat.Integer(back), Of(back, count, "decisión", "decisiones")),
                    new("Con incidencias", ReportFormat.Integer(incidents), Of(incidents, count, "decisión", "decisiones")),
                ];
            }
            case OccReportKind.AgentProductivity:
            {
                var operations = rows.Sum(row => Number(row, 2) ?? 0m);
                var approvedWork = rows.Sum(row => Number(row, 3) ?? 0m);
                var minutes = rows.Sum(row => Number(row, 5) ?? 0m);
                return
                [
                    new("Agentes con trabajo", ReportFormat.Integer(count)),
                    new("Operaciones trabajadas", ReportFormat.Integer(operations), "un relevo cuenta para cada agente"),
                    new("Aprobadas", ReportFormat.Integer(approvedWork), ReportFormat.OfTotal(approvedWork, operations, "trabajada", "trabajadas")),
                    new("Tiempo trabajado", ReportFormat.Duration(minutes), "horas:minutos"),
                ];
            }
            case OccReportKind.DailyClose:
            {
                var measured = rows.Where(row => Number(row, 11) is not null && Number(row, 12) is not null).ToArray();
                var over = measured.Count(row => Number(row, 11) > Number(row, 12));
                var delayed = Where(row => row[13].Value != "—");
                return
                [
                    new("Operaciones", ReportFormat.Integer(count)),
                    new("Excedieron el tiempo permitido", ReportFormat.Integer(over), Of(over, measured.Length, "medida", "medidas")),
                    new("Con demoras IATA", ReportFormat.Integer(delayed), Of(delayed, count, "operación", "operaciones")),
                    new("Desviaciones", ReportFormat.Integer(rows.Sum(row => Number(row, 14) ?? 0m))),
                ];
            }
            case OccReportKind.CoverageAssignments:
            {
                var released = Where(row => row[8].Value != "—");
                var reinforcements = Where(row => row[10].Value == "Sí");
                return
                [
                    new("Asignaciones", ReportFormat.Integer(count), $"de {ReportFormat.Count(Distinct(3), "agente", "agentes")}"),
                    new("Vigentes", ReportFormat.Integer(count - released), Of(count - released, count, "asignación", "asignaciones")),
                    new("Liberadas", ReportFormat.Integer(released), Of(released, count, "asignación", "asignaciones")),
                    new("Refuerzos", ReportFormat.Integer(reinforcements), Of(reinforcements, count, "asignación", "asignaciones")),
                ];
            }
            default:
                return [];
        }
    }

    /// <summary>
    /// The CSV of a report: UTF-8 with BOM so Excel opens accents, the heading lines (report, station, period, filters,
    /// generation in the station's local time and rows), then the columns and the rows (3-N26).
    /// </summary>
    public static byte[] Csv(OccReportTable table)
    {
        ArgumentNullException.ThrowIfNull(table);
        if (string.IsNullOrWhiteSpace(table.StationCode) || table.Definition.Columns.Count == 0 ||
            table.Rows.Any(row => row.Count != table.Definition.Columns.Count))
            throw new ArgumentException("The report table is incomplete.", nameof(table));
        var text = new StringBuilder();
        foreach (var line in Heading(table)) text.Append(CsvValue(line)).Append("\r\n");
        text.Append("\r\n").Append(string.Join(',', table.Definition.Columns.Select(CsvValue))).Append("\r\n");
        foreach (var row in table.Rows)
            text.Append(string.Join(',', row.Select(cell => CsvValue(cell.Value)))).Append("\r\n");
        return [.. Encoding.UTF8.GetPreamble(), .. Encoding.UTF8.GetBytes(text.ToString())];
    }

    private static IEnumerable<string> Heading(OccReportTable table)
    {
        yield return "ELEVANT · Centro de Control Operacional";
        yield return table.Definition.Title;
        yield return $"Estación: {table.StationCode}";
        yield return $"Período: {Date(table.From)} – {Date(table.To)}";
        foreach (var filter in table.Filters) yield return $"{filter.Label}: {filter.Value}";
        // 3-N26: the station's local time, as every time of the report (BusinessCalendar, never the host's zone).
        var generated = TimeZoneInfo.ConvertTime(table.AsOf, BusinessCalendar.Zone(table.TimeZoneId));
        yield return $"Generado: {generated.ToString("dd/MM/yyyy HH:mm", CultureInfo.InvariantCulture)} (hora local)" +
            (string.IsNullOrWhiteSpace(table.GeneratedBy) ? string.Empty : $" por {table.GeneratedBy.Trim()}");
        yield return $"Filas: {table.RowCount.ToString(CultureInfo.InvariantCulture)}";
    }

    private static string Date(DateOnly value) => value.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture);

    /// <summary>RFC 4180 quoting; a leading formula character is neutralised so a cell never runs in Excel.</summary>
    public static string CsvValue(string value)
    {
        var formula = value.Length > 0 && value[0] is '=' or '+' or '-' or '@' &&
            !decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out _);
        var safe = formula ? "'" + value : value;
        return safe.IndexOfAny([',', '"', '\r', '\n']) >= 0 ? $"\"{safe.Replace("\"", "\"\"", StringComparison.Ordinal)}\"" : safe;
    }
}
