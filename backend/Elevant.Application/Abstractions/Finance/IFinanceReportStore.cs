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

public static class FinanceReports
{
    public static readonly IReadOnlyList<FinanceReportDefinition> All =
    [
        new("revenue", "Ingresos por período", "Facturado por mes, aerolínea y moneda, con servicios, cargos y ajustes; consolidado en USD con la tasa registrada."),
        new("receivables", "Cuentas por cobrar y antigüedad", "Saldo pendiente por aerolínea en tramos de vencimiento."),
        new("collections", "Cobranza", "Pagos registrados por mes, aerolínea y método frente a lo facturado."),
        new("pipeline", "Pipeline de facturación", "Servicios aprobados sin prefacturar y prefacturas por estado, con importes."),
        new("charges", "Cargos y ajustes", "Cargos aplicados por tipo, valor calculado frente a facturado y ajustes manuales con su motivo."),
        new("disputes", "Disputas", "Disputas por aerolínea, importe disputado y resolución."),
        new("tariffs", "Uso de tarifas", "Servicios facturados frente a la tarifa base: precio medio, desviación y volumen."),
        new("credit-notes", "Notas de crédito", "Notas de crédito emitidas en el período con su motivo."),
        new("debit-notes", "Notas de débito", "Ajustes comerciales por factura y líneas de origen, sin crear cobros."),
        new("treasury", "Movimientos de tesorería", "Recibos, aplicaciones, reversos y devoluciones; efectivo separado de aplicación a facturas."),
        new("payables", "Cuentas por pagar", "Facturas de proveedores aprobadas, aplicaciones y saldo a la fecha de corte."),
        new("suppliers", "Estado de proveedores", "Obligaciones aprobadas y pagos sin aplicar por proveedor y moneda a la fecha de corte."),
        new("expenses", "Gastos de empleados", "Solicitudes, aprobación por etapa y reembolsos con sus dimensiones operativas."),
        new("packages", "Paquetes facturados", "Paquetes y excedentes según las líneas inmutables de las facturas."),
        new("fiscal", "Estado fiscal", "Estado documental fiscal separado de la factura comercial; excluye simulaciones locales."),
        new("fiscal-simulation", "Simulación fiscal", "Documentos de simulación local, sin validez fiscal y separados de los totales comerciales."),
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
