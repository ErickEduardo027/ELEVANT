namespace Elevant.Application.Finance;

/// <summary>
/// The projected status of an invoice (ADR-0016), derived from its balance, never stored. 4-N24: an invoice that nobody
/// paid and that credit notes brought to zero is <see cref="Voided"/> («Anulada»), never <see cref="Paid"/>; once any
/// payment was applied, a balance of zero or less is <see cref="Paid"/>.
/// </summary>
public static class FinanceInvoiceStatus
{
    public const string Pending = "Pending";
    public const string PartiallyPaid = "PartiallyPaid";
    public const string Paid = "Paid";
    public const string Overdue = "Overdue";
    public const string Voided = "Voided";

    /// <summary>Every status a summary can have, in the order the filters show them.</summary>
    public static IReadOnlyList<string> All { get; } = [Pending, PartiallyPaid, Paid, Overdue, Voided];

    /// <param name="balance">What is still owed.</param>
    /// <param name="paidAmount">Payments and applied receipts.</param>
    /// <param name="creditedAmount">Credit notes net of debit notes, legacy credit notes included.</param>
    /// <param name="overdueDays">Whole business days past the due date with a balance.</param>
    public static string Of(decimal balance, decimal paidAmount, decimal creditedAmount, int overdueDays) =>
        balance <= 0m
            ? paidAmount <= 0m && creditedAmount > 0m ? Voided : Paid
            : overdueDays > 0 ? Overdue
            : paidAmount + creditedAmount > 0m ? PartiallyPaid : Pending;
}
