using Elevant.Application.Common;
using System.Globalization;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

internal sealed partial class EfFinanceReportStore
{
    /// <summary>4-N10: exclusive end of a business day: the first instant of the next one in Santo Domingo.</summary>
    private static DateTimeOffset EndOf(DateOnly day) => BusinessCalendar.StartOfDay(day.AddDays(1));
    private static string DateText(DateOnly day) => day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    private static string LineKind(PreinvoiceLineKind kind) => kind switch
    {
        PreinvoiceLineKind.Package => "Paquete", PreinvoiceLineKind.Excess => "Excedente",
        PreinvoiceLineKind.Minimum => "Mínimo", PreinvoiceLineKind.Adjustment => "Ajuste",
        PreinvoiceLineKind.Charge => "Cargo", _ => "Servicio",
    };

    /// <summary>Cash that came in (or went out) on a business day, with how it was collected.</summary>
    private sealed record CashRow(DateOnly Date, string Airline, string Currency, PaymentMethod Method, string Kind,
        string Reference, decimal Cash);

    /// <summary>
    /// Cash is recorded once at receipt: legacy payments and receipts (transfers, cards, charter prepayments…) minus
    /// receipt reversals and refunds. Applications to invoices move no cash.
    /// </summary>
    private async Task<CashRow[]> CashRowsAsync(Scope scope, CancellationToken ct)
    {
        var end = EndOf(scope.Filter.To);
        var invoices = (await InvoicesAsync(scope with { Filter = scope.Filter with { CurrencyCode = null } }, false, ct))
            .Where(i => i.IssuedAt < end).ToDictionary(i => i.Id);
        var invoiceIds = invoices.Keys.ToArray();
        var legacy = await context.NonFiscalPayments.AsNoTracking().Where(p => invoiceIds.Contains(p.InvoiceId) && p.CreatedAt < end &&
            (scope.Filter.CurrencyCode == null || p.CurrencyCode == scope.Filter.CurrencyCode)).ToArrayAsync(ct);
        var receipts = await (from r in context.Set<FinanceTreasuryReceipt>().AsNoTracking()
            join airline in context.Airlines.AsNoTracking() on r.AirlineId equals airline.Id
            where scope.StationIds.Contains(r.StationId) && r.CreatedAt < end && r.ReceivedOn <= scope.Filter.To &&
                (scope.AirlineId == null || r.AirlineId == scope.AirlineId) &&
                (scope.Filter.CurrencyCode == null || r.CurrencyCode == scope.Filter.CurrencyCode)
            select new { Receipt = r, Airline = airline.Name }).ToArrayAsync(ct);
        var receiptIds = receipts.Select(r => r.Receipt.Id).ToArray();
        var byReceipt = receipts.ToDictionary(r => r.Receipt.Id);
        var moves = await context.Set<FinanceTreasuryMovement>().AsNoTracking().Where(m => receiptIds.Contains(m.ReceiptId) &&
            (m.Kind == FinanceTreasuryMovementKind.ReceiptReversal || m.Kind == FinanceTreasuryMovementKind.Refund) &&
            m.EffectiveOn >= scope.Filter.From && m.EffectiveOn <= scope.Filter.To && m.CreatedAt < end &&
            (m.InvoiceId == null || invoiceIds.Contains(m.InvoiceId.Value))).ToArrayAsync(ct);
        var result = legacy.Select(p => new CashRow(p.PaidOn ?? DateOf(p.CreatedAt), invoices[p.InvoiceId].Airline,
                p.CurrencyCode, p.Method, "Pago heredado", p.Reference, p.Amount))
            .Where(p => p.Date >= scope.Filter.From && p.Date <= scope.Filter.To).ToList();
        result.AddRange(receipts.Where(r => r.Receipt.ReceivedOn >= scope.Filter.From)
            .Select(r => new CashRow(r.Receipt.ReceivedOn, r.Airline, r.Receipt.CurrencyCode, r.Receipt.Method,
                "Recibo", r.Receipt.Reference, r.Receipt.Amount)));
        result.AddRange(moves.Select(m => new CashRow(m.EffectiveOn, byReceipt[m.ReceiptId].Airline, m.ReceiptCurrency,
            byReceipt[m.ReceiptId].Receipt.Method,
            m.Kind == FinanceTreasuryMovementKind.ReceiptReversal ? "Reverso de recibo" : "Devolución", m.Reference,
            -m.ReceiptAmount)));
        return result.OrderBy(r => r.Date).ThenBy(r => r.Reference, StringComparer.Ordinal).ToArray();
    }

    /// <summary>
    /// «Cobranza» (4-N19, 4-N20): cash by month, airline and method in Spanish against what was invoiced, with what the
    /// airlines paid by card on the portal apart.
    /// </summary>
    private async Task<(IReadOnlyList<FinanceReportMetric>, IReadOnlyList<FinanceReportColumn>, IReadOnlyList<IReadOnlyList<string?>>, IReadOnlyList<string>)>
        TreasuryCollectionsAsync(Scope scope, CancellationToken ct)
    {
        var cash = await CashRowsAsync(scope, ct);
        var billed = await InvoicesAsync(scope, true, ct);
        var rows = cash.Where(r => r.Cash != 0m).GroupBy(r => (Month: Month(r.Date), r.Airline, r.Currency, r.Method, r.Kind))
            .OrderBy(g => g.Key.Month).ThenBy(g => g.Key.Airline).Select(g => (IReadOnlyList<string?>)
                [g.Key.Month, g.Key.Airline, g.Key.Currency, FinanceLabels.PaymentMethod(g.Key.Method), Number(g.Count()),
                    Money(g.Sum(r => r.Cash)), g.Key.Kind]).ToArray();
        var summary = billed.Select(i => i.CurrencyCode).Concat(cash.Select(r => r.Currency)).Distinct().Order().SelectMany(currency =>
        {
            var invoiced = billed.Where(i => i.CurrencyCode == currency).Sum(i => i.Total);
            var collected = cash.Where(r => r.Currency == currency).Sum(r => r.Cash);
            var byCard = cash.Where(r => r.Currency == currency && r.Method == PaymentMethod.Card).Sum(r => r.Cash);
            return new[] { new FinanceReportMetric($"Facturado {currency}", Money(invoiced), "money", currency),
                new FinanceReportMetric($"Cobrado {currency}", Money(collected), "money", currency),
                new FinanceReportMetric($"Cobrado con tarjeta {currency}", Money(byCard), "money", currency),
                new FinanceReportMetric($"Cobro sobre facturado {currency}", invoiced == 0 ? "0" : Number(collected / invoiced * 100m), "percent") };
        }).ToArray();
        return (summary, [Col("month", "Mes"), Col("airline", "Aerolínea"), Col("currency", "Moneda"), Col("method", "Método"),
            Col("payments", "Movimientos", "number"), Col("amount", "Efectivo neto", "money"), Col("kind", "Origen")], rows,
            ["Efectivo = pagos heredados + recibos (transferencias, tarjeta y prepagos de charter) − reversos de recibo − devoluciones. Las aplicaciones no vuelven a contar como cobros. No constituye confirmación bancaria."]);
    }
}
