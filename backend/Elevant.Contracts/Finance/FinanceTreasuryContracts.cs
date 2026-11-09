namespace Elevant.Contracts.Finance;
public sealed record FinanceTreasuryMutationResponse(Guid Id, string Version, bool Replayed);
public sealed record FinanceTreasuryReceiptRequest(Guid RequestId, Guid AirlineId, Guid StationId, string CurrencyCode,
    decimal Amount, string Reference, string Method, DateOnly ReceivedOn, string Reason);
public sealed record FinanceTreasuryAllocationRequest(Guid InvoiceId, string ExpectedInvoiceVersion, decimal ReceiptAmount);
public sealed record FinanceTreasuryApplyRequest(Guid RequestId, string ExpectedVersion, DateOnly EffectiveOn, string Reason,
    IReadOnlyList<FinanceTreasuryAllocationRequest> Applications);
public sealed record FinanceTreasuryReverseRequest(Guid RequestId, string ExpectedVersion, DateOnly EffectiveOn, string Reason,
    Guid? ApplicationId = null);
public sealed record FinanceTreasuryRefundRequest(Guid RequestId, string ExpectedVersion, DateOnly EffectiveOn, string Reason,
    decimal Amount, string Reference);
public sealed record FinanceTreasuryAdjustmentLineRequest(Guid InvoiceLineId, decimal Quantity, decimal Amount);
public sealed record FinanceTreasuryAdjustmentRequest(Guid RequestId, string ExpectedVersion, DateOnly EffectiveOn, string Reason,
    string Kind, IReadOnlyList<FinanceTreasuryAdjustmentLineRequest> Lines, Guid? RelatedNoteId = null);
public sealed record FinanceTreasuryMovementResponse(Guid Id, string Kind, Guid? InvoiceId, Guid? ReversesId, DateOnly EffectiveOn,
    decimal ReceiptAmount, decimal InvoiceAmount, string ReceiptCurrency, string? InvoiceCurrency, decimal ExchangeRate,
    DateOnly ExchangeRateOn, string Reference, string Reason, Guid ActorId, DateTimeOffset RecordedAt);
public sealed record FinanceTreasuryReceiptResponse(Guid Id, Guid AirlineId, Guid StationId, string CurrencyCode, decimal Amount,
    string Reference, string Method, DateOnly ReceivedOn, decimal Applied, decimal Refunded, decimal Available, bool Reversed,
    string Reason, Guid ActorId, DateTimeOffset RecordedAt, string Version, IReadOnlyList<FinanceTreasuryMovementResponse> Movements);
public sealed record FinanceTreasuryReceiptPageResponse(int Page, int Limit, bool HasMore, IReadOnlyList<FinanceTreasuryReceiptResponse> Items);
public sealed record FinanceTreasuryAdjustmentLineResponse(Guid InvoiceLineId, decimal Quantity, decimal Amount);
public sealed record FinanceTreasuryAdjustmentResponse(Guid Id, string Number, Guid InvoiceId, Guid? RelatedNoteId, string Kind,
    string CurrencyCode, decimal Amount, DateOnly EffectiveOn, string Reason, Guid ActorId, DateTimeOffset RecordedAt,
    IReadOnlyList<FinanceTreasuryAdjustmentLineResponse> Lines);
public sealed record FinanceTreasuryLineLimitResponse(Guid InvoiceLineId, int LineNumber, decimal Quantity, decimal Amount,
    decimal CreditQuantityRemaining, decimal CreditAmountRemaining, decimal DebitQuantityRemaining, decimal DebitAmountRemaining);
public sealed record FinanceTreasuryAdjustmentsResponse(Guid InvoiceId, string Version, decimal LegacyCredited,
    IReadOnlyList<FinanceTreasuryLineLimitResponse> Lines, IReadOnlyList<FinanceTreasuryAdjustmentResponse> Notes);
/// <summary>
/// An invoice of Finance's statement. <c>FiscalNumber</c> (4-N19, added last: web only) is the simulated e-NCF that
/// identifies it; null for the non-fiscal invoices issued before ADR-0035, which keep their <c>Number</c>.
/// </summary>
public sealed record FinanceTreasuryStatementInvoiceResponse(Guid Id, string Number, Guid AirlineId, Guid StationId,
    string CurrencyCode, decimal Total, decimal LegacyPaid, decimal LegacyCredited, decimal Applied, decimal Credited,
    decimal Debited, decimal Balance, DateOnly? DueDate, int DaysOverdue, string AgingBucket, string Version,
    string? FiscalNumber);
public sealed record FinanceTreasuryStatementMovementResponse(Guid Id, Guid? ReceiptId, Guid? InvoiceId, string Kind,
    string CurrencyCode, decimal Amount, DateOnly EffectiveOn, DateTimeOffset RecordedAt, Guid? ReversesId, string Reference);
public sealed record FinanceTreasuryAgingResponse(string CurrencyCode, decimal Balance, decimal Current, decimal Days1To30,
    decimal Days31To60, decimal Days61To90, decimal Days91Plus, decimal Unallocated, decimal CreditBalance);
public sealed record FinanceTreasuryStatementResponse(DateOnly AsOf, IReadOnlyList<FinanceTreasuryStatementInvoiceResponse> Invoices,
    IReadOnlyList<FinanceTreasuryReceiptResponse> Receipts, IReadOnlyList<FinanceTreasuryStatementMovementResponse> Movements,
    IReadOnlyList<FinanceTreasuryAgingResponse> Aging);

public sealed record FinanceTreasuryAirlineOptionResponse(Guid Id, string Name);
public sealed record FinanceTreasuryStationOptionResponse(Guid Id, string Code);
public sealed record FinanceTreasuryOptionsResponse(IReadOnlyList<FinanceTreasuryAirlineOptionResponse> Airlines, IReadOnlyList<FinanceTreasuryStationOptionResponse> Stations);
