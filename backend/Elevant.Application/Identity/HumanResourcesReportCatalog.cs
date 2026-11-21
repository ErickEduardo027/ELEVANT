using System.Globalization;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Common;
using Elevant.Application.Documents;

namespace Elevant.Application.Identity;

/// <summary>A Gestión Humana report: its route key, Spanish title and description, typed columns and whether it is a cut-off.</summary>
public sealed record HumanResourcesReportDefinition(HumanResourcesReportKind Kind, string Key, string Title,
    string Description, IReadOnlyList<ReportColumn> Columns, bool AsOfDate);

/// <summary>
/// The four Gestión Humana reports and how they export through the common engine (ADR-0048). «Cobertura de
/// habilitaciones» is a cut-off report: it reads at the date <c>to</c> and the screen hides «Desde».
/// </summary>
public static class HumanResourcesReportCatalog
{
    public const string Area = "Gestión Humana";

    public static IReadOnlyList<HumanResourcesReportDefinition> All { get; } =
    [
        new(HumanResourcesReportKind.Expirations, "expirations", HumanResourcesReportLabels.Title(HumanResourcesReportKind.Expirations),
            "Habilitaciones de equipo y permisos aeroportuarios vigentes de los agentes de la estación que vencen en el " +
            "período, del más próximo al más lejano.",
            [ReportColumn.Text("Agente"), ReportColumn.Text("Empleado"), ReportColumn.Text("Clase"),
                ReportColumn.Text("Documento"), new("Vence", ReportColumnType.Date)], false),
        new(HumanResourcesReportKind.AccountMovements, "account-movements",
            HumanResourcesReportLabels.Title(HumanResourcesReportKind.AccountMovements),
            "Altas, desactivaciones y reactivaciones de las cuentas de los agentes de la estación, en hora local.",
            [new("Fecha y hora local", ReportColumnType.DateTime), ReportColumn.Text("Agente"), ReportColumn.Text("Empleado"),
                ReportColumn.Text("Movimiento")], false),
        new(HumanResourcesReportKind.StaffDistribution, "staff-distribution",
            HumanResourcesReportLabels.Title(HumanResourcesReportKind.StaffDistribution),
            "Turnos programados de cada agente por día, terminal y puesto, con su horario local.",
            [new("Fecha", ReportColumnType.Date), ReportColumn.Text("Agente"), ReportColumn.Text("Empleado"),
                ReportColumn.Text("Terminal"), ReportColumn.Text("Puesto"), new("Inicio", ReportColumnType.Time),
                new("Fin", ReportColumnType.Time)], false),
        new(HumanResourcesReportKind.QualificationCoverage, "qualification-coverage",
            HumanResourcesReportLabels.Title(HumanResourcesReportKind.QualificationCoverage),
            "Por equipo que exige habilitación, a la fecha de corte: los agentes de la estación formados en él " +
            "(elegibles: con un ciclo registrado) y cuántos de ellos tienen la habilitación vigente.",
            [ReportColumn.Text("Equipo"), ReportColumn.Text("Nombre"), ReportColumn.Number("Elegibles"),
                ReportColumn.Number("Habilitados"), ReportColumn.Number("Sin habilitación vigente"),
                new("% habilitados", ReportColumnType.Percent)], true),
    ];

    public static HumanResourcesReportDefinition Find(HumanResourcesReportKind kind) => All.Single(item => item.Kind == kind);

    public static HumanResourcesReportDefinition? Find(string? key) =>
        All.FirstOrDefault(item => string.Equals(item.Key, key, StringComparison.Ordinal));

    /// <summary>An export snapshot as the common engine prints it, with its filters by name and its summary.</summary>
    public static ReportDocument ToDocument(HumanResourcesReportSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        var definition = Find(snapshot.Kind);
        if (string.IsNullOrWhiteSpace(snapshot.StationCode) || snapshot.Columns.Count != definition.Columns.Count ||
            snapshot.Rows.Any(row => row.Count != definition.Columns.Count))
            throw new ArgumentException("The report snapshot is incomplete.", nameof(snapshot));
        var rows = snapshot.Rows.Select(row => (IReadOnlyList<ReportCell>)row.Select((cell, index) =>
            definition.Columns[index].Type == ReportColumnType.Text
                ? ReportCell.Of(cell.Value)
                : ReportFormat.Parse(definition.Columns[index].Type, cell.Value)).ToArray()).ToArray();
        IReadOnlyList<ReportFilter> filters = snapshot.Kind == HumanResourcesReportKind.Expirations
            ?
            [
                new("Clase", HumanResourcesReportLabels.DocumentKindFilter(snapshot.DocumentKind)),
                new("Vigencia", HumanResourcesReportLabels.Validity(snapshot.Validity)),
            ]
            : [];
        return new ReportDocument(Area, definition.Title, definition.Columns, rows)
        {
            Description = definition.Description,
            StationCode = snapshot.StationCode,
            StationName = snapshot.StationName,
            From = snapshot.From,
            To = snapshot.To,
            AsOfDate = definition.AsOfDate,
            Filters = filters,
            GeneratedAt = snapshot.AsOf,
            TimeZoneId = snapshot.TimeZone,
            GeneratedBy = snapshot.GeneratedBy,
            Summary = Summary(snapshot, rows),
        };
    }

    /// <summary>The figures with context (G3): «Vencidas 3 de 40 (7.5 %)», «Equipos con cobertura completa 2 de 5».</summary>
    public static IReadOnlyList<ReportMetric> Summary(HumanResourcesReportSnapshot snapshot,
        IReadOnlyList<IReadOnlyList<ReportCell>> rows)
    {
        var count = rows.Count;
        switch (snapshot.Kind)
        {
            case HumanResourcesReportKind.Expirations:
            {
                var today = BusinessCalendar.Today(snapshot.AsOf, snapshot.TimeZone).ToDateTime(TimeOnly.MinValue);
                var expired = rows.Count(row => row[4].Moment < today);
                var soon = rows.Count(row => row[4].Moment >= today && row[4].Moment <= today.AddDays(30));
                return
                [
                    new("Documentos", ReportFormat.Integer(count),
                        $"de {ReportFormat.Integer(rows.Select(row => row[1].Text).Distinct(StringComparer.Ordinal).Count())} agentes"),
                    new("Ya vencidos", ReportFormat.Integer(expired), ReportFormat.OfTotal(expired, count, "documentos")),
                    new("Vencen en 30 días", ReportFormat.Integer(soon), ReportFormat.OfTotal(soon, count, "documentos")),
                ];
            }
            case HumanResourcesReportKind.AccountMovements:
            {
                int Of(string movement) => rows.Count(row => row[3].Text == movement);
                return
                [
                    new("Movimientos", ReportFormat.Integer(count)),
                    new("Altas", ReportFormat.Integer(Of("Alta de cuenta")), ReportFormat.OfTotal(Of("Alta de cuenta"), count, "movimientos")),
                    new("Desactivaciones", ReportFormat.Integer(Of("Cuenta desactivada")),
                        ReportFormat.OfTotal(Of("Cuenta desactivada"), count, "movimientos")),
                    new("Reactivaciones", ReportFormat.Integer(Of("Cuenta reactivada")),
                        ReportFormat.OfTotal(Of("Cuenta reactivada"), count, "movimientos")),
                ];
            }
            case HumanResourcesReportKind.StaffDistribution:
                return
                [
                    new("Turnos", ReportFormat.Integer(count),
                        $"en {ReportFormat.Integer(rows.Select(row => row[0].Text).Distinct(StringComparer.Ordinal).Count())} días"),
                    new("Agentes programados", ReportFormat.Integer(rows.Select(row => row[2].Text).Distinct(StringComparer.Ordinal).Count())),
                    new("Sin puesto asignado", ReportFormat.Integer(rows.Count(row => row[4].Text == "—")),
                        ReportFormat.OfTotal(rows.Count(row => row[4].Text == "—"), count, "turnos")),
                ];
            case HumanResourcesReportKind.QualificationCoverage:
            {
                var eligible = rows.Sum(row => row[2].Number ?? 0m);
                var qualified = rows.Sum(row => row[3].Number ?? 0m);
                var complete = rows.Count(row => (row[2].Number ?? 0m) > 0 && row[2].Number == row[3].Number);
                var metrics = new List<ReportMetric>
                {
                    new("Equipos con cobertura completa", ReportFormat.Integer(complete), ReportFormat.OfTotal(complete, count, "equipos")),
                    new("Habilitaciones vigentes", ReportFormat.Integer(qualified), ReportFormat.OfTotal(qualified, eligible, "elegibles")),
                };
                if (snapshot.StationAgents is { } agents)
                    metrics.Insert(0, new("Agentes activos de la estación", ReportFormat.Integer(agents),
                        $"al {snapshot.To.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture)}"));
                return metrics;
            }
            default:
                return [];
        }
    }
}
