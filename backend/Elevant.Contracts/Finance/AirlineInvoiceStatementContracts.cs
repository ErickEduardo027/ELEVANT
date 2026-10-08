namespace Elevant.Contracts.Finance;

public sealed record AirlineInvoiceStatementLineResponse(int LineNumber, string Kind, int? ParentLineNumber,
    string OperationCode, DateOnly OperationDate, string ServiceCode, string ServiceName, decimal Quantity,
    string BillingUnit, decimal UnitPrice, decimal Amount, string? Reason);

public sealed record AirlineInvoiceStatementPaymentResponse(string Reference, string Method, DateOnly? PaidOn,
    decimal Amount, DateTimeOffset RecordedAt);

public sealed record AirlineInvoiceStatementCreditNoteResponse(string Number, decimal Amount, string Reason,
    DateTimeOffset IssuedAt);

/// <summary>Non-fiscal statement of one invoice: balance, due date, charge lines, payments and credit notes.</summary>
public sealed record AirlineInvoiceStatementResponse(Guid InvoiceId, string Number, Guid PreinvoiceId,
    string CurrencyCode, decimal Total, decimal Paid, decimal Credited, decimal Balance, DateTimeOffset IssuedAt,
    DateOnly? DueDate, string Status, int DaysOverdue, IReadOnlyList<AirlineInvoiceStatementLineResponse> Lines,
    IReadOnlyList<AirlineInvoiceStatementPaymentResponse> Payments,
    IReadOnlyList<AirlineInvoiceStatementCreditNoteResponse> CreditNotes);
