using System.Globalization;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Finance;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

internal sealed partial class EfFinanceReportStore
{
    /// <summary>
    /// «Ventas (e-CF simulado)» (4-N20): the sales book of the simulated e-CF. One row per invoice with an e-NCF issued
    /// in the period, in business days of Santo Domingo, with its subtotal before ITBIS, its ITBIS and its total. The
    /// non-fiscal invoices issued before ADR-0035 carry no e-NCF and are left out.
    /// </summary>
    private async Task<(IReadOnlyList<FinanceReportMetric>, IReadOnlyList<FinanceReportColumn>, IReadOnlyList<IReadOnlyList<string?>>, IReadOnlyList<string>)>
        SalesAsync(Scope scope, CancellationToken cancellationToken)
    {
        var invoices = (await InvoicesAsync(scope, true, cancellationToken))
            .Where(invoice => invoice.FiscalNumber is not null).ToArray();
        var stationIds = invoices.Select(invoice => invoice.StationId).Distinct().ToArray();
        var stations = await context.Stations.AsNoTracking().Where(station => stationIds.Contains(station.Id))
            .ToDictionaryAsync(station => station.Id, station => station.Code, cancellationToken);
        var sales = invoices
            .Select(invoice => new
            {
                Invoice = invoice, Tax = invoice.TaxTotal ?? 0m,
                Subtotal = invoice.NetTotal ?? invoice.Total - (invoice.TaxTotal ?? 0m),
            })
            .OrderBy(item => item.Invoice.FiscalNumber, StringComparer.Ordinal).ToArray();
        var summary = sales.GroupBy(item => item.Invoice.CurrencyCode).OrderBy(group => group.Key, StringComparer.Ordinal)
            .SelectMany(group => new[]
            {
                new FinanceReportMetric($"Ventas {group.Key}", Money(group.Sum(item => item.Subtotal)), "money", group.Key),
                new FinanceReportMetric($"ITBIS {group.Key}", Money(group.Sum(item => item.Tax)), "money", group.Key),
            })
            .Append(new FinanceReportMetric("Facturas e-CF", sales.Length.ToString(CultureInfo.InvariantCulture), "number"))
            .ToArray();
        return (summary,
            [Col("date", "Fecha", "date"), Col("fiscalNumber", "e-NCF"), Col("number", "Número interno"),
                Col("airline", "Aerolínea"), Col("station", "Estación"), Col("currency", "Moneda"),
                Col("subtotal", "Subtotal", "money"), Col("tax", "ITBIS", "money"), Col("total", "Total", "money")],
            sales.Select(item => (IReadOnlyList<string?>)
            [
                DateText(DateOf(item.Invoice.IssuedAt)), item.Invoice.FiscalNumber, item.Invoice.Number, item.Invoice.Airline,
                stations.GetValueOrDefault(item.Invoice.StationId), item.Invoice.CurrencyCode, Money(item.Subtotal),
                Money(item.Tax), Money(item.Invoice.Total),
            ]).ToArray(),
            [$"{FinanceInvoicePolicy.Disclaimer}; las facturas NF heredadas no se incluyen.",
                "Ventas = subtotal antes de ITBIS, en días hábiles de Santo Domingo."]);
    }
}
