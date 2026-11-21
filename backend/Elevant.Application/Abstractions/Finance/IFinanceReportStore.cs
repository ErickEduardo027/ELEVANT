using Elevant.Application.Finance;

namespace Elevant.Application.Abstractions.Finance;

/// <summary>Column of a finance report. Type is text, money, number, percent or date; money columns carry a currency column.</summary>
public sealed record FinanceReportColumn(string Key, string Label, string Type);

/// <summary>
/// A summary figure. <see cref="Context"/> is what makes it readable (G3, no «números fríos»): «de USD 12,000.00
/// facturado», «8 de 50 facturas».
/// </summary>
public sealed record FinanceReportMetric(string Label, string Value, string Type, string? CurrencyCode = null,
    string? Context = null);

/// <summary>A filter of the report with its readable value: «Estación» «PUJ · Punta Cana», «Aerolínea» «Arajet».</summary>
public sealed record FinanceReportAppliedFilter(string Label, string Value);

/// <summary>
/// A finance report as a table: cells are invariant strings (numbers with a dot,
/// dates as yyyy-MM-dd) so the web, CSV and PDF format them the same way.
/// </summary>
public sealed record FinanceReportData(
    string Key,
    string Title,
    string Description,
    DateOnly From,
    DateOnly To,
    string? ConsolidationCurrency,
    IReadOnlyList<FinanceReportMetric> Summary,
    IReadOnlyList<FinanceReportColumn> Columns,
    IReadOnlyList<IReadOnlyList<string?>> Rows,
    IReadOnlyList<string> Notes)
{
    /// <summary>The filters that produced the report, by name (ADR-0048).</summary>
    public IReadOnlyList<FinanceReportAppliedFilter> Filters { get; init; } = [];
}

public sealed record FinanceReportFilter(DateOnly From, DateOnly To, Guid? StationId, Guid? AirlineId, string? CurrencyCode)
{
    /// <summary>
    /// «Facturas emitidas» only: <c>pending</c>, <c>overdue</c>, <c>paid</c>, <c>voided</c> or <c>open</c>
    /// (<see cref="InvoiceStatusLabels"/>), at the cut-off <see cref="To"/>.
    /// </summary>
    public string? Status { get; init; }
}

/// <summary>An option of a report filter: its code and its Spanish label.</summary>
public sealed record FinanceReportFilterOption(string Code, string Label);

/// <summary>A finance report; <see cref="AsOfDate"/> marks a cut-off report (only <c>to</c> matters, the screen hides «Desde»).</summary>
public sealed record FinanceReportDefinition(string Key, string Title, string Description)
{
    public bool AsOfDate { get; init; }

    /// <summary>The options of the <c>status</c> filter, for the reports that accept it («Facturas emitidas»).</summary>
    public IReadOnlyList<FinanceReportFilterOption> Statuses { get; init; } = [];
}

/// <summary>
/// The reports of the simplified Finance (4-A, ADR-0035 block 3). The preinvoice, dispute and fiscal-simulation
/// reports left with their modules; «Ventas» is the sales book of the simulated e-CF (4-N20). «Facturas emitidas» and
/// «Cobros» list each invoice and each receipt (ADR-0048, «Reportes nuevos»).
/// </summary>
public static class FinanceReports
{
    public static readonly IReadOnlyList<FinanceReportDefinition> All =
    [
        new("revenue", "Ingresos por período", "Facturado por mes, aerolínea y moneda, con servicios, cargos, ajustes e ITBIS; consolidado en USD con la tasa registrada."),
        new("receivables", "Cuentas por cobrar y antigüedad", "Saldo pendiente por aerolínea en tramos de vencimiento.") { AsOfDate = true },
        new("collections", "Cobranza", "Cobros por mes, aerolínea y método (transferencia, tarjeta y prepagos de charter, entre otros) frente a lo facturado."),
        new("payables", "Cuentas por pagar", "Facturas de proveedores aprobadas, aplicaciones y saldo a la fecha de corte.") { AsOfDate = true },
        new("charges", "Recargos", "Cargos, mínimos y excedentes facturados por tipo y concepto, con su neto, ITBIS y total."),
        new("sales", "Ventas (e-CF simulado)", "Facturas e-CF emitidas en el período por e-NCF, con subtotal, ITBIS y total."),
        new("invoices", "Facturas emitidas", "Cada factura emitida en el período con su e-NCF, número interno, vencimiento, estado, subtotal, ITBIS, total, pagado y saldo a la fecha de corte.")
        {
            Statuses = InvoiceStatusLabels.Options.Select(option => new FinanceReportFilterOption(option.Code, option.Label)).ToArray(),
        },
        new("receipts", "Cobros", "Cada cobro recibido en el período: fecha, aerolínea, método, referencia, lo recibido, lo aplicado a facturas y el remanente sin aplicar."),
    ];
}

/// <summary>Server-side finance reports over the actor's stations. Null when the actor may not read them.</summary>
public interface IFinanceReportStore
{
    Task<FinanceReportData?> GetAsync(Guid actorId, string reportKey, FinanceReportFilter filter,
        CancellationToken cancellationToken = default);
}

/// <summary>Records who exported which finance report with which filters.</summary>
public interface IFinanceReportExportAudit
{
    Task RecordAsync(Guid actorId, string reportKey, string format, FinanceReportFilter filter,
        CancellationToken cancellationToken = default);
}
