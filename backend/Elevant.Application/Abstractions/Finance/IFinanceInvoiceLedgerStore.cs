namespace Elevant.Application.Abstractions.Finance;

/// <summary>Balance-derived status: Paid, PartiallyPaid, Overdue (past due with balance) or Pending.</summary>
public sealed record FinanceInvoiceSummaryData(Guid Id, string Number, Guid PreinvoiceId, Guid AirlineId, string Airline,
    Guid StationId, string StationCode, string CurrencyCode, decimal Total, decimal Paid, decimal Credited,
    decimal Balance, DateTimeOffset IssuedAt, DateOnly? DueDate, string Status, int DaysOverdue);

public sealed record FinanceInvoicePageData(int Page, int Limit, bool HasMore, IReadOnlyList<FinanceInvoiceSummaryData> Invoices);

public sealed record FinanceInvoiceLineData(int LineNumber, string Kind, int? ParentLineNumber, string OperationCode,
    DateOnly OperationDate, string ServiceCode, string ServiceName, decimal Quantity, string BillingUnit,
    decimal UnitPrice, decimal Amount, string? Reason);

public sealed record FinancePaymentData(Guid Id, string Reference, string Method, DateOnly? PaidOn, decimal Amount,
    DateTimeOffset RecordedAt, string RecordedBy);

public sealed record FinanceCreditNoteData(Guid Id, string Number, decimal Amount, string Reason, DateTimeOffset IssuedAt,
    string IssuedBy);

public sealed record FinanceInvoiceDetailData(FinanceInvoiceSummaryData Summary, IReadOnlyList<FinanceInvoiceLineData> Lines,
    IReadOnlyList<FinancePaymentData> Payments, IReadOnlyList<FinanceCreditNoteData> CreditNotes);

public sealed record IssueCreditNoteInput(Guid RequestId, decimal Amount, string Reason);

/// <summary>What an airline sees of its own invoice: no internal staff names.</summary>
public sealed record AirlineInvoicePaymentData(string Reference, string Method, DateOnly? PaidOn, decimal Amount,
    DateTimeOffset RecordedAt);

public sealed record AirlineInvoiceCreditNoteData(string Number, decimal Amount, string Reason, DateTimeOffset IssuedAt);

public sealed record AirlineInvoiceStatementData(Guid InvoiceId, string Number, Guid PreinvoiceId, string CurrencyCode,
    decimal Total, decimal Paid, decimal Credited, decimal Balance, DateTimeOffset IssuedAt, DateOnly? DueDate,
    string Status, int DaysOverdue, IReadOnlyList<FinanceInvoiceLineData> Lines,
    IReadOnlyList<AirlineInvoicePaymentData> Payments, IReadOnlyList<AirlineInvoiceCreditNoteData> CreditNotes);

/// <summary>Non-fiscal invoices with their payments, credit notes and outstanding balance.</summary>
public interface IFinanceInvoiceLedgerStore
{
    Task<FinanceInvoicePageData?> ListAsync(Guid actorId, Guid? stationId, Guid? airlineId, string? status, int page,
        int limit, CancellationToken cancellationToken = default);

    Task<FinanceInvoiceDetailData?> GetAsync(Guid actorId, Guid invoiceId, CancellationToken cancellationToken = default);

    /// <summary>Statement of one invoice owned by the airline organization; null when it is not theirs.</summary>
    Task<AirlineInvoiceStatementData?> GetStatementForAirlineAsync(Guid organizationId, Guid invoiceId,
        CancellationToken cancellationToken = default);

    Task<FinanceCatalogResult> IssueCreditNoteAsync(Guid actorId, Guid invoiceId, IssueCreditNoteInput input,
        CancellationToken cancellationToken = default);
}
