namespace Elevant.Application.Abstractions.Finance;

/// <summary>Column of a finance report. Type is text, money, number, percent or date; money columns carry a currency column.</summary>
public sealed record FinanceReportColumn(string Key, string Label, string Type);

public sealed record FinanceReportMetric(string Label, string Value, string Type, string? CurrencyCode = null);

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
    IReadOnlyList<string> Notes);

public sealed record FinanceReportFilter(DateOnly From, DateOnly To, Guid? StationId, Guid? AirlineId, string? CurrencyCode);

public sealed record FinanceReportDefinition(string Key, string Title, string Description);

/// <summary>
/// The six reports of the simplified Finance (4-A, ADR-0035 block 3). The preinvoice, dispute and fiscal-simulation
/// reports left with their modules; «Ventas» is the sales book of the simulated e-CF (4-N20).
/// </summary>
public static class FinanceReports
{
    public static readonly IReadOnlyList<FinanceReportDefinition> All =
    [
        new("revenue", "Ingresos por período", "Facturado por mes, aerolínea y moneda, con servicios, cargos, ajustes e ITBIS; consolidado en USD con la tasa registrada."),
        new("receivables", "Cuentas por cobrar y antigüedad", "Saldo pendiente por aerolínea en tramos de vencimiento."),
        new("collections", "Cobranza", "Cobros por mes, aerolínea y método (transferencia, tarjeta y prepagos de charter, entre otros) frente a lo facturado."),
        new("payables", "Cuentas por pagar", "Facturas de proveedores aprobadas, aplicaciones y saldo a la fecha de corte."),
        new("charges", "Recargos", "Cargos, mínimos y excedentes facturados por tipo y concepto, con su neto, ITBIS y total."),
        new("sales", "Ventas (e-CF simulado)", "Facturas e-CF emitidas en el período por e-NCF, con subtotal, ITBIS y total."),
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
