using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Documents;

namespace Elevant.Application.Finance;

/// <summary>An invoice of a statement at its cut-off.</summary>
public sealed record AccountStatementInvoice(Guid Id, string Number, string? FiscalNumber, string CurrencyCode,
    decimal Total, decimal Balance, DateOnly? DueDate);

/// <summary>A movement of a statement (the kinds of <c>GET finance/statements</c>), in its currency.</summary>
public sealed record AccountStatementMovement(string Kind, Guid? InvoiceId, string CurrencyCode, decimal Amount,
    DateOnly EffectiveOn, string Reference)
{
    /// <summary>The airline of the movement; only the consolidated statement of every airline needs it.</summary>
    public string? Airline { get; init; }
}

/// <summary>The customer header of the printable statement: name, code and readable tax id.</summary>
public sealed record AirlineCustomerHeader(string Name, string Code, string? TaxRegistration);

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
/// The PDF is the printable document of PR E (<see cref="ToPrintable"/> for <see cref="IStatementDocumentRenderer"/>),
/// in one currency; the Excel stays on the engine, with every currency.
/// </remarks>
public static class AccountStatementDocuments
{
    public const string Title = "Estado de cuenta";

    /// <summary>The airline label of the consolidated statement, without an <c>airlineId</c>.</summary>
    public const string AllAirlines = "Todas las aerolíneas";

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

    /// <summary>The columns of the consolidated statement: the airline, then those of <see cref="Columns"/>.</summary>
    public static IReadOnlyList<ReportColumn> ConsolidatedColumns { get; } =
    [
        ReportColumn.Text("Aerolínea"), new("Fecha", ReportColumnType.Date), ReportColumn.Text("Movimiento"),
        ReportColumn.Text("Documento"), ReportColumn.Text("Factura"), new("Vence", ReportColumnType.Date),
        ReportColumn.Text("Moneda"), ReportColumn.Money("Cargo", currencyColumn: 6), ReportColumn.Money("Abono", currencyColumn: 6),
        new("Saldo", ReportColumnType.Money) { CurrencyColumn = 6 },
    ];

    /// <summary>
    /// The statement of every airline the actor may read at a cut-off (no <c>airlineId</c>): the movements grouped by
    /// airline, each with the running balance of its airline and currency, and the aging of all of them as the summary.
    /// </summary>
    public static ReportDocument ToConsolidatedDocument(AccountStatementInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        var airlines = input.Movements.GroupBy(movement => movement.Airline ?? "—")
            .OrderBy(group => group.Key, StringComparer.Ordinal).ToArray();
        var rows = airlines.SelectMany(group => Rows(input, group).Select(row =>
            (IReadOnlyList<ReportCell>)[ReportCell.Of(group.Key), .. row])).ToList();
        var summary = Summary(input);
        summary.Insert(0, new ReportMetric("Aerolíneas", ReportFormat.Integer(airlines.Length), "con movimientos hasta el corte"));
        return Document(input, ConsolidatedColumns, rows, summary) with
        {
            Description = $"Movimientos de la cuenta de cada aerolínea hasta el {ReportFormat.Date(input.AsOf)}, agrupados por " +
                "aerolínea con el saldo acumulado de cada moneda, y la antigüedad de los saldos de todas ellas.",
        };
    }

    public static ReportDocument ToDocument(AccountStatementInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        return Document(input, Columns, Rows(input, input.Movements), Summary(input));
    }

    private static List<IReadOnlyList<ReportCell>> Rows(AccountStatementInput input, IEnumerable<AccountStatementMovement> movements)
    {
        var invoices = input.Invoices.ToDictionary(invoice => invoice.Id);
        var balances = new Dictionary<string, decimal>(StringComparer.Ordinal);
        var rows = new List<IReadOnlyList<ReportCell>>();
        foreach (var movement in movements.OrderBy(item => item.EffectiveOn))
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
        return rows;
    }

    private static List<ReportMetric> Summary(AccountStatementInput input)
    {
        var summary = new List<ReportMetric>();
        var open = input.Invoices.Count(invoice => invoice.Balance > 0m);
        summary.Add(new ReportMetric("Facturas con saldo", ReportFormat.Integer(open),
            ReportFormat.OfTotal(open, input.Invoices.Count, "factura emitida", "facturas emitidas")));
        foreach (var aging in input.Aging.OrderBy(item => item.CurrencyCode, StringComparer.Ordinal))
        {
            var currency = aging.CurrencyCode;
            var overdue = aging.Days1To30 + aging.Days31To60 + aging.Days61To90 + aging.Days91Plus;
            var owed = aging.Current + overdue;
            summary.Add(new ReportMetric($"Saldo de facturas {currency}", ReportFormat.Money(aging.Balance, currency),
                $"en {ReportFormat.Count(input.Invoices.Count(invoice => invoice.CurrencyCode == currency && invoice.Balance > 0m), "factura con saldo", "facturas con saldo")}"));
            summary.Add(new ReportMetric($"Vencido {currency}", ReportFormat.Money(overdue, currency), Of(overdue, owed)));
            summary.Add(new ReportMetric($"Por vencer {currency}", ReportFormat.Money(aging.Current, currency), Of(aging.Current, owed)));
            // The overdue buckets and the unapplied receipts only when they hold something: a zero adds nothing to read.
            foreach (var (label, amount) in new[] { ("1-30 días", aging.Days1To30), ("31-60 días", aging.Days31To60),
                         ("61-90 días", aging.Days61To90), ("Más de 90 días", aging.Days91Plus) })
                if (amount != 0m)
                    summary.Add(new ReportMetric($"{label} {currency}", ReportFormat.Money(amount, currency), Of(amount, owed)));
            if (aging.Unallocated != 0m)
                summary.Add(new ReportMetric($"Cobros sin aplicar {currency}", ReportFormat.Money(aging.Unallocated, currency),
                    "a favor de la aerolínea"));
            summary.Add(new ReportMetric($"Saldo de la cuenta {currency}",
                ReportFormat.Money(aging.Balance - aging.Unallocated, currency), "facturas con saldo menos cobros sin aplicar"));
        }
        return summary;
    }

    private static ReportDocument Document(AccountStatementInput input, IReadOnlyList<ReportColumn> columns,
        IReadOnlyList<IReadOnlyList<ReportCell>> rows, IReadOnlyList<ReportMetric> summary) =>
        new(FinanceReportDocuments.Area, Title, columns, rows)
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

    /// <summary>
    /// The currency of the printable statement (it prints one): the one asked for, else the one of most invoices
    /// (the first in order on a tie), else USD.
    /// </summary>
    public static string PrintableCurrency(AccountStatementInput input, string? requested)
    {
        ArgumentNullException.ThrowIfNull(input);
        if (requested is { Length: 3 }) return requested;
        return input.Invoices.GroupBy(invoice => invoice.CurrencyCode).OrderByDescending(group => group.Count())
            .ThenBy(group => group.Key, StringComparer.Ordinal).Select(group => group.Key).FirstOrDefault() ?? "USD";
    }

    /// <summary>
    /// The statement in one currency for the printable document of PR E (<see cref="IStatementDocumentRenderer"/>):
    /// every movement until the cut-off (no opening balance), each charge as a debit and each credit as a credit, so
    /// its running balance is the same as the engine's; applications are left out because they move nothing.
    /// </summary>
    public static FinanceStatementDocumentData ToPrintable(AccountStatementInput input, string currency,
        AirlineCustomerHeader customer, DateTimeOffset generatedAt, string generatedBy)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(customer);
        var issued = input.Movements.Where(movement => movement.Kind == "Invoice" && movement.InvoiceId is not null)
            .GroupBy(movement => movement.InvoiceId!.Value).ToDictionary(group => group.Key, group => group.Min(item => item.EffectiveOn));
        var invoices = input.Invoices.ToDictionary(invoice => invoice.Id);
        var aging = input.Aging.FirstOrDefault(item => item.CurrencyCode == currency);
        var movements = input.Movements.Where(movement => movement.CurrencyCode == currency).OrderBy(movement => movement.EffectiveOn)
            .Select(movement => (Movement: movement, Kind: Kind(movement.Kind)))
            .Where(item => item.Kind.Sign != 0)
            .Select(item =>
            {
                var invoice = item.Movement.InvoiceId is { } id ? invoices.GetValueOrDefault(id) : null;
                var description = invoice is null || item.Movement.Kind == "Invoice" ? item.Kind.Label
                    : $"{item.Kind.Label} · factura {invoice.FiscalNumber ?? invoice.Number}";
                return new FinanceStatementMovementDocumentData(item.Movement.EffectiveOn, item.Movement.Reference, description,
                    item.Kind.Sign > 0 ? item.Movement.Amount : 0m, item.Kind.Sign < 0 ? item.Movement.Amount : 0m);
            }).ToArray();
        var open = input.Invoices.Where(invoice => invoice.CurrencyCode == currency && invoice.Balance > 0m)
            .OrderBy(invoice => invoice.DueDate ?? DateOnly.MaxValue)
            .Select(invoice => new FinanceStatementInvoiceDocumentData(invoice.FiscalNumber ?? invoice.Number,
                issued.TryGetValue(invoice.Id, out var day) ? day : input.AsOf, invoice.DueDate,
                invoice.DueDate is { } due ? Math.Max(0, input.AsOf.DayNumber - due.DayNumber) : 0, invoice.Total, invoice.Balance))
            .ToArray();
        return new FinanceStatementDocumentData(customer.Name, customer.TaxRegistration, customer.Code, input.StationLabel,
            input.AsOf, null, currency, generatedAt, generatedBy, 0m,
            new FinanceStatementAgingDocumentData(aging?.Current ?? 0m, aging?.Days1To30 ?? 0m, aging?.Days31To60 ?? 0m,
                aging?.Days61To90 ?? 0m, aging?.Days91Plus ?? 0m, aging?.Unallocated ?? 0m, aging?.CreditBalance ?? 0m,
                aging?.Balance ?? 0m),
            open, movements);
    }

    private static string? Of(decimal part, decimal whole) =>
        ReportFormat.Share(part, whole) is { } share ? $"{share} del saldo por cobrar" : null;
}
