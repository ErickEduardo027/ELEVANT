using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Common;
using Elevant.Application.Documents;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Identity;

/// <summary>The source of the Gestión Humana tabular reports, for the API.</summary>
public interface IHumanResourcesTableReportSource : ITabularReportSource;

/// <summary>
/// The tabular reports of Gestión Humana (ADR-0048, «Reportes nuevos»): the staff roster and the audit trail. They
/// read through the stores of «Empleados» and «Trazabilidad / Auditoría», so the same rules decide what each account
/// sees; on top, «Reportes» (<c>human_resources.reports.read</c>) reads and «Exportar»
/// (<c>human_resources.reports.export</c>) exports.
/// </summary>
public sealed class HumanResourcesTableReports(
    IEmployeeGovernanceStore governance,
    IActorContextResolver actors,
    TimeProvider timeProvider) : IHumanResourcesTableReportSource
{
    public const string ReadPermission = "human_resources.reports.read";
    public const string ExportPermission = "human_resources.reports.export";

    /// <summary>Longest period of the audit trail, as «Trazabilidad» reads it (92 days).</summary>
    public const int AuditMaxRangeDays = 92;

    private const int MaxRows = 25_000;

    public static readonly ReportFilterDefinition Department = ReportFilterDefinition.Select("department", "Departamento",
        "department", new("human-resources", "Gestión Humana"), new("contracts", "Contratos"),
        new("operations", "Operaciones (OCC)"), new("finance", "Finanzas"));

    public static readonly ReportFilterDefinition EmployeeStatus = ReportFilterDefinition.Select("status", "Estado", "status",
        new("Active", "Activo"), new("Terminated", "De baja"));

    public static readonly ReportFilterDefinition Account = ReportFilterDefinition.Select("account", "Cuenta", "account",
        new("with", "Con cuenta"), new("without", "Sin cuenta"));

    public static readonly ReportFilterDefinition Category = ReportFilterDefinition.Select("category", "Tipo", "category",
        new("login", "Inicios de sesión"), new("governance", "Usuarios y accesos"), new("operation", "Operación"));

    public static readonly ReportFilterDefinition Action = new("action", "Acción", "action", ReportFilterKind.Select,
        AuditActionLabels.Known.Select(item => new ReportFilterOption(item.Key, item.Value)).ToArray());

    public static IReadOnlyList<TabularReportDefinition> All { get; } =
    [
        new("staff-roster", "Plantilla de personal",
            "Los empleados con su número, puesto, departamento, estaciones, estado, fecha de ingreso y cuenta de acceso.",
            [ReportColumn.Text("Número"), ReportColumn.Text("Empleado"), ReportColumn.Text("Puesto"),
                ReportColumn.Text("Departamento"), ReportColumn.Text("Estaciones"), ReportColumn.Text("Estado"),
                new("Ingreso", ReportColumnType.Date), ReportColumn.Text("Cuenta"), ReportColumn.Text("Correo corporativo")],
            ReportPeriod.None,
            [Department, EmployeeStatus, ReportFilterDefinition.Station(), Account]),
        new("audit-trail", "Trazabilidad y auditoría",
            "Lo que se hizo en el período (hora de Santo Domingo): quién, qué acción, sobre qué y el detalle.",
            [new("Fecha y hora", ReportColumnType.DateTime), ReportColumn.Text("Actor"), ReportColumn.Text("Acción"),
                ReportColumn.Text("Objetivo"), ReportColumn.Text("Departamento"), ReportColumn.Text("Estación"),
                ReportColumn.Text("Detalle")],
            ReportPeriod.Range,
            [Category, Action, Department])
        {
            MaxRangeDays = AuditMaxRangeDays,
            IgnoredParameters = ["stationId"],
        },
    ];

    public IReadOnlyList<TabularReportDefinition> Catalog => All;

    public async Task<TabularReportFailure?> AuthorizeExportAsync(Guid actorId, CancellationToken cancellationToken = default) =>
        await AllowedAsync(actorId, ExportPermission, cancellationToken) ? null : TabularReportFailure.Forbidden;

    public async Task<TabularReportResult> ReadAsync(Guid actorId, TabularReportDefinition definition,
        TabularReportQuery query, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(definition);
        ArgumentNullException.ThrowIfNull(query);
        if (!await AllowedAsync(actorId, ReadPermission, cancellationToken))
            return TabularReportResult.Failed(TabularReportFailure.Forbidden);
        return definition.Key switch
        {
            "staff-roster" => await RosterAsync(actorId, definition, query, cancellationToken),
            "audit-trail" => await AuditAsync(actorId, definition, query, cancellationToken),
            _ => TabularReportResult.Failed(TabularReportFailure.NotFound),
        };
    }

    private async Task<bool> AllowedAsync(Guid actorId, string permission, CancellationToken cancellationToken)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        return actor is not null && actor.HasPermission(permission) && actor.Memberships.Any(membership =>
            membership.Kind == MembershipKind.InternalStaff && membership.OrganizationType == OrganizationType.AviamOperator);
    }

    /// <summary>«Plantilla de personal»: every employee «Empleados» shows the account, read page by page.</summary>
    private async Task<TabularReportResult> RosterAsync(Guid actorId, TabularReportDefinition definition,
        TabularReportQuery query, CancellationToken cancellationToken)
    {
        bool? hasAccount = query.Text("account") switch { "with" => true, "without" => false, _ => null };
        var employees = new List<EmployeeSummaryData>();
        for (var page = 1; ; page++)
        {
            var result = await governance.ListEmployeesAsync(actorId, query.Text("department"), query.Text("status"), null,
                hasAccount, null, page, 100, cancellationToken);
            if (result is null) return TabularReportResult.Failed(TabularReportFailure.Forbidden);
            employees.AddRange(result.Employees);
            if (!result.HasMore || employees.Count >= MaxRows) break;
        }
        var station = query.Id("station");
        var selected = employees.Where(employee => station is null || employee.Stations.Any(item => item.Id == station))
            .OrderBy(employee => employee.LastName, StringComparer.CurrentCulture)
            .ThenBy(employee => employee.FirstName, StringComparer.CurrentCulture).ToArray();
        var rows = selected.Select(employee => (IReadOnlyList<ReportCell>)
        [
            ReportCell.Of(employee.EmployeeNumber), ReportCell.Of($"{employee.FirstName} {employee.LastName}"),
            ReportCell.Of(employee.Position.Name), ReportCell.Of(Department.LabelOf(employee.Department)),
            ReportCell.Of(string.Join(", ", employee.Stations.Select(item => item.Code))),
            ReportCell.Of(EmployeeStatus.LabelOf(employee.Status)), ReportCell.Date(employee.HireDate),
            ReportCell.Of(AccountLabel(employee.Account)), ReportCell.Of(employee.CorporateEmail),
        ]).ToArray();
        var stationName = station is { } stationId
            ? employees.SelectMany(employee => employee.Stations).FirstOrDefault(item => item.Id == stationId)?.Code
            : null;
        var active = selected.Count(employee => employee.Status == "Active");
        var withAccount = selected.Count(employee => employee.Account is not null);
        var ramp = selected.Count(employee => employee.Position.IsRampPosition);
        var today = BusinessCalendar.Today(timeProvider.GetUtcNow());
        var hired = selected.Count(employee => employee.HireDate.Year == today.Year && employee.HireDate.Month == today.Month);
        return TabularReportResult.Of(new ReportDocument(HumanResourcesReportCatalog.Area, definition.Title, definition.Columns, rows)
        {
            Description = definition.Description,
            To = today,
            AsOfDate = true,
            StationScope = "Todas las estaciones",
            Filters = TabularReports.Applied(definition, query, (filter, _) => filter.Kind == ReportFilterKind.Station ? stationName : null),
            Summary =
            [
                new ReportMetric("Empleados", ReportFormat.Integer(selected.Length), "en la plantilla filtrada"),
                new ReportMetric("Activos", ReportFormat.Integer(active), ReportFormat.OfTotal(active, selected.Length, "empleados")),
                new ReportMetric("Con cuenta de acceso", ReportFormat.Integer(withAccount),
                    ReportFormat.OfTotal(withAccount, selected.Length, "empleados")),
                new ReportMetric("Agentes de rampa", ReportFormat.Integer(ramp), ReportFormat.OfTotal(ramp, selected.Length, "empleados")),
                new ReportMetric("Ingresos este mes", ReportFormat.Integer(hired), $"de {ReportFormat.Integer(selected.Length)} empleados"),
            ],
            Notes = ["Estaciones vigentes de cada empleado. «Cuenta» es el estado de su acceso a ELEVANT."],
        });
    }

    private static string AccountLabel(EmployeeAccountRefData? account) => account?.Status switch
    {
        null => "Sin cuenta",
        "Active" => "Activa",
        "PendingActivation" => "Pendiente de activación",
        "InvitationSent" => "Invitación enviada",
        "Disabled" => "Desactivada",
        "Blocked" => "Bloqueada",
        var other => other,
    };

    /// <summary>«Trazabilidad y auditoría»: the trail «Trazabilidad / Auditoría» shows the account, every page of it.</summary>
    private async Task<TabularReportResult> AuditAsync(Guid actorId, TabularReportDefinition definition,
        TabularReportQuery query, CancellationToken cancellationToken)
    {
        var from = BusinessCalendar.StartOfDay(query.From!.Value);
        var to = BusinessCalendar.StartOfDay(query.To!.Value.AddDays(1));
        var action = query.Text("action");
        var entries = new List<ActivityEntryData>();
        string? cursor = null;
        do
        {
            var page = await governance.ListActivityAsync(actorId, query.Text("department"), from, to, query.Text("category"),
                null, cursor, 100, cancellationToken);
            if (page is null) return TabularReportResult.Failed(TabularReportFailure.Forbidden);
            entries.AddRange(action is null ? page.Entries : page.Entries.Where(entry => entry.Action == action));
            cursor = page.NextCursor;
        } while (cursor is not null && entries.Count < MaxRows + 1);
        var ordered = entries.OrderBy(entry => entry.OccurredAt).ToArray();
        var zone = BusinessCalendar.Zone();
        var rows = ordered.Select(entry => (IReadOnlyList<ReportCell>)
        [
            ReportCell.DateTime(TimeZoneInfo.ConvertTime(entry.OccurredAt, zone).DateTime),
            ReportCell.Of(entry.ActorName ?? "Sistema"), ReportCell.Of(AuditActionLabels.Label(entry.Action)),
            ReportCell.Of(AuditActionLabels.Target(entry.EntityType)),
            ReportCell.Of(entry.Department is { } department ? Department.LabelOf(department) : null),
            ReportCell.Of(entry.StationCode), ReportCell.Of(entry.Reason),
        ]).ToArray();
        var actorsCount = ordered.Select(entry => entry.ActorName ?? "Sistema").Distinct(StringComparer.Ordinal).Count();
        var logins = ordered.Count(entry => entry.Category == "login");
        var governanceCount = ordered.Count(entry => entry.Category == "governance");
        return TabularReportResult.Of(new ReportDocument(HumanResourcesReportCatalog.Area, definition.Title, definition.Columns, rows)
        {
            Description = definition.Description,
            From = query.From,
            To = query.To,
            StationScope = "Todas las estaciones",
            Filters = TabularReports.Applied(definition, query, (_, _) => null),
            Summary =
            [
                new ReportMetric("Movimientos", ReportFormat.Integer(ordered.Length), $"de {ReportFormat.Integer(actorsCount)} personas o procesos"),
                new ReportMetric("Inicios de sesión", ReportFormat.Integer(logins), ReportFormat.OfTotal(logins, ordered.Length, "movimientos")),
                new ReportMetric("Usuarios y accesos", ReportFormat.Integer(governanceCount),
                    ReportFormat.OfTotal(governanceCount, ordered.Length, "movimientos")),
            ],
            Notes = ["Lo que la cuenta puede ver en «Trazabilidad / Auditoría»; hora de Santo Domingo. El detalle es el motivo registrado."],
        });
    }
}
