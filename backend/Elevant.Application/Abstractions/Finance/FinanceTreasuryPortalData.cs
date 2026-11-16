namespace Elevant.Application.Abstractions.Finance;
public sealed record AirlineTreasuryReadResult<T>(T? Data, FinanceTreasuryFailure? Failure) where T : class
{
    public bool IsSuccess => Data is not null && Failure is null;
}
public sealed record AirlineTreasuryInvoiceData(Guid Id, Guid PreinvoiceId, string Number, Guid StationId, string StationCode,
    string CurrencyCode, decimal Total, decimal LegacyPaid, decimal LegacyCredited, decimal Applied, decimal Credited,
    decimal Debited, decimal Balance, DateOnly? DueDate, int DaysOverdue, string AgingBucket, string? FiscalNumber = null);
public sealed record AirlineTreasuryMovementData(Guid Id, Guid? ReceiptId, Guid? InvoiceId, string Kind, string CurrencyCode,
    decimal Amount, DateOnly EffectiveOn, DateTimeOffset RecordedAt, Guid? ReversesId, string Reference);
public sealed record AirlineTreasuryReceiptMovementData(Guid Id, string Kind, Guid? InvoiceId, Guid? ReversesId,
    DateOnly EffectiveOn, decimal ReceiptAmount, decimal InvoiceAmount, string ReceiptCurrency, string? InvoiceCurrency,
    decimal ExchangeRate, DateOnly ExchangeRateOn, string Reference, string Reason, DateTimeOffset RecordedAt);
public sealed record AirlineTreasuryReceiptData(Guid Id, Guid StationId, string StationCode, string Reference,
    string CurrencyCode, decimal Amount, decimal Applied, decimal Refunded, decimal Available, bool Reversed,
    string Method, DateOnly ReceivedOn, IReadOnlyList<AirlineTreasuryReceiptMovementData> Movements);
public sealed record AirlineTreasuryAdjustmentLineData(Guid InvoiceLineId, decimal Quantity, decimal Amount);
public sealed record AirlineTreasuryAdjustmentData(Guid Id, string Number, Guid InvoiceId, Guid? RelatedNoteId, string Kind,
    string CurrencyCode, decimal Amount, DateOnly EffectiveOn, string Reason, DateTimeOffset RecordedAt,
    IReadOnlyList<AirlineTreasuryAdjustmentLineData> Lines);
public sealed record AirlineTreasuryAdjustmentsData(Guid InvoiceId, string Number, string CurrencyCode,
    decimal LegacyCredited, IReadOnlyList<AirlineTreasuryAdjustmentData> Notes);
public sealed record AirlineTreasuryInvoiceLineData(Guid Id, int LineNumber, string Kind, int? ParentLineNumber, string OperationCode,
    DateOnly OperationDate, string ServiceCode, string ServiceName, decimal Quantity, string BillingUnit, decimal UnitPrice, decimal Amount, string? Reason);
public sealed record AirlineTreasuryInvoiceDetailData(AirlineTreasuryInvoiceData Invoice,
    IReadOnlyList<AirlineTreasuryInvoiceLineData> Lines, IReadOnlyList<AirlineTreasuryMovementData> Movements,
    IReadOnlyList<AirlineTreasuryAdjustmentData> Notes);
public sealed record AirlineTreasuryAgingData(string CurrencyCode, decimal Balance, decimal Current, decimal Days1To30,
    decimal Days31To60, decimal Days61To90, decimal Days91Plus, decimal Unallocated, decimal CreditBalance);
public sealed record AirlineTreasuryStatementData(Guid AirlineId, DateOnly AsOf, IReadOnlyList<AirlineTreasuryInvoiceData> Invoices,
    IReadOnlyList<AirlineTreasuryReceiptData> Receipts, IReadOnlyList<AirlineTreasuryMovementData> Movements,
    IReadOnlyList<AirlineTreasuryAgingData> Aging);
