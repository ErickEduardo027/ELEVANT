using Elevant.Application.Abstractions.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

internal sealed partial class EfFinanceReportStore
{
    private sealed record PayableRow(long Id, long SupplierId, string Supplier, string Reference, string Station,
        string Currency, DateOnly Date, DateOnly Due, decimal Total, decimal TotalDop, decimal Applied);

    private async Task<PayableRow[]> ApprovedPayablesAsync(Scope scope, CancellationToken ct)
    {
        var end = EndOf(scope.Filter.To);
        var documents = await (from document in context.Set<SupplierInvoice>().AsNoTracking()
            join supplier in context.Set<Supplier>().AsNoTracking() on document.SupplierId equals supplier.Id
            join station in context.Stations.AsNoTracking() on document.ScopeStationId equals station.Id
            where scope.StationIds.Contains(document.ScopeStationId) && scope.StationIds.Contains(supplier.ScopeStationId) &&
                document.CreatedAt < end && document.DocumentDate <= scope.Filter.To &&
                (scope.AirlineId == null || document.AirlineId == scope.AirlineId) &&
                (scope.Filter.CurrencyCode == null || document.CurrencyCode == scope.Filter.CurrencyCode)
            select new { Document = document, Supplier = supplier.Code + " · " + supplier.Name, Station = station.Code }).ToArrayAsync(ct);
        var ids = documents.Select(d => d.Document.Id).ToArray();
        var reviews = await context.Set<SupplierInvoiceReview>().AsNoTracking().Where(r => ids.Contains(r.DocumentId) && r.DecidedAt < end)
            .OrderBy(r => r.DecidedAt).ThenBy(r => r.Id).ToArrayAsync(ct);
        var statuses = reviews.GroupBy(r => r.DocumentId).ToDictionary(g => g.Key, g => g.Last().Decision);
        // 4-N04: an application reversed by the cut-off no longer pays its invoice; a voided payment has none left.
        var applications = await (from a in context.Set<FinancePayablesApplication>().AsNoTracking()
            join payment in context.Set<FinancePayablesPayment>().AsNoTracking() on a.PaymentId equals payment.Id
            where ids.Contains(a.SupplierInvoiceId) && a.AppliedAt < end &&
                payment.CreatedAt < end && payment.PaidOn <= scope.Filter.To &&
                !context.Set<FinancePayablesReversal>().Any(r => r.ApplicationId == a.Id && r.ReversedAt < end)
            select new { a.SupplierInvoiceId, a.InvoiceAmount }).ToArrayAsync(ct);
        var paid = applications.GroupBy(a => a.SupplierInvoiceId).ToDictionary(g => g.Key, g => g.Sum(a => a.InvoiceAmount));
        return documents.Where(d => statuses.GetValueOrDefault(d.Document.Id,
                d.Document.UpdatedAt < end ? d.Document.Status.ToString() : "Draft") == "Approved")
            .Select(d => new PayableRow(d.Document.Id, d.Document.SupplierId, d.Supplier, d.Document.DocumentReference, d.Station,
                d.Document.CurrencyCode, d.Document.DocumentDate, d.Document.DueDate, d.Document.Total, d.Document.TotalDop,
                paid.GetValueOrDefault(d.Document.Id))).ToArray();
    }

    /// <summary>«Cuentas por pagar»: the approved supplier invoices with what was applied to them and their balance at the cut-off.</summary>
    private async Task<(IReadOnlyList<FinanceReportMetric>, IReadOnlyList<FinanceReportColumn>, IReadOnlyList<IReadOnlyList<string?>>, IReadOnlyList<string>)>
        PayablesReportAsync(Scope scope, CancellationToken ct)
    {
        var documents = await ApprovedPayablesAsync(scope, ct);
        var summary = documents.GroupBy(d => d.Currency).SelectMany(g => new[] {
            new FinanceReportMetric($"Por pagar {g.Key}", Money(g.Sum(d => d.Total - d.Applied)), "money", g.Key),
            new FinanceReportMetric($"Vencido {g.Key}", Money(g.Where(d => d.Due < scope.Filter.To).Sum(d => d.Total - d.Applied)), "money", g.Key),
        }).ToList();
        return (summary, [Col("reference", "Documento"), Col("supplier", "Proveedor"), Col("station", "Estación"), Col("date", "Fecha", "date"),
                Col("due", "Vencimiento", "date"), Col("currency", "Moneda"), Col("total", "Aprobado", "money"), Col("applied", "Aplicado", "money"),
                Col("balance", "Saldo", "money"), Col("dop", "Total DOP congelado", "money")],
            documents.OrderBy(d => d.Due).ThenBy(d => d.Reference).Select(d => (IReadOnlyList<string?>)[d.Reference, d.Supplier, d.Station,
                DateText(d.Date), DateText(d.Due), d.Currency, Money(d.Total), Money(d.Applied), Money(d.Total - d.Applied), Money(d.TotalDop)]).ToArray(),
            [$"Obligaciones aprobadas al {DateText(scope.Filter.To)}. Los pagos sin aplicar no reducen facturas; las facturas anuladas y las aplicaciones revertidas dejan de contar desde su fecha; los importes aplicados están en moneda de factura."]);
    }
}
