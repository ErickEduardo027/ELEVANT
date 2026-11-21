using System.Globalization;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

internal sealed partial class EfFinanceReportStore
{
    /// <summary>
    /// «Facturas emitidas» (ADR-0048, «Reportes nuevos»): one row per invoice issued in the period (business days of
    /// Santo Domingo), with its e-NCF, internal number, due date, status, subtotal, ITBIS, total, what was paid and its
    /// balance at the cut-off <c>to</c>. The status follows <see cref="InvoiceStatusLabels"/>, and the filter
    /// <c>status</c> keeps only those.
    /// </summary>
    private async Task<(IReadOnlyList<FinanceReportMetric>, IReadOnlyList<FinanceReportColumn>, IReadOnlyList<IReadOnlyList<string?>>, IReadOnlyList<string>)>
        IssuedInvoicesAsync(Scope scope, CancellationToken cancellationToken)
    {
        var asOf = scope.Filter.To;
        var end = EndOf(asOf);
        var invoices = await InvoicesAsync(scope, true, cancellationToken);
        var ids = invoices.Select(invoice => invoice.Id).ToArray();
        var paid = await context.NonFiscalPayments.AsNoTracking().Where(item => ids.Contains(item.InvoiceId) && item.CreatedAt < end &&
                (item.PaidOn == null || item.PaidOn <= asOf))
            .GroupBy(item => item.InvoiceId).Select(group => new { group.Key, Sum = group.Sum(item => item.Amount) })
            .ToDictionaryAsync(item => item.Key, item => item.Sum, cancellationToken);
        var credited = await context.NonFiscalCreditNotes.AsNoTracking().Where(item => ids.Contains(item.InvoiceId) && item.CreatedAt < end)
            .GroupBy(item => item.InvoiceId).Select(group => new { group.Key, Sum = group.Sum(item => item.Amount) })
            .ToDictionaryAsync(item => item.Key, item => item.Sum, cancellationToken);
        var treasury = await FinanceTreasuryBalances.TotalsAsync(context, ids, cancellationToken, asOf);
        var stationIds = invoices.Select(invoice => invoice.StationId).Distinct().ToArray();
        var stations = await context.Stations.AsNoTracking().Where(station => stationIds.Contains(station.Id))
            .ToDictionaryAsync(station => station.Id, station => station.Code, cancellationToken);
        var rows = invoices.Select(invoice =>
            {
                var totals = treasury[invoice.Id];
                var paidOut = paid.GetValueOrDefault(invoice.Id) + totals.Applied;
                var notes = credited.GetValueOrDefault(invoice.Id) + totals.Credited - totals.Debited;
                var balance = FinanceTreasuryRules.Balance(invoice.Total, paid.GetValueOrDefault(invoice.Id),
                    credited.GetValueOrDefault(invoice.Id), totals.Applied, totals.Credited, totals.Debited);
                var days = balance > 0m && invoice.DueDate is { } due ? Math.Max(0, asOf.DayNumber - due.DayNumber) : 0;
                var tax = invoice.TaxTotal ?? 0m;
                return new
                {
                    Invoice = invoice, Paid = paidOut, Balance = balance, Tax = tax,
                    Subtotal = invoice.NetTotal ?? invoice.Total - tax,
                    Status = InvoiceStatusLabels.Code(balance, paidOut, notes, days),
                };
            })
            .Where(item => InvoiceStatusLabels.Matches(scope.Filter.Status, item.Status))
            .OrderBy(item => item.Invoice.IssuedAt).ThenBy(item => item.Invoice.FiscalNumber ?? item.Invoice.Number, StringComparer.Ordinal)
            .ToArray();
        var summary = new List<FinanceReportMetric>
        {
            new("Facturas", Number(rows.Length), "number", null, "emitidas en el período"),
            new("Vencidas", Number(rows.Count(item => item.Status == InvoiceStatusLabels.Overdue)), "number", null,
                $"de {Counted(rows.Length, "factura", "facturas")}"),
            new("Pagadas", Number(rows.Count(item => item.Status == InvoiceStatusLabels.Paid)), "number", null,
                $"de {Counted(rows.Length, "factura", "facturas")}"),
        };
        foreach (var group in rows.GroupBy(item => item.Invoice.CurrencyCode).OrderBy(group => group.Key, StringComparer.Ordinal))
        {
            var billed = group.Sum(item => item.Invoice.Total);
            summary.Add(new($"Facturado {group.Key}", Money(billed), "money", group.Key, $"en {Counted(group.Count(), "factura", "facturas")}"));
            summary.Add(new($"Saldo {group.Key}", Money(group.Sum(item => item.Balance)), "money", group.Key,
                Share(group.Sum(item => item.Balance), billed, "de lo facturado")));
        }
        return (summary,
            [Col("date", "Emisión", "date"), Col("fiscalNumber", "e-NCF"), Col("number", "Número interno"),
                Col("airline", "Aerolínea"), Col("station", "Estación"), Col("currency", "Moneda"), Col("due", "Vence", "date"),
                Col("status", "Estado"), Col("subtotal", "Subtotal", "money"), Col("tax", "ITBIS", "money"),
                Col("total", "Total", "money"), Col("paid", "Pagado", "money"), Col("balance", "Saldo", "money")],
            rows.Select(item => (IReadOnlyList<string?>)
            [
                DateText(DateOf(item.Invoice.IssuedAt)), item.Invoice.FiscalNumber, item.Invoice.Number, item.Invoice.Airline,
                stations.GetValueOrDefault(item.Invoice.StationId), item.Invoice.CurrencyCode,
                item.Invoice.DueDate is { } due ? DateText(due) : null, InvoiceStatusLabels.Label(item.Status),
                Money(item.Subtotal), Money(item.Tax), Money(item.Invoice.Total), Money(item.Paid), Money(item.Balance),
            ]).ToArray(),
            [$"Estado, pagado y saldo al {asOf:dd/MM/yyyy}: pagos heredados y aplicaciones de cobros efectivos hasta esa fecha. Las facturas NF anteriores a la e-CF no tienen e-NCF.",
                $"{FinanceInvoicePolicy.Disclaimer}."]);
    }

    /// <summary>
    /// «Cobros» (ADR-0048, «Reportes nuevos»): each receipt received in the period with its method, reference, what it
    /// applied to invoices and what remains unapplied at the cut-off <c>to</c>; a reversed receipt remains at zero. The
    /// legacy payments (before the treasury) count as received and applied in full.
    /// </summary>
    private async Task<(IReadOnlyList<FinanceReportMetric>, IReadOnlyList<FinanceReportColumn>, IReadOnlyList<IReadOnlyList<string?>>, IReadOnlyList<string>)>
        ReceiptsAsync(Scope scope, CancellationToken cancellationToken)
    {
        var first = scope.Filter.From;
        var last = scope.Filter.To;
        var end = EndOf(last);
        var receipts = await (from receipt in context.Set<FinanceTreasuryReceipt>().AsNoTracking()
                              join airline in context.Airlines.AsNoTracking() on receipt.AirlineId equals airline.Id
                              join station in context.Stations.AsNoTracking() on receipt.StationId equals station.Id
                              where scope.StationIds.Contains(receipt.StationId) && receipt.CreatedAt < end &&
                                    receipt.ReceivedOn >= first && receipt.ReceivedOn <= last &&
                                    (scope.AirlineId == null || receipt.AirlineId == scope.AirlineId) &&
                                    (scope.Filter.CurrencyCode == null || receipt.CurrencyCode == scope.Filter.CurrencyCode)
                              select new { receipt.Id, receipt.ReceivedOn, Airline = airline.Name, Station = station.Code,
                                  receipt.CurrencyCode, receipt.Method, receipt.Reference, receipt.Amount })
            .ToArrayAsync(cancellationToken);
        var ids = receipts.Select(receipt => receipt.Id).ToArray();
        var moves = (await context.Set<FinanceTreasuryMovement>().AsNoTracking()
                .Where(move => ids.Contains(move.ReceiptId) && move.EffectiveOn <= last && move.CreatedAt < end)
                .Select(move => new { move.ReceiptId, move.Kind, move.ReceiptAmount }).ToArrayAsync(cancellationToken))
            .ToLookup(move => move.ReceiptId);
        var rows = receipts.Select(receipt =>
        {
            var own = moves[receipt.Id].ToArray();
            var applied = own.Sum(move => move.Kind == FinanceTreasuryMovementKind.Application ? move.ReceiptAmount
                : move.Kind == FinanceTreasuryMovementKind.ApplicationReversal ? -move.ReceiptAmount : 0m);
            var refunded = own.Where(move => move.Kind == FinanceTreasuryMovementKind.Refund).Sum(move => move.ReceiptAmount);
            var reversed = own.Any(move => move.Kind == FinanceTreasuryMovementKind.ReceiptReversal);
            return new CollectionRow(receipt.ReceivedOn, receipt.Airline, receipt.Station, receipt.CurrencyCode, receipt.Method,
                receipt.Reference, reversed ? "Reversado" : refunded > 0m ? "Recibo con devolución" : "Recibo", receipt.Amount,
                applied, refunded, FinanceTreasuryRules.Available(receipt.Amount, applied, refunded, reversed), reversed);
        }).ToList();
        var invoices = (await InvoicesAsync(scope with { Filter = scope.Filter with { CurrencyCode = null } }, false, cancellationToken))
            .ToDictionary(invoice => invoice.Id);
        var invoiceIds = invoices.Keys.ToArray();
        var legacy = await context.NonFiscalPayments.AsNoTracking().Where(payment => invoiceIds.Contains(payment.InvoiceId) &&
                payment.CreatedAt < end && (scope.Filter.CurrencyCode == null || payment.CurrencyCode == scope.Filter.CurrencyCode))
            .Select(payment => new { payment.InvoiceId, payment.PaidOn, payment.CreatedAt, payment.CurrencyCode, payment.Method,
                payment.Reference, payment.Amount })
            .ToArrayAsync(cancellationToken);
        var legacyStations = invoices.Values.Select(invoice => invoice.StationId).Distinct().ToArray();
        var stationCodes = await context.Stations.AsNoTracking().Where(station => legacyStations.Contains(station.Id))
            .ToDictionaryAsync(station => station.Id, station => station.Code, cancellationToken);
        rows.AddRange(legacy.Select(payment => new { Payment = payment, Day = payment.PaidOn ?? DateOf(payment.CreatedAt) })
            .Where(item => item.Day >= first && item.Day <= last)
            .Select(item => new CollectionRow(item.Day, invoices[item.Payment.InvoiceId].Airline,
                stationCodes.GetValueOrDefault(invoices[item.Payment.InvoiceId].StationId) ?? string.Empty,
                item.Payment.CurrencyCode, item.Payment.Method, item.Payment.Reference, "Pago heredado", item.Payment.Amount,
                item.Payment.Amount, 0m, 0m)));
        var ordered = rows.OrderBy(row => row.Date).ThenBy(row => row.Reference, StringComparer.Ordinal).ToArray();
        var summary = new List<FinanceReportMetric>
        {
            new("Cobros", Number(ordered.Length), "number", null, "recibidos en el período"),
            new("Con remanente sin aplicar", Number(ordered.Count(row => row.Remaining > 0m)), "number", null,
                $"de {Counted(ordered.Length, "cobro", "cobros")}"),
        };
        foreach (var group in ordered.GroupBy(row => row.Currency).OrderBy(group => group.Key, StringComparer.Ordinal))
        {
            // A reversed receipt is listed with its state, but the money it recorded was never received.
            var effective = group.Where(row => !row.Reversed).ToArray();
            var received = effective.Sum(row => row.Received);
            summary.Add(new($"Recibido {group.Key}", Money(received), "money", group.Key, $"en {Counted(effective.Length, "cobro", "cobros")}"));
            summary.Add(new($"Aplicado {group.Key}", Money(group.Sum(row => row.Applied)), "money", group.Key,
                Share(group.Sum(row => row.Applied), received, "de lo recibido")));
            summary.Add(new($"Remanente {group.Key}", Money(group.Sum(row => row.Remaining)), "money", group.Key,
                Share(group.Sum(row => row.Remaining), received, "de lo recibido")));
        }
        return (summary,
            [Col("date", "Fecha", "date"), Col("airline", "Aerolínea"), Col("station", "Estación"), Col("currency", "Moneda"),
                Col("method", "Método"), Col("reference", "Referencia"), Col("kind", "Origen"), Col("received", "Recibido", "money"),
                Col("applied", "Aplicado", "money"), Col("refunded", "Devuelto", "money"), Col("remaining", "Remanente", "money")],
            ordered.Select(row => (IReadOnlyList<string?>)
            [
                DateText(row.Date), row.Airline, row.Station, row.Currency, FinanceLabels.PaymentMethod(row.Method),
                row.Reference, row.Kind, Money(row.Received), Money(row.Applied), Money(row.Refunded), Money(row.Remaining),
            ]).ToArray(),
            [$"Aplicado, devuelto y remanente al {last:dd/MM/yyyy}, en la moneda del cobro. Un cobro reversado se lista con su estado, no deja remanente y no suma a «Recibido». No constituye confirmación bancaria."]);
    }

    private sealed record CollectionRow(DateOnly Date, string Airline, string Station, string Currency, PaymentMethod Method,
        string Reference, string Kind, decimal Received, decimal Applied, decimal Refunded, decimal Remaining, bool Reversed = false);

    private static string Number(int value) => value.ToString(CultureInfo.InvariantCulture);

    /// <summary>«1 factura», «3 facturas»: the noun agrees with its count.</summary>
    private static string Counted(int count, string singular, string plural) => $"{Number(count)} {(count == 1 ? singular : plural)}";
}
