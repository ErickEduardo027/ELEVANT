using Elevant.Application.Common;
using System.Globalization;
using Elevant.Application.Abstractions.Finance;
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

    private sealed record CashRow(DateOnly Date, string Airline, string Currency, string Method, string Kind,
        string Reference, string? Invoice, string? InvoiceCurrency, decimal Cash, decimal Applied);

    /// <summary>Cash is recorded once at receipt; allocations and their reversals affect only the invoice currency.</summary>
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
            m.EffectiveOn >= scope.Filter.From && m.EffectiveOn <= scope.Filter.To && m.CreatedAt < end &&
            (m.InvoiceId == null || invoiceIds.Contains(m.InvoiceId.Value))).ToArrayAsync(ct);
        var result = legacy.Select(p => new CashRow(p.PaidOn ?? DateOf(p.CreatedAt), invoices[p.InvoiceId].Airline,
                p.CurrencyCode, p.Method.ToString(), "Pago heredado", p.Reference, invoices[p.InvoiceId].Number,
                invoices[p.InvoiceId].CurrencyCode, p.Amount, p.Amount))
            .Where(p => p.Date >= scope.Filter.From && p.Date <= scope.Filter.To).ToList();
        result.AddRange(receipts.Where(r => r.Receipt.ReceivedOn >= scope.Filter.From)
            .Select(r => new CashRow(r.Receipt.ReceivedOn, r.Airline, r.Receipt.CurrencyCode, r.Receipt.Method.ToString(),
                "Recibo", r.Receipt.Reference, null, null, r.Receipt.Amount, 0m)));
        foreach (var m in moves)
        {
            var r = byReceipt[m.ReceiptId];
            var invoice = m.InvoiceId is { } id ? invoices[id] : null;
            result.Add(new(m.EffectiveOn, r.Airline, m.ReceiptCurrency, r.Receipt.Method.ToString(), m.Kind switch
            {
                FinanceTreasuryMovementKind.Application => "Aplicación", FinanceTreasuryMovementKind.ApplicationReversal => "Reverso de aplicación",
                FinanceTreasuryMovementKind.ReceiptReversal => "Reverso de recibo", _ => "Devolución",
            }, m.Reference, invoice?.Number, m.InvoiceCurrency,
                m.Kind is FinanceTreasuryMovementKind.ReceiptReversal or FinanceTreasuryMovementKind.Refund ? -m.ReceiptAmount : 0m,
                m.Kind == FinanceTreasuryMovementKind.Application ? m.InvoiceAmount :
                m.Kind == FinanceTreasuryMovementKind.ApplicationReversal ? -m.InvoiceAmount : 0m));
        }
        return result.OrderBy(r => r.Date).ThenBy(r => r.Reference, StringComparer.Ordinal).ToArray();
    }

    private async Task<(IReadOnlyList<FinanceReportMetric>, IReadOnlyList<FinanceReportColumn>, IReadOnlyList<IReadOnlyList<string?>>, IReadOnlyList<string>)>
        TreasuryCollectionsAsync(Scope scope, CancellationToken ct)
    {
        var cash = await CashRowsAsync(scope, ct);
        var billed = await InvoicesAsync(scope, true, ct);
        var rows = cash.Where(r => r.Cash != 0m).GroupBy(r => (Month: Month(r.Date), r.Airline, r.Currency, r.Method, r.Kind))
            .OrderBy(g => g.Key.Month).ThenBy(g => g.Key.Airline).Select(g => (IReadOnlyList<string?>)
                [g.Key.Month, g.Key.Airline, g.Key.Currency, g.Key.Method, Number(g.Count()), Money(g.Sum(r => r.Cash)), g.Key.Kind]).ToArray();
        var summary = billed.Select(i => i.CurrencyCode).Concat(cash.Select(r => r.Currency)).Distinct().Order().SelectMany(currency =>
        {
            var invoiced = billed.Where(i => i.CurrencyCode == currency).Sum(i => i.Total);
            var collected = cash.Where(r => r.Currency == currency).Sum(r => r.Cash);
            return new[] { new FinanceReportMetric($"Facturado {currency}", Money(invoiced), "money", currency),
                new FinanceReportMetric($"Cobrado {currency}", Money(collected), "money", currency),
                new FinanceReportMetric($"Cobro sobre facturado {currency}", invoiced == 0 ? "0" : Number(collected / invoiced * 100m), "percent") };
        }).ToArray();
        return (summary, [Col("month", "Mes"), Col("airline", "Aerolínea"), Col("currency", "Moneda"), Col("method", "Método"),
            Col("payments", "Movimientos", "number"), Col("amount", "Efectivo neto", "money"), Col("kind", "Origen")], rows,
            ["Efectivo = pagos heredados + recibos − reversos de recibo − devoluciones. Las aplicaciones no vuelven a contar como cobros. No constituye confirmación bancaria."]);
    }

    private async Task<(IReadOnlyList<FinanceReportMetric>, IReadOnlyList<FinanceReportColumn>, IReadOnlyList<IReadOnlyList<string?>>, IReadOnlyList<string>)>
        TreasuryReportAsync(Scope scope, CancellationToken ct)
    {
        var cash = await CashRowsAsync(scope, ct);
        var summary = cash.GroupBy(r => r.Currency).Select(g => new FinanceReportMetric($"Efectivo neto {g.Key}", Money(g.Sum(r => r.Cash)), "money", g.Key))
            .Concat(cash.Where(r => r.InvoiceCurrency != null).GroupBy(r => r.InvoiceCurrency!).Select(g =>
                new FinanceReportMetric($"Aplicado neto {g.Key}", Money(g.Sum(r => r.Applied)), "money", g.Key))).ToArray();
        return (summary, [Col("date", "Fecha", "date"), Col("airline", "Aerolínea"), Col("kind", "Movimiento"), Col("reference", "Referencia"),
            Col("currency", "Moneda recibo"), Col("cash", "Efectivo", "money"), Col("invoice", "Factura"),
            Col("invoiceCurrency", "Moneda factura"), Col("invoiceAmount", "Aplicado neto", "money")],
            cash.Select(r => (IReadOnlyList<string?>)[DateText(r.Date), r.Airline, r.Kind, r.Reference, r.Currency, Money(r.Cash),
                r.Invoice, r.InvoiceCurrency, r.InvoiceCurrency is null ? null : Money(r.Applied)]).ToArray(),
            ["La aplicación usa el importe congelado en moneda de factura; el efectivo usa moneda del recibo. Un reverso de aplicación repone saldo de factura, sin crear efectivo. Las notas comerciales se muestran en sus reportes."]);
    }

    private async Task<(IReadOnlyList<FinanceReportMetric>, IReadOnlyList<FinanceReportColumn>, IReadOnlyList<IReadOnlyList<string?>>, IReadOnlyList<string>)>
        AdjustmentNotesAsync(Scope scope, bool debit, CancellationToken ct)
    {
        var end = EndOf(scope.Filter.To);
        var invoices = (await InvoicesAsync(scope, false, ct)).Where(i => i.IssuedAt < end).ToDictionary(i => i.Id);
        var ids = invoices.Keys.ToArray();
        var kind = debit ? FinanceTreasuryAdjustmentKind.Debit : FinanceTreasuryAdjustmentKind.Credit;
        var notes = await context.Set<FinanceTreasuryAdjustmentNote>().AsNoTracking().Where(n => ids.Contains(n.InvoiceId) && n.Kind == kind &&
            n.EffectiveOn >= scope.Filter.From && n.EffectiveOn <= scope.Filter.To && n.CreatedAt < end).OrderBy(n => n.EffectiveOn).ThenBy(n => n.Id).ToArrayAsync(ct);
        var noteIds = notes.Select(n => n.Id).ToArray();
        var lines = await (from link in context.Set<FinanceTreasuryAdjustmentLine>().AsNoTracking()
            join line in context.NonFiscalInvoiceLines.AsNoTracking() on link.InvoiceLineId equals line.Id
            where noteIds.Contains(link.NoteId) select new { link.NoteId, line.LineNumber, link.Amount, link.Quantity }).ToArrayAsync(ct);
        var amounts = new List<(string Currency, decimal Amount)>();
        var rows = new List<IReadOnlyList<string?>>();
        if (!debit)
        {
            var from = StartOf(scope.Filter.From);
            var legacy = await context.NonFiscalCreditNotes.AsNoTracking().Where(n => ids.Contains(n.InvoiceId) && n.CreatedAt >= from && n.CreatedAt < end).OrderBy(n => n.CreatedAt).ToArrayAsync(ct);
            foreach (var n in legacy)
            {
                amounts.Add((n.CurrencyCode, n.Amount));
                rows.Add([DateText(DateOf(n.CreatedAt)), n.Number, invoices[n.InvoiceId].Number, invoices[n.InvoiceId].Airline,
                    n.CurrencyCode, Money(n.Amount), n.Reason, "Heredada", null]);
            }
        }
        foreach (var n in notes)
        {
            amounts.Add((n.CurrencyCode, n.Amount));
            rows.Add([DateText(n.EffectiveOn), n.Number, invoices[n.InvoiceId].Number, invoices[n.InvoiceId].Airline,
                n.CurrencyCode, Money(n.Amount), n.Reason, debit ? "Débito por línea" : "Crédito por línea",
                string.Join("; ", lines.Where(l => l.NoteId == n.Id).OrderBy(l => l.LineNumber).Select(l => $"#{l.LineNumber}: {Number(l.Quantity)} / {Money(l.Amount)}"))]);
        }
        return (amounts.GroupBy(n => n.Currency).Select(g => new FinanceReportMetric($"Notas de {(debit ? "débito" : "crédito")} {g.Key}", Money(g.Sum(n => n.Amount)), "money", g.Key)).ToArray(),
            [Col("date", "Fecha", "date"), Col("number", "Nota"), Col("invoice", "Factura"), Col("airline", "Aerolínea"),
                Col("currency", "Moneda"), Col("amount", "Importe", "money"), Col("reason", "Motivo"), Col("origin", "Origen"), Col("lines", "Líneas / cantidad / importe")], rows,
            ["Cada nota se cuenta una sola vez por su importe total; el detalle de líneas es trazabilidad, no un importe adicional. Las notas no son cobros ni devoluciones."]);
    }

    private async Task<(IReadOnlyList<FinanceReportMetric>, IReadOnlyList<FinanceReportColumn>, IReadOnlyList<IReadOnlyList<string?>>, IReadOnlyList<string>)>
        PackagesReportAsync(Scope scope, CancellationToken ct)
    {
        var invoices = (await InvoicesAsync(scope, true, ct)).ToDictionary(i => i.Id);
        var ids = invoices.Keys.ToArray();
        var lines = await context.NonFiscalInvoiceLines.AsNoTracking().Where(l => ids.Contains(l.InvoiceId) &&
            (l.Kind == PreinvoiceLineKind.Package || l.Kind == PreinvoiceLineKind.Excess)).OrderBy(l => l.InvoiceId).ThenBy(l => l.LineNumber).ToArrayAsync(ct);
        return (lines.GroupBy(l => l.CurrencyCode).Select(g => new FinanceReportMetric($"Paquetes y excedentes {g.Key}", Money(g.Sum(l => l.Amount)), "money", g.Key)).ToArray(),
            [Col("invoice", "Factura"), Col("airline", "Aerolínea"), Col("kind", "Tipo"), Col("date", "Operación", "date"), Col("concept", "Concepto congelado"),
                Col("currency", "Moneda"), Col("quantity", "Cantidad", "number"), Col("amount", "Facturado", "money")],
            lines.Select(l => (IReadOnlyList<string?>)[invoices[l.InvoiceId].Number, invoices[l.InvoiceId].Airline, LineKind(l.Kind),
                DateText(l.OperationDate), $"{l.ServiceCode} · {l.ServiceName}", l.CurrencyCode, Number(l.ExecutedQuantity), Money(l.Amount)]).ToArray(),
            ["Usa las líneas emitidas, sin consultar precios o definiciones actuales del catálogo. El período corresponde a la emisión de la factura."]);
    }
}
