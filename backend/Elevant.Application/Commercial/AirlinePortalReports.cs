using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Common;
using Elevant.Application.Documents;
using Elevant.Application.Finance;
using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Commercial;

/// <summary>The source of the airline portal's reports, for the API.</summary>
public interface IAirlinePortalReportSource : ITabularReportSource;

/// <summary>
/// The reports of the airline portal (ADR-0048, «Reportes nuevos»): operations and services, invoices and payments, and
/// the statement of account. They are always of the session's airline: the organization comes from the account's
/// current membership, the operations from the stations its contracts cover and the invoices from the portal's treasury
/// scope, so another airline's data never reaches them. A station outside that scope is 404
/// <c>station_unavailable</c>.
/// </summary>
public sealed class AirlinePortalReports(
    IActorContextResolver actors,
    IAirlinePortalReportStore store,
    IFinanceTreasuryStore treasury,
    TimeProvider timeProvider) : IAirlinePortalReportSource
{
    public const string Area = "Portal de aerolíneas";
    public const string Audience = "Documento para la aerolínea";

    public static readonly ReportFilterDefinition OperationStatus = new("status", "Estado", "status", ReportFilterKind.Select,
        Enum.GetValues<GroundOperationStatus>().Select(status =>
            new ReportFilterOption(status.ToString(), OperationLabels.Status(status))).ToArray());

    public static readonly ReportFilterDefinition InvoiceStatus = new("status", "Estado", "status", ReportFilterKind.Select,
        InvoiceStatusLabels.Options.Select(option => new ReportFilterOption(option.Code, option.Label)).ToArray());

    public static IReadOnlyList<TabularReportDefinition> All { get; } =
    [
        new("operations", "Operaciones y servicios",
            "Las operaciones de su aerolínea en el período, con sus vuelos, la estación, el estado y los servicios que AVIAM " +
            "ejecutó, con su cantidad y unidad, una vez aprobada la operación.",
            [new("Fecha", ReportColumnType.Date), ReportColumn.Text("Operación"), ReportColumn.Text("Vuelos"),
                ReportColumn.Text("Estación"), ReportColumn.Text("Estado"), ReportColumn.Text("Servicio"),
                ReportColumn.Text("Ejecución"), ReportColumn.Number("Cantidad"), ReportColumn.Text("Unidad")],
            ReportPeriod.Range,
            [ReportFilterDefinition.Station(), OperationStatus]),
        new("invoices", "Facturas y pagos",
            "Las facturas emitidas a su aerolínea en el período, con el e-NCF, la emisión, el vencimiento, el total, lo " +
            "pagado, el saldo y el estado de hoy.",
            [new("Emisión", ReportColumnType.Date), ReportColumn.Text("e-NCF"), ReportColumn.Text("Estación"),
                ReportColumn.Text("Moneda"), new("Vence", ReportColumnType.Date), ReportColumn.Text("Estado"),
                ReportColumn.Money("Total", currencyColumn: 3), ReportColumn.Money("Pagado", currencyColumn: 3),
                ReportColumn.Money("Notas", currencyColumn: 3), ReportColumn.Money("Saldo", currencyColumn: 3)],
            ReportPeriod.Range,
            [ReportFilterDefinition.Station(), InvoiceStatus]),
        new("statement", AccountStatementDocuments.Title,
            "Los movimientos de la cuenta de su aerolínea hasta la fecha de corte, con el saldo acumulado y la antigüedad " +
            "de los saldos.",
            AccountStatementDocuments.Columns, ReportPeriod.AsOf,
            [ReportFilterDefinition.Station()]),
    ];

    public IReadOnlyList<TabularReportDefinition> Catalog => All;

    /// <summary>The portal has no separate «Exportar»: whoever reads the reports of the airline may download them.</summary>
    public async Task<TabularReportFailure?> AuthorizeExportAsync(Guid actorId, CancellationToken cancellationToken = default) =>
        (await OrganizationAsync(actorId, cancellationToken)).Failure;

    public async Task<TabularReportResult> ReadAsync(Guid actorId, TabularReportDefinition definition,
        TabularReportQuery query, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(definition);
        ArgumentNullException.ThrowIfNull(query);
        var (organizationId, failure) = await OrganizationAsync(actorId, cancellationToken);
        if (failure is { } refused) return TabularReportResult.Failed(refused);
        var profile = await store.ProfileAsync(organizationId!.Value, cancellationToken);
        if (profile is null) return TabularReportResult.Failed(TabularReportFailure.NotFound);
        var station = query.Id("station") is { } stationId ? profile.Stations.FirstOrDefault(item => item.Id == stationId) : null;
        if (query.Id("station") is not null && station is null)
            return TabularReportResult.Failed(TabularReportFailure.StationUnavailable);
        var result = definition.Key switch
        {
            "operations" => await OperationsAsync(organizationId.Value, definition, query, profile, station, cancellationToken),
            "invoices" => await InvoicesAsync(actorId, definition, query, profile, station, cancellationToken),
            "statement" => await StatementAsync(actorId, query, profile, station, cancellationToken),
            _ => TabularReportResult.Failed(TabularReportFailure.NotFound),
        };
        return result.Document is { } document
            ? TabularReportResult.Of(document with { Audience = Audience })
            : result;
    }

    private async Task<(Guid? OrganizationId, TabularReportFailure? Failure)> OrganizationAsync(Guid actorId,
        CancellationToken cancellationToken)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        var (organizationId, failure) = AirlinePortalAccess.Resolve(actor, actorId);
        return failure is null ? (organizationId, null) : (null, TabularReportFailure.Forbidden);
    }

    private static string StationLabel(AirlinePortalReportStation station) =>
        string.IsNullOrWhiteSpace(station.Name) || station.Name == station.Code ? station.Code : $"{station.Code} · {station.Name}";

    private static IReadOnlyList<ReportFilter> Filters(TabularReportDefinition definition, TabularReportQuery query,
        AirlinePortalReportProfile profile) =>
        [new ReportFilter("Aerolínea", profile.AirlineName), .. TabularReports.Applied(definition, query, (_, _) => null)
            .Where(filter => filter.Label != "Estación")];

    /// <summary>«Operaciones y servicios»: one row per approved service, or one per operation still without approval.</summary>
    private async Task<TabularReportResult> OperationsAsync(Guid organizationId, TabularReportDefinition definition,
        TabularReportQuery query, AirlinePortalReportProfile profile, AirlinePortalReportStation? station,
        CancellationToken cancellationToken)
    {
        GroundOperationStatus? status = query.Text("status") is { } code ? Enum.Parse<GroundOperationStatus>(code) : null;
        var operations = await store.OperationsAsync(organizationId, query.From!.Value, query.To!.Value, station?.Id, status,
            cancellationToken);
        if (operations is null) return TabularReportResult.Failed(TabularReportFailure.NotFound);
        var rows = new List<IReadOnlyList<ReportCell>>();
        foreach (var operation in operations)
        {
            var flights = string.Join(" / ", new[] { operation.ArrivalFlight, operation.DepartureFlight }
                .Where(flight => !string.IsNullOrWhiteSpace(flight)));
            IReadOnlyList<ReportCell> Head() =>
            [
                ReportCell.Date(operation.OperationDate), ReportCell.Of(operation.OperationCode), ReportCell.Of(flights),
                ReportCell.Of(operation.StationCode), ReportCell.Of(OperationLabels.Status(operation.Status)),
            ];
            if (operation.Services.Count == 0)
            {
                rows.Add([.. Head(), ReportCell.Of(operation.Status == GroundOperationStatus.Approved
                    ? "Sin servicios registrados" : "Pendiente de aprobación de AVIAM"), ReportCell.Empty, ReportCell.Empty,
                    ReportCell.Empty]);
                continue;
            }
            foreach (var service in operation.Services)
                rows.Add([.. Head(), ReportCell.Of($"{service.Code} · {service.Name}"), ReportCell.Of(ServiceStatus(service.Status)),
                    ReportCell.Value(service.Quantity), ReportCell.Of(OperationLabels.BillingUnit(service.Unit))]);
        }
        var total = operations.Count;
        var approved = operations.Count(operation => operation.Status == GroundOperationStatus.Approved);
        var services = operations.Sum(operation => operation.Services.Count(service => service.Status == "Completed"));
        var cancelled = operations.Count(operation => operation.Status == GroundOperationStatus.Cancelled);
        return TabularReportResult.Of(new ReportDocument(Area, definition.Title, definition.Columns, rows)
        {
            Description = definition.Description,
            From = query.From,
            To = query.To,
            StationCode = station?.Code,
            StationName = station?.Name,
            StationScope = "Todas las estaciones de su contrato",
            Filters = Filters(definition, query, profile),
            Summary =
            [
                new ReportMetric("Operaciones", ReportFormat.Integer(total), "en el período"),
                new ReportMetric("Aprobadas por AVIAM", ReportFormat.Integer(approved), ReportFormat.OfTotal(approved, total, "operaciones")),
                new ReportMetric("Canceladas", ReportFormat.Integer(cancelled), ReportFormat.OfTotal(cancelled, total, "operaciones")),
                new ReportMetric("Servicios ejecutados", ReportFormat.Integer(services),
                    $"en {ReportFormat.Integer(approved)} operaciones aprobadas"),
            ],
            Notes =
            [
                "Los servicios, con su cantidad y unidad, son los que AVIAM aprobó en la revisión de la operación; antes de " +
                "aprobarse la operación no se muestran. Las cantidades no se suman porque sus unidades son distintas.",
            ],
        });
    }

    private static string ServiceStatus(string status) => status switch
    {
        "Completed" => "Ejecutado",
        "NotPerformed" => "No realizado",
        "Exception" => "Con excepción",
        "InProgress" => "En curso",
        "Planned" => "Planificado",
        _ => status,
    };

    /// <summary>«Facturas y pagos»: the airline's invoices issued in the period, read from its statement as of today.</summary>
    private async Task<TabularReportResult> InvoicesAsync(Guid actorId, TabularReportDefinition definition,
        TabularReportQuery query, AirlinePortalReportProfile profile, AirlinePortalReportStation? station,
        CancellationToken cancellationToken)
    {
        var today = BusinessCalendar.Today(timeProvider.GetUtcNow());
        var read = await treasury.PortalStatementAsync(actorId, today, station?.Id, cancellationToken);
        if (!read.IsSuccess) return TabularReportResult.Failed(Failure(read.Failure, station));
        var statement = read.Data!;
        var issued = statement.Movements.Where(movement => movement.Kind == "Invoice" && movement.InvoiceId is not null)
            .GroupBy(movement => movement.InvoiceId!.Value).ToDictionary(group => group.Key, group => group.First().EffectiveOn);
        var filter = query.Text("status");
        var invoices = statement.Invoices
            .Select(invoice => (Invoice: invoice, Issued: issued.TryGetValue(invoice.Id, out var day) ? day : (DateOnly?)null,
                Paid: invoice.LegacyPaid + invoice.Applied, Notes: invoice.LegacyCredited + invoice.Credited - invoice.Debited))
            .Select(item => (item.Invoice, item.Issued, item.Paid, item.Notes,
                Status: InvoiceStatusLabels.Code(item.Invoice.Balance, item.Paid, item.Notes, item.Invoice.DaysOverdue)))
            .Where(item => item.Issued is { } day && day >= query.From && day <= query.To)
            .Where(item => InvoiceStatusLabels.Matches(filter, item.Status))
            .OrderBy(item => item.Issued).ThenBy(item => item.Invoice.FiscalNumber ?? item.Invoice.Number, StringComparer.Ordinal)
            .ToArray();
        var rows = invoices.Select(item => (IReadOnlyList<ReportCell>)
        [
            ReportCell.Date(item.Issued), ReportCell.Of(item.Invoice.FiscalNumber ?? item.Invoice.Number),
            ReportCell.Of(item.Invoice.StationCode), ReportCell.Of(item.Invoice.CurrencyCode), ReportCell.Date(item.Invoice.DueDate),
            ReportCell.Of(InvoiceStatusLabels.Label(item.Status)), ReportCell.Value(item.Invoice.Total), ReportCell.Value(item.Paid),
            ReportCell.Value(item.Notes), ReportCell.Value(item.Invoice.Balance),
        ]).ToArray();
        var summary = new List<ReportMetric>
        {
            new("Facturas", ReportFormat.Integer(invoices.Length), "emitidas en el período"),
            new("Pagadas", ReportFormat.Integer(invoices.Count(item => item.Status == InvoiceStatusLabels.Paid)),
                ReportFormat.OfTotal(invoices.Count(item => item.Status == InvoiceStatusLabels.Paid), invoices.Length, "facturas")),
            new("Vencidas", ReportFormat.Integer(invoices.Count(item => item.Status == InvoiceStatusLabels.Overdue)),
                ReportFormat.OfTotal(invoices.Count(item => item.Status == InvoiceStatusLabels.Overdue), invoices.Length, "facturas")),
        };
        foreach (var group in invoices.GroupBy(item => item.Invoice.CurrencyCode).OrderBy(group => group.Key, StringComparer.Ordinal))
        {
            var billed = group.Sum(item => item.Invoice.Total);
            summary.Add(new ReportMetric($"Pagado {group.Key}", ReportFormat.Money(group.Sum(item => item.Paid), group.Key),
                ReportFormat.Share(group.Sum(item => item.Paid), billed) is { } share ? $"{share} de {ReportFormat.Money(billed, group.Key)} facturado" : null));
            summary.Add(new ReportMetric($"Saldo {group.Key}", ReportFormat.Money(group.Sum(item => item.Invoice.Balance), group.Key),
                $"en {group.Count(item => item.Invoice.Balance > 0m)} facturas con saldo"));
        }
        return TabularReportResult.Of(new ReportDocument(Area, definition.Title, definition.Columns, rows)
        {
            Description = definition.Description,
            From = query.From,
            To = query.To,
            StationCode = station?.Code,
            StationName = station?.Name,
            StationScope = "Todas las estaciones de su contrato",
            Filters = Filters(definition, query, profile),
            Summary = summary,
            Notes =
            [
                $"Pagado, notas y saldo al {ReportFormat.Date(today)}. «Notas» son las notas de crédito menos las de débito.",
            ],
            Notice = FinanceInvoicePolicy.Disclaimer,
        });
    }

    /// <summary>«Estado de cuenta»: the same document Finance prints, of the session's airline only.</summary>
    private async Task<TabularReportResult> StatementAsync(Guid actorId, TabularReportQuery query,
        AirlinePortalReportProfile profile, AirlinePortalReportStation? station, CancellationToken cancellationToken)
    {
        var read = await treasury.PortalStatementAsync(actorId, query.To!.Value, station?.Id, cancellationToken);
        if (!read.IsSuccess) return TabularReportResult.Failed(Failure(read.Failure, station));
        var statement = read.Data!;
        var document = AccountStatementDocuments.ToDocument(new AccountStatementInput(profile.AirlineName,
            station is null ? "Todas las estaciones de su contrato" : StationLabel(station), statement.AsOf,
            statement.Invoices.Select(invoice => new AccountStatementInvoice(invoice.Id, invoice.Number, invoice.FiscalNumber,
                invoice.CurrencyCode, invoice.Total, invoice.Balance, invoice.DueDate)).ToArray(),
            statement.Movements.Select(movement => new AccountStatementMovement(movement.Kind, movement.InvoiceId,
                movement.CurrencyCode, movement.Amount, movement.EffectiveOn, movement.Reference)).ToArray(),
            statement.Aging.Select(aging => new FinanceTreasuryAgingData(aging.CurrencyCode, aging.Balance, aging.Current,
                aging.Days1To30, aging.Days31To60, aging.Days61To90, aging.Days91Plus, aging.Unallocated,
                aging.CreditBalance)).ToArray()));
        return TabularReportResult.Of(document);
    }

    private static TabularReportFailure Failure(FinanceTreasuryFailure? failure, AirlinePortalReportStation? station) =>
        failure switch
        {
            FinanceTreasuryFailure.Forbidden => TabularReportFailure.Forbidden,
            FinanceTreasuryFailure.Invalid => TabularReportFailure.InvalidQuery,
            _ => station is null ? TabularReportFailure.NotFound : TabularReportFailure.StationUnavailable,
        };
}
