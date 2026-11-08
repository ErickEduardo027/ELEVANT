namespace Elevant.Application.Abstractions.Finance;
public enum FinanceTreasuryFailure { Forbidden, NotFound, Invalid, Conflict }
/// <summary>
/// The outcome of a treasury command. <see cref="Code"/> names the cause of a failure when the store knows it
/// (<c>effective_before_invoice</c>, <c>effective_before_receipt</c>, <c>version_conflict</c>, phase 4); the API answers
/// the failure's default code otherwise.
/// </summary>
public sealed record FinanceTreasuryResult(Guid? Id, string? Version, bool Replayed, FinanceTreasuryFailure? Failure,
    string? Code = null)
{
    public bool IsSuccess => Failure is null;
    public static FinanceTreasuryResult Failed(FinanceTreasuryFailure failure, string? code = null) =>
        new(null, null, false, failure, code);
}
public sealed record FinanceTreasuryReceiptInput(Guid RequestId, Guid AirlineId, Guid StationId, string CurrencyCode,
    decimal Amount, string Reference, string Method, DateOnly ReceivedOn, string Reason);
public sealed record FinanceTreasuryAllocationInput(Guid InvoiceId, string ExpectedInvoiceVersion, decimal ReceiptAmount);
public sealed record FinanceTreasuryApplyInput(Guid RequestId, string ExpectedVersion, DateOnly EffectiveOn, string Reason,
    IReadOnlyList<FinanceTreasuryAllocationInput> Applications);
public sealed record FinanceTreasuryReverseInput(Guid RequestId, string ExpectedVersion, DateOnly EffectiveOn, string Reason,
    Guid? ApplicationId = null);
public sealed record FinanceTreasuryRefundInput(Guid RequestId, string ExpectedVersion, DateOnly EffectiveOn, string Reason,
    decimal Amount, string Reference);
public sealed record FinanceTreasuryAdjustmentLineInput(Guid InvoiceLineId, decimal Quantity, decimal Amount);
public sealed record FinanceTreasuryAdjustmentInput(Guid RequestId, string ExpectedVersion, DateOnly EffectiveOn, string Reason,
    string Kind, IReadOnlyList<FinanceTreasuryAdjustmentLineInput> Lines, Guid? RelatedNoteId = null);
public sealed record FinanceTreasuryMovementData(Guid Id, string Kind, Guid? InvoiceId, Guid? ReversesId, DateOnly EffectiveOn,
    decimal ReceiptAmount, decimal InvoiceAmount, string ReceiptCurrency, string? InvoiceCurrency, decimal ExchangeRate,
    DateOnly ExchangeRateOn, string Reference, string Reason, Guid ActorId, DateTimeOffset RecordedAt);
public sealed record FinanceTreasuryReceiptData(Guid Id, Guid AirlineId, Guid StationId, string CurrencyCode, decimal Amount,
    string Reference, string Method, DateOnly ReceivedOn, decimal Applied, decimal Refunded, decimal Available, bool Reversed,
    string Reason, Guid ActorId, DateTimeOffset RecordedAt, string Version, IReadOnlyList<FinanceTreasuryMovementData> Movements);
public sealed record FinanceTreasuryReceiptPageData(int Page, int Limit, bool HasMore, IReadOnlyList<FinanceTreasuryReceiptData> Items);
public sealed record FinanceTreasuryAdjustmentLineData(Guid InvoiceLineId, decimal Quantity, decimal Amount);
public sealed record FinanceTreasuryAdjustmentData(Guid Id, string Number, Guid InvoiceId, Guid? RelatedNoteId, string Kind,
    string CurrencyCode, decimal Amount, DateOnly EffectiveOn, string Reason, Guid ActorId, DateTimeOffset RecordedAt,
    IReadOnlyList<FinanceTreasuryAdjustmentLineData> Lines);
public sealed record FinanceTreasuryLineLimitData(Guid InvoiceLineId, int LineNumber, decimal Quantity, decimal Amount,
    decimal CreditQuantityRemaining, decimal CreditAmountRemaining, decimal DebitQuantityRemaining, decimal DebitAmountRemaining);
public sealed record FinanceTreasuryAdjustmentsData(Guid InvoiceId, string Version, decimal LegacyCredited,
    IReadOnlyList<FinanceTreasuryLineLimitData> Lines, IReadOnlyList<FinanceTreasuryAdjustmentData> Notes);
public sealed record FinanceTreasuryStatementInvoiceData(Guid Id, string Number, Guid AirlineId, Guid StationId,
    string CurrencyCode, decimal Total, decimal LegacyPaid, decimal LegacyCredited, decimal Applied, decimal Credited,
    decimal Debited, decimal Balance, DateOnly? DueDate, int DaysOverdue, string AgingBucket, string Version);
public sealed record FinanceTreasuryStatementMovementData(Guid Id, Guid? ReceiptId, Guid? InvoiceId, string Kind,
    string CurrencyCode, decimal Amount, DateOnly EffectiveOn, DateTimeOffset RecordedAt, Guid? ReversesId, string Reference);
public sealed record FinanceTreasuryAgingData(string CurrencyCode, decimal Balance, decimal Current, decimal Days1To30,
    decimal Days31To60, decimal Days61To90, decimal Days91Plus, decimal Unallocated, decimal CreditBalance);
public sealed record FinanceTreasuryStatementData(DateOnly AsOf, IReadOnlyList<FinanceTreasuryStatementInvoiceData> Invoices,
    IReadOnlyList<FinanceTreasuryReceiptData> Receipts, IReadOnlyList<FinanceTreasuryStatementMovementData> Movements,
    IReadOnlyList<FinanceTreasuryAgingData> Aging);

public sealed record FinanceTreasuryAirlineOptionData(Guid Id, string Name);
public sealed record FinanceTreasuryStationOptionData(Guid Id, string Code);
public sealed record FinanceTreasuryOptionsData(IReadOnlyList<FinanceTreasuryAirlineOptionData> Airlines, IReadOnlyList<FinanceTreasuryStationOptionData> Stations);
