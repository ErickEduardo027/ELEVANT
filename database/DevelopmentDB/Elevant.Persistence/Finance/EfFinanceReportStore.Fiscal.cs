using Elevant.Application.Abstractions.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

internal sealed partial class EfFinanceReportStore
{
    private async Task<(IReadOnlyList<FinanceReportMetric>, IReadOnlyList<FinanceReportColumn>, IReadOnlyList<IReadOnlyList<string?>>, IReadOnlyList<string>)>
        FiscalReportAsync(Scope scope, bool simulation, CancellationToken ct)
    {
        var end = EndOf(scope.Filter.To);
        var start = StartOf(scope.Filter.From);
        var invoices = (await InvoicesAsync(scope, false, ct)).Where(i => i.IssuedAt < end).ToDictionary(i => i.Id);
        var invoiceIds = invoices.Keys.ToArray();
        var documents = await context.Set<FinanceFiscalDocument>().AsNoTracking().Where(d => invoiceIds.Contains(d.InvoiceId) &&
            d.CreatedAt >= start && d.CreatedAt < end && (simulation ? d.Mode == FiscalMode.LocalSimulation : d.Mode != FiscalMode.LocalSimulation))
            .OrderBy(d => d.CreatedAt).ThenBy(d => d.Id).ToArrayAsync(ct);
        var ids = documents.Select(d => d.Id).ToArray();
        var history = await context.Set<FinanceFiscalEvent>().AsNoTracking().Where(e => ids.Contains(e.DocumentId) && e.Applied && e.CreatedAt < end)
            .OrderBy(e => e.CreatedAt).ThenBy(e => e.Id).ToArrayAsync(ct);
        var states = history.GroupBy(e => e.DocumentId).ToDictionary(g => g.Key, g => g.Last().State);
        FiscalState State(FinanceFiscalDocument d) => states.GetValueOrDefault(d.Id, d.UpdatedAt < end ? d.State : FiscalState.AwaitingArchive);
        return ([new FinanceReportMetric(simulation ? "Documentos simulados" : "Documentos sin simulación local", Number(documents.Length), "number"),
                new FinanceReportMetric("Aceptados", Number(documents.Count(d => State(d) == FiscalState.Accepted)), "number"),
                new FinanceReportMetric("Pendientes o desconocidos", Number(documents.Count(d => State(d) is FiscalState.Pending or FiscalState.Unknown or FiscalState.Dispatching)), "number")],
            [Col("date", "Creación", "date"), Col("invoice", "Factura comercial"), Col("airline", "Aerolínea"), Col("mode", "Modo"), Col("environment", "Entorno"),
                Col("state", "Estado fiscal al corte"), Col("currency", "Moneda"), Col("amount", "Importe documental", "money")],
            documents.Select(d => (IReadOnlyList<string?>)[DateText(DateOf(d.CreatedAt)), invoices[d.InvoiceId].Number, invoices[d.InvoiceId].Airline,
                d.Mode.ToString(), d.Environment, State(d).ToString(), d.CurrencyCode, Money(d.Total)]).ToArray(),
            [simulation ? "Simulación local sin validez fiscal. Excluida del reporte fiscal predeterminado." : "Excluye LocalSimulation. ProviderSandbox es un entorno de pruebas y no acredita validez fiscal.",
                "El estado fiscal es independiente del estado comercial y de cobro. Este reporte no suma ingresos, cuentas por cobrar ni pagos."]);
    }
}
