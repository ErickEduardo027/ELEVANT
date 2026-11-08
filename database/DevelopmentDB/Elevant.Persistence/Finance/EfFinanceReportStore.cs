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
            "pipeline" => await PipelineAsync(scope, cancellationToken),
            "charges" => await ChargesAsync(scope, cancellationToken),
            "disputes" => await DisputesAsync(scope, cancellationToken),
            "tariffs" => await TariffsAsync(scope, cancellationToken),
            "credit-notes" => await AdjustmentNotesAsync(scope, false, cancellationToken),
            "debit-notes" => await AdjustmentNotesAsync(scope, true, cancellationToken),
            "treasury" => await TreasuryReportAsync(scope, cancellationToken),
            "payables" => await PayablesReportAsync(scope, false, cancellationToken),
            "suppliers" => await PayablesReportAsync(scope, true, cancellationToken),
            "expenses" => await ExpensesReportAsync(scope, cancellationToken),
            "packages" => await PackagesReportAsync(scope, cancellationToken),
            _ => await FiscalReportAsync(scope, reportKey == "fiscal-simulation", cancellationToken),
        };
        return new FinanceReportData(definition.Key, definition.Title, definition.Description, filter.From, filter.To,
            reportKey is "revenue" or "receivables" or "collections" ? Consolidation : null, summary, columns, rows, notes);
    }

    private static string Money(decimal value) => decimal.Round(value, 2, MidpointRounding.AwayFromZero)
        .ToString("0.00", CultureInfo.InvariantCulture);

    private static string Number(decimal value) => value.ToString("0.####", CultureInfo.InvariantCulture);

    private static string Month(DateOnly date) => date.ToString("yyyy-MM", CultureInfo.InvariantCulture);

    private static DateOnly DateOf(DateTimeOffset value) => DateOnly.FromDateTime(value.UtcDateTime);

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

    private sealed record InvoiceRow(long Id, string Number, long AirlineId, string Airline, string CurrencyCode,
        decimal Total, DateTimeOffset IssuedAt, DateOnly? DueDate);

    private async Task<InvoiceRow[]> InvoicesAsync(Scope scope, bool inPeriod, CancellationToken cancellationToken)
    {
        var from = new DateTimeOffset(scope.Filter.From.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
        var to = new DateTimeOffset(scope.Filter.To.AddDays(1).ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
        var rows = await (from invoice in context.NonFiscalInvoices.AsNoTracking()
                          join airline in context.Airlines.AsNoTracking() on invoice.AirlineId equals airline.Id
                          where scope.StationIds.Contains(invoice.StationId) &&
                                (scope.AirlineId == null || invoice.AirlineId == scope.AirlineId) &&
                                (scope.Filter.CurrencyCode == null || invoice.CurrencyCode == scope.Filter.CurrencyCode) &&
                                (!inPeriod || invoice.CreatedAt >= @from && invoice.CreatedAt < to)
                          select new { invoice.Id, invoice.Number, invoice.AirlineId, airline.Name, invoice.CurrencyCode,
                              invoice.Total, invoice.CreatedAt, invoice.DueDate })
            .ToArrayAsync(cancellationToken);
        return rows.Select(row => new InvoiceRow(row.Id, row.Number, row.AirlineId, row.Name, row.CurrencyCode, row.Total,
            row.CreatedAt, row.DueDate)).ToArray();
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
                Col("excess", "Excedentes", "money"), Col("minimum", "Mínimos", "money"), Col("tax", "Impuesto incluido", "money")],
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


    private async Task<(IReadOnlyList<FinanceReportMetric>, IReadOnlyList<FinanceReportColumn>, IReadOnlyList<IReadOnlyList<string?>>, IReadOnlyList<string>)>
        PipelineAsync(Scope scope, CancellationToken cancellationToken)
    {
        var preinvoices = await (from preinvoice in context.Preinvoices.AsNoTracking()
                                 join airline in context.Airlines.AsNoTracking() on preinvoice.AirlineId equals airline.Id
                                 where scope.StationIds.Contains(preinvoice.StationId) &&
                                       (scope.AirlineId == null || preinvoice.AirlineId == scope.AirlineId) &&
                                       (scope.Filter.CurrencyCode == null || preinvoice.CurrencyCode == scope.Filter.CurrencyCode) &&
                                       preinvoice.To >= scope.Filter.From && preinvoice.From <= scope.Filter.To
                                 select new { preinvoice.Status, preinvoice.CurrencyCode, preinvoice.Total, airline.Name })
            .ToArrayAsync(cancellationToken);
        // «Aprobado sin prefacturar» counts the billable services only (ServiceBillability, 3-N11).
        var unbilled = await (from service in context.OperationServices.AsNoTracking().Where(ServiceBillability.Billable)
                              join operation in context.GroundOperations.AsNoTracking() on service.GroundOperationId equals operation.Id
                              join turnaround in context.Turnarounds.AsNoTracking() on operation.TurnaroundId equals turnaround.Id
                              join airline in context.Airlines.AsNoTracking() on turnaround.AirlineId equals airline.Id
                              where scope.StationIds.Contains(turnaround.StationId) &&
                                    (scope.AirlineId == null || turnaround.AirlineId == scope.AirlineId) &&
                                    turnaround.OperationDate >= scope.Filter.From && turnaround.OperationDate <= scope.Filter.To &&
                                    operation.CurrentStatus == GroundOperationStatus.Approved &&
                                    service.CurrencyCodeSnapshot != null &&
                                    (scope.Filter.CurrencyCode == null || service.CurrencyCodeSnapshot == scope.Filter.CurrencyCode) &&
                                    !context.PreinvoiceLines.Any(line => line.OperationServiceId == service.Id &&
                                        (line.Kind == PreinvoiceLineKind.Service || line.Kind == PreinvoiceLineKind.Package || line.Kind == PreinvoiceLineKind.Excess) && line.ReleasedAt == null)
                              select new
                              {
                                  airline.Name, Currency = service.CurrencyCodeSnapshot!,
                                  Amount = service.ExecutedQuantity * (service.UnitPriceSnapshot ?? 0m),
                              }).ToArrayAsync(cancellationToken);
        string[] stages = ["Draft", "Submitted", "Disputed", "Accepted", "Invoiced"];
        var rows = new List<IReadOnlyList<string?>>();
        foreach (var group in unbilled.GroupBy(item => (item.Name, item.Currency)).OrderBy(group => group.Key.Name))
            rows.Add(["Aprobado sin prefacturar", group.Key.Name, group.Key.Currency,
                group.Count().ToString(CultureInfo.InvariantCulture), Money(group.Sum(item => item.Amount))]);
        foreach (var stage in stages)
            foreach (var group in preinvoices.Where(item => item.Status.ToString() == stage)
                         .GroupBy(item => (item.Name, item.CurrencyCode)).OrderBy(group => group.Key.Name))
                rows.Add([StageLabel(stage), group.Key.Name, group.Key.CurrencyCode,
                    group.Count().ToString(CultureInfo.InvariantCulture), Money(group.Sum(item => item.Total))]);
        var summary = new[]
        {
            new FinanceReportMetric("Servicios sin prefacturar", unbilled.Length.ToString(CultureInfo.InvariantCulture), "number"),
            new FinanceReportMetric("Prefacturas en disputa",
                preinvoices.Count(item => item.Status == PreinvoiceStatus.Disputed).ToString(CultureInfo.InvariantCulture), "number"),
            new FinanceReportMetric("Prefacturas por aceptar",
                preinvoices.Count(item => item.Status == PreinvoiceStatus.Submitted).ToString(CultureInfo.InvariantCulture), "number"),
        };
        return (summary,
            [Col("stage", "Etapa"), Col("airline", "Aerolínea"), Col("currency", "Moneda"), Col("count", "Cantidad", "number"),
                Col("amount", "Importe", "money")],
            rows, ["Los servicios sin prefacturar se valoran con su precio congelado, sin cargos."]);
    }

    private static string StageLabel(string stage) => stage switch
    {
        "Draft" => "Prefactura en borrador",
        "Submitted" => "Enviada, por aceptar",
        "Disputed" => "En disputa",
        "Accepted" => "Aceptada, por facturar",
        _ => "Facturada",
    };

    private async Task<(IReadOnlyList<FinanceReportMetric>, IReadOnlyList<FinanceReportColumn>, IReadOnlyList<IReadOnlyList<string?>>, IReadOnlyList<string>)>
        ChargesAsync(Scope scope, CancellationToken cancellationToken)
    {
        var lines = await (from line in context.PreinvoiceLines.AsNoTracking()
                           join preinvoice in context.Preinvoices.AsNoTracking() on line.PreinvoiceId equals preinvoice.Id
                           where scope.StationIds.Contains(preinvoice.StationId) && preinvoice.Status != PreinvoiceStatus.Voided &&
                                 (scope.AirlineId == null || preinvoice.AirlineId == scope.AirlineId) &&
                                 (scope.Filter.CurrencyCode == null || preinvoice.CurrencyCode == scope.Filter.CurrencyCode) &&
                                 line.OperationDate >= scope.Filter.From && line.OperationDate <= scope.Filter.To &&
                                 line.Kind != PreinvoiceLineKind.Service
                           select new
                           {
                               line.Kind, line.ServiceCode, line.ServiceName, line.CurrencyCode, line.ComputedAmount,
                               line.Amount, line.IsExcluded, line.EditedAt, line.AdjustmentReason,
                           }).ToArrayAsync(cancellationToken);
        var rows = new List<IReadOnlyList<string?>>();
        foreach (var group in lines.Where(line => line.Kind != PreinvoiceLineKind.Adjustment)
                     .GroupBy(line => (line.Kind, line.ServiceCode, line.ServiceName, line.CurrencyCode)).OrderBy(group => group.Key.ServiceCode))
        {
            var computed = group.Sum(line => line.ComputedAmount ?? line.Amount);
            var billed = group.Sum(line => line.Amount);
            rows.Add([LineKind(group.Key.Kind), $"{group.Key.ServiceCode} · {group.Key.ServiceName}", group.Key.CurrencyCode,
                group.Count().ToString(CultureInfo.InvariantCulture),
                group.Count(line => line.EditedAt != null).ToString(CultureInfo.InvariantCulture),
                Money(computed), Money(billed), Money(billed - computed), null]);
        }
        foreach (var line in lines.Where(line => line.Kind == PreinvoiceLineKind.Adjustment))
            rows.Add(["Ajuste", line.ServiceName, line.CurrencyCode, "1", "1", Money(0), Money(line.Amount), Money(line.Amount),
                line.AdjustmentReason]);
        var charges = lines.Where(line => line.Kind == PreinvoiceLineKind.Charge).ToArray();
        var summary = new[]
        {
            new FinanceReportMetric("Cargos aplicados", charges.Length.ToString(CultureInfo.InvariantCulture), "number"),
            new FinanceReportMetric("Cargos editados por Finanzas",
                charges.Count(line => line.EditedAt != null).ToString(CultureInfo.InvariantCulture), "number"),
            new FinanceReportMetric("Ajustes manuales",
                lines.Count(line => line.Kind == PreinvoiceLineKind.Adjustment).ToString(CultureInfo.InvariantCulture), "number"),
        };
        return (summary,
            [Col("kind", "Tipo"), Col("concept", "Concepto"), Col("currency", "Moneda"), Col("count", "Líneas", "number"),
                Col("edited", "Editadas", "number"), Col("computed", "Calculado", "money"), Col("billed", "Facturado", "money"),
                Col("difference", "Diferencia", "money"), Col("reason", "Motivo")],
            rows, ["Incluye prefacturas no anuladas; un cargo excluido figura con importe facturado cero."]);
    }

    private async Task<(IReadOnlyList<FinanceReportMetric>, IReadOnlyList<FinanceReportColumn>, IReadOnlyList<IReadOnlyList<string?>>, IReadOnlyList<string>)>
        DisputesAsync(Scope scope, CancellationToken cancellationToken)
    {
        var from = new DateTimeOffset(scope.Filter.From.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
        var to = new DateTimeOffset(scope.Filter.To.AddDays(1).ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
        var disputes = await (from dispute in context.PreinvoiceDisputes.AsNoTracking()
                              join preinvoice in context.Preinvoices.AsNoTracking() on dispute.PreinvoiceId equals preinvoice.Id
                              join airline in context.Airlines.AsNoTracking() on preinvoice.AirlineId equals airline.Id
                              join resolutionCandidate in context.PreinvoiceDisputeResolutions.AsNoTracking()
                                  on dispute.Id equals resolutionCandidate.DisputeId into resolutions
                              from resolution in resolutions.DefaultIfEmpty()
                              where scope.StationIds.Contains(preinvoice.StationId) &&
                                    (scope.AirlineId == null || preinvoice.AirlineId == scope.AirlineId) &&
                                    (scope.Filter.CurrencyCode == null || preinvoice.CurrencyCode == scope.Filter.CurrencyCode) &&
                                    dispute.CreatedAt >= @from && dispute.CreatedAt < to
                              select new
                              {
                                  dispute.Id, airline.Name, preinvoice.CurrencyCode,
                                  Decision = resolution == null ? null : resolution.Decision,
                                  Amount = (from selection in context.PreinvoiceDisputeLines
                                            join line in context.PreinvoiceLines on selection.PreinvoiceLineId equals line.Id
                                            where selection.DisputeId == dispute.Id
                                            select (decimal?)line.Amount).Sum() ?? 0m,
                              }).ToArrayAsync(cancellationToken);
        var rows = disputes.GroupBy(item => (item.Name, item.CurrencyCode)).OrderBy(group => group.Key.Name)
            .Select(group => (IReadOnlyList<string?>)
            [
                group.Key.Name, group.Key.CurrencyCode, group.Count().ToString(CultureInfo.InvariantCulture),
                group.Count(item => item.Decision == null).ToString(CultureInfo.InvariantCulture),
                group.Count(item => item.Decision == "Maintain").ToString(CultureInfo.InvariantCulture),
                group.Count(item => item.Decision == "Void").ToString(CultureInfo.InvariantCulture),
                Money(group.Sum(item => item.Amount)),
            ]).ToArray();
        var summary = new[]
        {
            new FinanceReportMetric("Disputas", disputes.Length.ToString(CultureInfo.InvariantCulture), "number"),
            new FinanceReportMetric("Pendientes", disputes.Count(item => item.Decision == null).ToString(CultureInfo.InvariantCulture),
                "number"),
        };
        return (summary,
            [Col("airline", "Aerolínea"), Col("currency", "Moneda"), Col("disputes", "Disputas", "number"),
                Col("pending", "Pendientes", "number"), Col("maintained", "Mantenidas", "number"),
                Col("voided", "Anuladas", "number"), Col("amount", "Importe disputado", "money")],
            rows, []);
    }

    private async Task<(IReadOnlyList<FinanceReportMetric>, IReadOnlyList<FinanceReportColumn>, IReadOnlyList<IReadOnlyList<string?>>, IReadOnlyList<string>)>
        TariffsAsync(Scope scope, CancellationToken cancellationToken)
    {
        var lines = await (from line in context.NonFiscalInvoiceLines.AsNoTracking()
                           join invoice in context.NonFiscalInvoices.AsNoTracking() on line.InvoiceId equals invoice.Id
                           join service in context.ServiceDefinitions.AsNoTracking() on line.ServiceCode equals service.Code
                           where scope.StationIds.Contains(invoice.StationId) && line.Kind == PreinvoiceLineKind.Service &&
                                 (scope.AirlineId == null || invoice.AirlineId == scope.AirlineId) &&
                                 (scope.Filter.CurrencyCode == null || invoice.CurrencyCode == scope.Filter.CurrencyCode) &&
                                 line.OperationDate >= scope.Filter.From && line.OperationDate <= scope.Filter.To
                           select new { ServiceId = service.Id, line.ServiceCode, line.ServiceName, line.CurrencyCode,
                               line.ExecutedQuantity, line.UnitPrice, line.Amount }).ToArrayAsync(cancellationToken);
        var rows = new List<IReadOnlyList<string?>>();
        foreach (var group in lines.GroupBy(line => (line.ServiceId, line.ServiceCode, line.ServiceName, line.CurrencyCode))
                     .OrderByDescending(group => group.Sum(line => line.Amount)))
        {
            var basePrice = (await FinanceTariffLookup.ServiceRatesAsync(context, group.Key.CurrencyCode, scope.Filter.To, null,
                [group.Key.ServiceId], cancellationToken)).GetValueOrDefault(group.Key.ServiceId)?.UnitPrice;
            var quantity = group.Sum(line => line.ExecutedQuantity);
            var amount = group.Sum(line => line.Amount);
            var average = quantity == 0 ? 0 : amount / quantity;
            rows.Add([$"{group.Key.ServiceCode} · {group.Key.ServiceName}", group.Key.CurrencyCode,
                Number(quantity), Money(amount), Money(average), basePrice is { } price ? Money(price) : null,
                basePrice is > 0 ? Number(decimal.Round((average - basePrice.Value) / basePrice.Value * 100m, 1)) : null]);
        }
        return ([new FinanceReportMetric("Servicios facturados", lines.Length.ToString(CultureInfo.InvariantCulture), "number")],
            [Col("service", "Servicio"), Col("currency", "Moneda"), Col("quantity", "Cantidad", "number"),
                Col("amount", "Facturado", "money"), Col("average", "Precio medio", "money"), Col("base", "Tarifa base", "money"),
                Col("deviation", "Desviación", "percent")],
            rows, ["La tarifa base es la publicada al cierre del período."]);
    }


}
