namespace Elevant.Application.Abstractions.Finance;

/// <summary>
/// The printable statement of account of one airline at a cut-off date, in one currency (PR E): the customer header,
/// the aging of what it owes, its open invoices and the movements of the period with their running balance. The
/// renderer computes the running balance from <c>OpeningBalance</c> (what the airline owed before <c>From</c>, 0 without a
/// start) and each movement's debit and credit; the figures are the ones the store already reconciled, the document never
/// recalculates them. <c>CustomerTaxRegistration</c> is printed as given («RNC 1-31-23456-9»); <c>StationLabel</c> is null
/// for every station; <c>From</c> is null when the statement lists every movement until the cut-off.
/// </summary>
public sealed record FinanceStatementDocumentData(
    string CustomerName, string? CustomerTaxRegistration, string CustomerCode, string? StationLabel,
    DateOnly AsOf, DateOnly? From, string CurrencyCode, DateTimeOffset GeneratedAt, string GeneratedBy,
    decimal OpeningBalance, FinanceStatementAgingDocumentData Aging,
    IReadOnlyList<FinanceStatementInvoiceDocumentData> OpenInvoices,
    IReadOnlyList<FinanceStatementMovementDocumentData> Movements);

/// <summary>The aging of the balance at the cut-off; <c>Balance</c> is what the airline owes in total.</summary>
public sealed record FinanceStatementAgingDocumentData(decimal Current, decimal Days1To30, decimal Days31To60,
    decimal Days61To90, decimal Days91Plus, decimal Unallocated, decimal CreditBalance, decimal Balance);

/// <summary>An invoice with a balance at the cut-off; <c>Number</c> is its e-NCF or, before ADR-0035, its number.</summary>
public sealed record FinanceStatementInvoiceDocumentData(string Number, DateOnly IssuedOn, DateOnly? DueDate, int DaysOverdue,
    decimal Total, decimal Balance);

/// <summary>
/// A movement of the statement: an invoice or a debit note is a <c>Debit</c>; a payment, a credit note or an
/// application is a <c>Credit</c>. <c>Document</c> is the e-NCF, receipt or note it refers to.
/// </summary>
public sealed record FinanceStatementMovementDocumentData(DateOnly Date, string Document, string Description, decimal Debit,
    decimal Credit);

/// <summary>Renders <see cref="FinanceStatementDocumentData"/> as the PDF of the statement of account.</summary>
public interface IStatementDocumentRenderer
{
    byte[] RenderStatement(FinanceStatementDocumentData statement);
}

/// <summary>
/// The receipt of a treasury collection (PR E): who paid, how, when, the amount received and how it was applied to the
/// airline's invoices, with what remains available.
/// </summary>
public sealed record FinanceTreasuryReceiptDocumentData(string Reference, string PayerName, string? PayerTaxRegistration,
    string StationCode, string CurrencyCode, decimal Amount, string Method, DateOnly ReceivedOn, DateTimeOffset RecordedAt,
    string RecordedBy, string? Notes, decimal Applied, decimal Refunded, decimal Available, bool Reversed,
    IReadOnlyList<FinanceTreasuryReceiptApplicationDocumentData> Applications);

/// <summary>An application of the receipt to an invoice, in the invoice's currency, and the balance it left.</summary>
public sealed record FinanceTreasuryReceiptApplicationDocumentData(string InvoiceNumber, DateOnly EffectiveOn,
    decimal ReceiptAmount, string InvoiceCurrency, decimal InvoiceAmount, decimal? InvoiceBalance);
