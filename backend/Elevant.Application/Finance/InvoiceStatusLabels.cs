namespace Elevant.Application.Finance;

/// <summary>
/// The status of an invoice as Finance and the airline portal read it (ADR-0035, 4-N24): «Pagada» when nothing is owed,
/// «Anulada» when nobody paid and notes brought it to zero, «Vencida» past its due date and «Pendiente» otherwise. The
/// same rule as the portal's <c>invoiceStatus</c>.
/// </summary>
public static class InvoiceStatusLabels
{
    public const string Paid = "paid";
    public const string Voided = "voided";
    public const string Overdue = "overdue";
    public const string Pending = "pending";

    /// <summary>Every invoice with a balance: pending or overdue.</summary>
    public const string Open = "open";

    /// <summary>The status filter of the invoice reports: the four statuses and «Con saldo».</summary>
    public static IReadOnlyList<(string Code, string Label)> Options { get; } =
        [(Pending, "Pendiente"), (Overdue, "Vencida"), (Paid, "Pagada"), (Voided, "Anulada"), (Open, "Con saldo")];

    /// <summary>The status code of an invoice from its balance, what was paid, what notes credited and its days overdue.</summary>
    /// <param name="balance">What is still owed.</param>
    /// <param name="paid">What was paid or applied (legacy payments and treasury applications).</param>
    /// <param name="credited">What notes credited, net of debit notes.</param>
    /// <param name="daysOverdue">Days past the due date with a balance.</param>
    public static string Code(decimal balance, decimal paid, decimal credited, int daysOverdue) =>
        balance <= 0m ? paid <= 0m && credited > 0m ? Voided : Paid : daysOverdue > 0 ? Overdue : Pending;

    public static string Label(string code) => code switch
    {
        Paid => "Pagada",
        Voided => "Anulada",
        Overdue => "Vencida",
        Open => "Con saldo",
        _ => "Pendiente",
    };

    /// <summary>Whether an invoice of <paramref name="code"/> matches the filter <paramref name="filter"/>.</summary>
    public static bool Matches(string? filter, string code) =>
        filter is null || filter == code || filter == Open && code is Pending or Overdue;

    public static bool IsKnownFilter(string? filter) => filter is null || Options.Any(option => option.Code == filter);
}
