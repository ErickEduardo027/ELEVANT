using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Documents;

namespace Elevant.Application.Finance;

/// <summary>An invoice of a statement at its cut-off.</summary>
public sealed record AccountStatementInvoice(Guid Id, string Number, string? FiscalNumber, string CurrencyCode,
    decimal Total, decimal Balance, DateOnly? DueDate);

/// <summary>A movement of a statement (the kinds of <c>GET finance/statements</c>), in its currency.</summary>
public sealed record AccountStatementMovement(string Kind, Guid? InvoiceId, string CurrencyCode, decimal Amount,
    DateOnly EffectiveOn, string Reference);

/// <summary>What a statement of account prints: whose, where, at which cut-off, its invoices, movements and aging.</summary>
public sealed record AccountStatementInput(string AirlineName, string? StationLabel, DateOnly AsOf,
    IReadOnlyList<AccountStatementInvoice> Invoices, IReadOnlyList<AccountStatementMovement> Movements,
    IReadOnlyList<FinanceTreasuryAgingData> Aging);

/// <summary>
/// The statement of account of an airline at a cut-off as a document of the common engine (ADR-0048, «Reportes
/// nuevos»): every movement in date order with its charge or credit and the running balance of its currency, and the
/// aging of the balances as the summary. Finance (<c>GET finance/statements/export</c>) and the airline portal
/// («Estado de cuenta» of <c>airline/portal/reports</c>) print the same document.
/// </summary>
/// <remarks>
/// Hook for the printable document of PR E (<c>FinancialDocumentPdfRenderer</c>): when it gains a statement layout, the
/// PDF can be rendered from this same <see cref="AccountStatementInput"/>; the Excel stays on the engine.
/// </remarks>
public static class AccountStatementDocuments
{
    public const string Title = "Estado de cuenta";

    /// <summary>The columns: date, movement, document, invoice, due date, currency, charge, credit and balance.</summary>
    public static IReadOnlyList<ReportColumn> Columns { get; } =
    [
        new("Fecha", ReportColumnType.Date), ReportColumn.Text("Movimiento"), ReportColumn.Text("Documento"),
        ReportColumn.Text("Factura"), new("Vence", ReportColumnType.Date), ReportColumn.Text("Moneda"),
        ReportColumn.Money("Cargo", currencyColumn: 5), ReportColumn.Money("Abono", currencyColumn: 5),
        new("Saldo", ReportColumnType.Money) { CurrencyColumn = 5 },
    ];

    /// <summary>
    /// What a movement does to the account: an invoice, a debit note, a refund and a receipt reversal charge it; a
    /// receipt, a payment and a credit note credit it. Applying a receipt to an invoice moves nothing: the receipt
    /// already credited the account.
    /// </summary>
    public static (string Label, int Sign) Kind(string kind) => kind switch
    {
        "Invoice" => ("Factura", 1),
        "Debit" => ("Nota de débito", 1),
        "Credit" => ("Nota de crédito", -1),
        "LegacyPayment" => ("Pago", -1),
        "LegacyCredit" => ("Nota de crédito anterior", -1),
        "Receipt" => ("Cobro recibido", -1),
        "Refund" => ("Devolución", 1),
        "ReceiptReversal" => ("Reverso de cobro", 1),
        "Application" => ("Aplicación a factura", 0),
        "ApplicationReversal" => ("Reverso de aplicación", 0),
        _ => (kind, 0),
    };

    public static ReportDocument ToDocument(AccountStatementInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        var invoices = input.Invoices.ToDictionary(invoice => invoice.Id);
        var balances = new Dictionary<string, decimal>(StringComparer.Ordinal);
        var rows = new List<IReadOnlyList<ReportCell>>();
        foreach (var movement in input.Movements.OrderBy(item => item.EffectiveOn))
        {
            var (label, sign) = Kind(movement.Kind);
            var invoice = movement.InvoiceId is { } id ? invoices.GetValueOrDefault(id) : null;
            var balance = balances.GetValueOrDefault(movement.CurrencyCode) + sign * movement.Amount;
            balances[movement.CurrencyCode] = balance;
            rows.Add(
            [
                ReportCell.Date(movement.EffectiveOn), ReportCell.Of(label), ReportCell.Of(movement.Reference),
                ReportCell.Of(invoice is null ? null : invoice.FiscalNumber ?? invoice.Number),
                movement.Kind == "Invoice" ? ReportCell.Date(invoice?.DueDate) : ReportCell.Empty,
                ReportCell.Of(movement.CurrencyCode),
                sign > 0 ? ReportCell.Value(movement.Amount) : ReportCell.Empty,
                sign < 0 ? ReportCell.Value(movement.Amount) : ReportCell.Empty,
                ReportCell.Value(balance),
            ]);
        }
        var summary = new List<ReportMetric>();
        var open = input.Invoices.Count(invoice => invoice.Balance > 0m);
        summary.Add(new ReportMetric("Facturas con saldo", ReportFormat.Integer(open),
            ReportFormat.OfTotal(open, input.Invoices.Count, "facturas emitidas")));
        foreach (var aging in input.Aging.OrderBy(item => item.CurrencyCode, StringComparer.Ordinal))
        {
            var currency = aging.CurrencyCode;
            var overdue = aging.Days1To30 + aging.Days31To60 + aging.Days61To90 + aging.Days91Plus;
            var owed = aging.Current + overdue;
            summary.Add(new ReportMetric($"Saldo de facturas {currency}", ReportFormat.Money(aging.Balance, currency),
                $"en {input.Invoices.Count(invoice => invoice.CurrencyCode == currency && invoice.Balance > 0m)} facturas con saldo"));
            summary.Add(new ReportMetric($"Vencido {currency}", ReportFormat.Money(overdue, currency), Of(overdue, owed)));
            summary.Add(new ReportMetric($"Por vencer {currency}", ReportFormat.Money(aging.Current, currency), Of(aging.Current, owed)));
            summary.Add(new ReportMetric($"1-30 días {currency}", ReportFormat.Money(aging.Days1To30, currency), Of(aging.Days1To30, owed)));
            summary.Add(new ReportMetric($"31-60 días {currency}", ReportFormat.Money(aging.Days31To60, currency), Of(aging.Days31To60, owed)));
            summary.Add(new ReportMetric($"61-90 días {currency}", ReportFormat.Money(aging.Days61To90, currency), Of(aging.Days61To90, owed)));
            summary.Add(new ReportMetric($"Más de 90 días {currency}", ReportFormat.Money(aging.Days91Plus, currency), Of(aging.Days91Plus, owed)));
            summary.Add(new ReportMetric($"Cobros sin aplicar {currency}", ReportFormat.Money(aging.Unallocated, currency),
                "a favor de la aerolínea"));
            summary.Add(new ReportMetric($"Saldo de la cuenta {currency}",
                ReportFormat.Money(aging.Balance - aging.Unallocated, currency), "facturas con saldo menos cobros sin aplicar"));
        }
        return new ReportDocument(FinanceReportDocuments.Area, Title, Columns, rows)
        {
            Description = $"Movimientos de la cuenta de {input.AirlineName} hasta el {ReportFormat.Date(input.AsOf)}, con el " +
                "saldo acumulado de cada moneda y la antigüedad de los saldos.",
            To = input.AsOf,
            AsOfDate = true,
            StationScope = input.StationLabel ?? "Todas las estaciones autorizadas",
            Filters = [new ReportFilter("Aerolínea", input.AirlineName)],
            Summary = summary,
            Notes =
            [
                "Saldo acumulado por moneda: las facturas, notas de débito, devoluciones y reversos de cobro lo aumentan; " +
                "los cobros, pagos y notas de crédito lo reducen. Aplicar un cobro a una factura no cambia el saldo de la " +
                "cuenta: el cobro ya se abonó al recibirse.",
                "Antigüedad por fecha de vencimiento de cada factura con saldo, a la fecha de corte.",
            ],
            Notice = FinanceInvoicePolicy.Disclaimer,
        };
    }

    private static string? Of(decimal part, decimal whole) =>
        ReportFormat.Share(part, whole) is { } share ? $"{share} del saldo por cobrar" : null;
}
