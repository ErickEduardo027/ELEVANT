using Elevant.Application.Common;
using System.Globalization;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Finance;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

/// <summary>Finance reports restricted to the stations the actor holds.</summary>
internal sealed partial class EfFinanceReportStore(
    ElevantDbContext context,
    IActorContextResolver actors,
    TimeProvider timeProvider) : IFinanceReportStore
{
    private const string Consolidation = "USD";

    private sealed record Scope(long[] StationIds, FinanceReportFilter Filter, long? AirlineId);

    public async Task<FinanceReportData?> GetAsync(Guid actorId, string reportKey, FinanceReportFilter filter,
        CancellationToken cancellationToken = default)
    {
        var definition = FinanceReports.All.SingleOrDefault(item => item.Key == reportKey);
        if (definition is null || filter is null || filter.To == DateOnly.MaxValue || filter.To < filter.From || filter.To.DayNumber - filter.From.DayNumber > 731 ||
            filter.CurrencyCode is not (null or "USD" or "DOP"))
            return null;
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor is null || !actor.HasPermission("finance.reports.read") || !actor.Memberships.Any(membership =>
                membership.Kind == MembershipKind.InternalStaff &&
                membership.OrganizationType == OrganizationType.AviamOperator))
            return null;
        var allowed = actor.StationScopes.Select(scope => scope.StationId).ToArray();
        if (filter.StationId is { } requested && !allowed.Contains(requested)) return null;
        var stationKeys = filter.StationId is { } only ? [only] : allowed;
        var stationIds = await context.Stations.AsNoTracking().Where(station => stationKeys.Contains(station.PublicId))
            .Select(station => station.Id).ToArrayAsync(cancellationToken);
        long? airlineId = filter.AirlineId is { } airline
            ? await context.Airlines.AsNoTracking().Where(item => item.PublicId == airline).Select(item => (long?)item.Id)
                .SingleOrDefaultAsync(cancellationToken) ?? -1
            : null;
        var scope = new Scope(stationIds, filter, airlineId);
        var (summary, columns, rows, notes) = reportKey switch
        {
            "revenue" => await RevenueAsync(scope, cancellationToken),
            "receivables" => await ReceivablesAsync(scope, cancellationToken),
            "collections" => await TreasuryCollectionsAsync(scope, cancellationToken),
            "payables" => await PayablesReportAsync(scope, cancellationToken),
            "charges" => await ChargesAsync(scope, cancellationToken),
            "sales" => await SalesAsync(scope, cancellationToken),
            _ => throw new InvalidOperationException("The report catalog and its builders diverged."),
        };
        return new FinanceReportData(definition.Key, definition.Title, definition.Description, filter.From, filter.To,
            reportKey is "revenue" or "receivables" or "collections" ? Consolidation : null, summary, columns, rows, notes);
    }

    private static string Money(decimal value) => decimal.Round(value, 2, MidpointRounding.AwayFromZero)
        .ToString("0.00", CultureInfo.InvariantCulture);

    private static string Number(decimal value) => value.ToString("0.####", CultureInfo.InvariantCulture);

    private static string Month(DateOnly date) => date.ToString("yyyy-MM", CultureInfo.InvariantCulture);

    /// <summary>4-N10: the business day (America/Santo_Domingo) of an instant, for days and months of the reports.</summary>
    private static DateOnly DateOf(DateTimeOffset value) => BusinessCalendar.Today(value);

    /// <summary>First instant of a business day in Santo Domingo.</summary>
    private static DateTimeOffset StartOf(DateOnly day) => BusinessCalendar.StartOfDay(day);

    private static FinanceReportColumn Col(string key, string label, string type = "text") => new(key, label, type);

    private readonly Dictionary<DateOnly, decimal?> usdRates = new();

    /// <summary>Amount in USD using the latest recorded rate on or before the date; null when no rate exists.</summary>
    private async Task<decimal?> ToUsdAsync(decimal amount, string currency, DateOnly date, CancellationToken cancellationToken)
    {
        if (currency == Consolidation) return amount;
        if (!usdRates.TryGetValue(date, out var rate))
            usdRates[date] = rate = await FinanceTariffLookup.ExchangeRateAsync(context, currency, Consolidation, date,
                cancellationToken);
        return rate is { } value ? decimal.Round(amount * value, 4) : null;
    }

    /// <summary>
    /// An invoice of the scope. <c>FiscalNumber</c> is the simulated e-NCF (4-N19, 4-N20), null for an invoice issued
    /// before ADR-0035; <c>NetTotal</c> and <c>TaxTotal</c> are its subtotal and ITBIS when it carries them.
    /// </summary>
    private sealed record InvoiceRow(long Id, string Number, string? FiscalNumber, long AirlineId, string Airline,
        long StationId, string CurrencyCode, decimal Total, decimal? NetTotal, decimal? TaxTotal, DateTimeOffset IssuedAt,
        DateOnly? DueDate);

    private async Task<InvoiceRow[]> InvoicesAsync(Scope scope, bool inPeriod, CancellationToken cancellationToken)
    {
        var from = StartOf(scope.Filter.From);
        var to = EndOf(scope.Filter.To);
        var rows = await (from invoice in context.NonFiscalInvoices.AsNoTracking()
                          join airline in context.Airlines.AsNoTracking() on invoice.AirlineId equals airline.Id
                          where scope.StationIds.Contains(invoice.StationId) &&
                                (scope.AirlineId == null || invoice.AirlineId == scope.AirlineId) &&
                                (scope.Filter.CurrencyCode == null || invoice.CurrencyCode == scope.Filter.CurrencyCode) &&
                                (!inPeriod || invoice.CreatedAt >= @from && invoice.CreatedAt < to)
                          select new { invoice.Id, invoice.Number, invoice.FiscalNumber, invoice.AirlineId, airline.Name,
                              invoice.StationId, invoice.CurrencyCode, invoice.Total, invoice.NetTotal, invoice.TaxTotal,
                              invoice.CreatedAt, invoice.DueDate })
            .ToArrayAsync(cancellationToken);
        return rows.Select(row => new InvoiceRow(row.Id, row.Number, row.FiscalNumber, row.AirlineId, row.Name,
            row.StationId, row.CurrencyCode, row.Total, row.NetTotal, row.TaxTotal, row.CreatedAt, row.DueDate)).ToArray();
    }

    private async Task<(IReadOnlyList<FinanceReportMetric>, IReadOnlyList<FinanceReportColumn>, IReadOnlyList<IReadOnlyList<string?>>, IReadOnlyList<string>)>
        RevenueAsync(Scope scope, CancellationToken cancellationToken)
    {
        var invoices = await InvoicesAsync(scope, true, cancellationToken);
        var ids = invoices.Select(invoice => invoice.Id).ToArray();
        var lines = (await context.NonFiscalInvoiceLines.AsNoTracking().Where(line => ids.Contains(line.InvoiceId))
                .Select(line => new { line.InvoiceId, line.Kind, line.Amount, line.TaxAmount }).ToArrayAsync(cancellationToken))
            .ToLookup(line => line.InvoiceId);
        var rows = new List<IReadOnlyList<string?>>();
        decimal consolidated = 0;
        var missingRate = false;
        foreach (var group in invoices.GroupBy(invoice => (Month: Month(DateOf(invoice.IssuedAt)), invoice.Airline,
                     invoice.CurrencyCode)).OrderBy(group => group.Key.Month).ThenBy(group => group.Key.Airline))
        {
            var groupLines = group.SelectMany(invoice => lines[invoice.Id]).ToArray();
            var total = group.Sum(invoice => invoice.Total);
            decimal? usd = 0;
            foreach (var invoice in group)
                usd = usd is null ? null : await ToUsdAsync(invoice.Total, invoice.CurrencyCode, DateOf(invoice.IssuedAt),
                    cancellationToken) is { } converted ? usd + converted : null;
            if (usd is null) missingRate = true; else consolidated += usd.Value;
            rows.Add([group.Key.Month, group.Key.Airline, group.Key.CurrencyCode, group.Count().ToString(CultureInfo.InvariantCulture),
                Money(groupLines.Where(line => line.Kind == PreinvoiceLineKind.Service).Sum(line => line.Amount)),
                Money(groupLines.Where(line => line.Kind == PreinvoiceLineKind.Charge).Sum(line => line.Amount)),
                Money(groupLines.Where(line => line.Kind == PreinvoiceLineKind.Adjustment).Sum(line => line.Amount)),
                Money(total), usd is null ? null : Money(usd.Value),
                Money(groupLines.Where(line => line.Kind == PreinvoiceLineKind.Package).Sum(line => line.Amount)),
                Money(groupLines.Where(line => line.Kind == PreinvoiceLineKind.Excess).Sum(line => line.Amount)),
                Money(groupLines.Where(line => line.Kind == PreinvoiceLineKind.Minimum).Sum(line => line.Amount)),
                groupLines.Any(line => line.TaxAmount == null) ? null : Money(groupLines.Sum(line => line.TaxAmount ?? 0m))]);
        }
        var summary = invoices.GroupBy(invoice => invoice.CurrencyCode)
            .Select(group => new FinanceReportMetric($"Facturado {group.Key}", Money(group.Sum(invoice => invoice.Total)),
                "money", group.Key)).Append(new FinanceReportMetric("Consolidado USD", Money(consolidated), "money", "USD"))
            .Append(new FinanceReportMetric("Facturas", invoices.Length.ToString(CultureInfo.InvariantCulture), "number"))
            .ToArray();
        return (summary,
            [Col("month", "Mes"), Col("airline", "Aerolínea"), Col("currency", "Moneda"), Col("invoices", "Facturas", "number"),
                Col("services", "Servicios", "money"), Col("charges", "Cargos", "money"), Col("adjustments", "Ajustes", "money"),
                Col("total", "Total", "money"), Col("usd", "Total USD", "money"), Col("packages", "Paquetes", "money"),
                Col("excess", "Excedentes", "money"), Col("minimum", "Mínimos", "money"), Col("tax", "ITBIS", "money")],
            rows, missingRate ? ["Algunas facturas en DOP no tienen tasa registrada y no se consolidan en USD."] : []);
    }

    private async Task<(IReadOnlyList<FinanceReportMetric>, IReadOnlyList<FinanceReportColumn>, IReadOnlyList<IReadOnlyList<string?>>, IReadOnlyList<string>)>
        ReceivablesAsync(Scope scope, CancellationToken cancellationToken)
    {
        var invoices = await InvoicesAsync(scope, false, cancellationToken);
        var ids = invoices.Select(invoice => invoice.Id).ToArray();
        var asOf = scope.Filter.To;
        var end = EndOf(asOf);
        var paid = await context.NonFiscalPayments.AsNoTracking().Where(item => ids.Contains(item.InvoiceId) && item.CreatedAt < end &&
                (item.PaidOn == null || item.PaidOn <= asOf))
            .GroupBy(item => item.InvoiceId).Select(group => new { group.Key, Sum = group.Sum(item => item.Amount) })
            .ToDictionaryAsync(item => item.Key, item => item.Sum, cancellationToken);
        var credited = await context.NonFiscalCreditNotes.AsNoTracking().Where(item => ids.Contains(item.InvoiceId) && item.CreatedAt < end)
            .GroupBy(item => item.InvoiceId).Select(group => new { group.Key, Sum = group.Sum(item => item.Amount) })
            .ToDictionaryAsync(item => item.Key, item => item.Sum, cancellationToken);
        var treasury = await FinanceTreasuryBalances.TotalsAsync(context, ids, cancellationToken, asOf);
        var open = invoices.Select(invoice => new
        {
            invoice, Balance = invoice.Total - paid.GetValueOrDefault(invoice.Id) - credited.GetValueOrDefault(invoice.Id)
                - treasury[invoice.Id].Applied - treasury[invoice.Id].Credited + treasury[invoice.Id].Debited,
            Days = invoice.DueDate is { } due ? asOf.DayNumber - due.DayNumber : 0,
        }).Where(item => item.Balance > 0 && DateOf(item.invoice.IssuedAt) <= asOf).ToArray();
        var rows = open.GroupBy(item => (item.invoice.Airline, item.invoice.CurrencyCode))
            .OrderBy(group => group.Key.Airline)
            .Select(group => (IReadOnlyList<string?>)
            [
                group.Key.Airline, group.Key.CurrencyCode, group.Count().ToString(CultureInfo.InvariantCulture),
                Money(group.Where(item => item.Days <= 0).Sum(item => item.Balance)),
                Money(group.Where(item => item.Days is > 0 and <= 30).Sum(item => item.Balance)),
                Money(group.Where(item => item.Days is > 30 and <= 60).Sum(item => item.Balance)),
                Money(group.Where(item => item.Days is > 60 and <= 90).Sum(item => item.Balance)),
                Money(group.Where(item => item.Days > 90).Sum(item => item.Balance)),
                Money(group.Sum(item => item.Balance)),
            ]).ToArray();
        var summary = open.GroupBy(item => item.invoice.CurrencyCode)
            .SelectMany(group => new[]
            {
                new FinanceReportMetric($"Por cobrar {group.Key}", Money(group.Sum(item => item.Balance)), "money", group.Key),
                new FinanceReportMetric($"Vencido {group.Key}", Money(group.Where(item => item.Days > 0).Sum(item => item.Balance)),
                    "money", group.Key),
            }).ToArray();
        return (summary,
            [Col("airline", "Aerolínea"), Col("currency", "Moneda"), Col("invoices", "Facturas abiertas", "number"),
                Col("current", "Por vencer", "money"), Col("d30", "1-30 días", "money"), Col("d60", "31-60 días", "money"),
                Col("d90", "61-90 días", "money"), Col("d90plus", "+90 días", "money"), Col("balance", "Saldo", "money")],
            rows, [$"Antigüedad al {asOf:yyyy-MM-dd}; solo movimientos efectivos y registrados hasta ese corte. Incluye pagos heredados, aplicaciones netas y notas comerciales; los recibos sin aplicar no reducen facturas."]);
    }


    /// <summary>
    /// «Recargos» (4-A): the charges, contractual minimums and package excesses Finance invoiced, from the frozen lines of
    /// the invoices in scope whose operation falls in the period, plus the adjustments of invoices issued before ADR-0035.
    /// Net is the amount before ITBIS; a charge excluded in OCC's review shows a zero amount.
    /// </summary>
    private async Task<(IReadOnlyList<FinanceReportMetric>, IReadOnlyList<FinanceReportColumn>, IReadOnlyList<IReadOnlyList<string?>>, IReadOnlyList<string>)>
        ChargesAsync(Scope scope, CancellationToken cancellationToken)
    {
        var ids = (await InvoicesAsync(scope, false, cancellationToken)).Select(invoice => invoice.Id).ToArray();
        var lines = await context.NonFiscalInvoiceLines.AsNoTracking()
            .Where(line => ids.Contains(line.InvoiceId) && line.OperationDate >= scope.Filter.From &&
                line.OperationDate <= scope.Filter.To &&
                (line.Kind == PreinvoiceLineKind.Charge || line.Kind == PreinvoiceLineKind.Minimum ||
                 line.Kind == PreinvoiceLineKind.Excess || line.Kind == PreinvoiceLineKind.Adjustment))
            .Select(line => new { line.Kind, line.ServiceCode, line.ServiceName, line.CurrencyCode, line.Amount,
                line.NetAmount, line.TaxAmount })
            .ToArrayAsync(cancellationToken);
        var rows = lines.GroupBy(line => (line.Kind, line.ServiceCode, line.ServiceName, line.CurrencyCode))
            .OrderBy(group => group.Key.Kind).ThenBy(group => group.Key.ServiceCode, StringComparer.Ordinal)
            .ThenBy(group => group.Key.CurrencyCode, StringComparer.Ordinal)
            .Select(group => (IReadOnlyList<string?>)
            [
                LineKind(group.Key.Kind), Concept(group.Key.ServiceCode, group.Key.ServiceName), group.Key.CurrencyCode,
                group.Count().ToString(CultureInfo.InvariantCulture), Money(group.Sum(line => line.NetAmount ?? line.Amount)),
                group.Any(line => line.TaxAmount == null) ? null : Money(group.Sum(line => line.TaxAmount ?? 0m)),
                Money(group.Sum(line => line.Amount)),
            ]).ToArray();
        var summary = lines.GroupBy(line => line.CurrencyCode).OrderBy(group => group.Key, StringComparer.Ordinal)
            .Select(group => new FinanceReportMetric($"Recargos {group.Key}", Money(group.Sum(line => line.Amount)), "money",
                group.Key))
            .Append(new FinanceReportMetric("Cargos facturados",
                lines.Count(line => line.Kind == PreinvoiceLineKind.Charge).ToString(CultureInfo.InvariantCulture), "number"))
            .ToArray();
        return (summary,
            [Col("kind", "Tipo"), Col("concept", "Concepto"), Col("currency", "Moneda"), Col("count", "Líneas", "number"),
                Col("net", "Neto", "money"), Col("tax", "ITBIS", "money"), Col("total", "Total", "money")],
            rows, ["Usa las líneas congeladas de las facturas emitidas, por fecha de operación. Los ajustes son de facturas anteriores a la facturación directa."]);
    }

    private static string Concept(string code, string name) =>
        string.IsNullOrWhiteSpace(code) ? name : $"{code} · {name}";
}
