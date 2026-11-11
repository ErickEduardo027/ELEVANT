namespace Elevant.Application.Abstractions.Finance;

/// <summary>
/// Balance-derived status (<see cref="Elevant.Application.Finance.FinanceInvoiceStatus"/>): Paid, PartiallyPaid, Overdue
/// (past due with balance), Pending or Voided (credited to zero without any payment, 4-N24).
/// </summary>
public sealed record FinanceInvoiceSummaryData(Guid Id, string Number, Guid PreinvoiceId, Guid AirlineId, string Airline,
    Guid StationId, string StationCode, string CurrencyCode, decimal Total, decimal Paid, decimal Credited,
    decimal Balance, DateTimeOffset IssuedAt, DateOnly? DueDate, string Status, int DaysOverdue,
    string? FiscalNumber = null);

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

/// <summary>What an airline sees of its own invoice: no internal staff names.</summary>
public sealed record AirlineInvoicePaymentData(string Reference, string Method, DateOnly? PaidOn, decimal Amount,
    DateTimeOffset RecordedAt);

public sealed record AirlineInvoiceCreditNoteData(string Number, decimal Amount, string Reason, DateTimeOffset IssuedAt);

public sealed record AirlineInvoiceStatementData(Guid InvoiceId, string Number, Guid PreinvoiceId, string CurrencyCode,
    decimal Total, decimal Paid, decimal Credited, decimal Balance, DateTimeOffset IssuedAt, DateOnly? DueDate,
    string Status, int DaysOverdue, IReadOnlyList<FinanceInvoiceLineData> Lines,
    IReadOnlyList<AirlineInvoicePaymentData> Payments, IReadOnlyList<AirlineInvoiceCreditNoteData> CreditNotes);

/// <summary>Invoices with their payments, credit notes and outstanding balance (read only).</summary>
public interface IFinanceInvoiceLedgerStore
{
    /// <summary>
    /// The invoices of the actor's stations, newest first. <paramref name="search"/> (up to 40 characters) matches the
    /// start of the e-NCF or of the number, or any part of the airline name (4-N21). Null when forbidden.
    /// </summary>
    Task<FinanceInvoicePageData?> ListAsync(Guid actorId, Guid? stationId, Guid? airlineId, string? status, int page,
        int limit, string? search = null, CancellationToken cancellationToken = default);

    Task<FinanceInvoiceDetailData?> GetAsync(Guid actorId, Guid invoiceId, CancellationToken cancellationToken = default);

    /// <summary>Statement of one invoice owned by the airline organization; null when it is not theirs.</summary>
    Task<AirlineInvoiceStatementData?> GetStatementForAirlineAsync(Guid organizationId, Guid invoiceId,
        CancellationToken cancellationToken = default);
}
