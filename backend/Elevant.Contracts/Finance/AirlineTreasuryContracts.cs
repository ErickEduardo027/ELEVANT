namespace Elevant.Contracts.Finance;
public sealed record AirlineTreasuryInvoiceResponse(Guid Id, Guid PreinvoiceId, string Number, Guid StationId, string StationCode,
    string CurrencyCode, decimal Total, decimal LegacyPaid, decimal LegacyCredited, decimal Applied, decimal Credited,
    decimal Debited, decimal Balance, DateOnly? DueDate, int DaysOverdue, string AgingBucket, string? FiscalNumber = null);
public sealed record AirlineTreasuryMovementResponse(Guid Id, Guid? ReceiptId, Guid? InvoiceId, string Kind, string CurrencyCode,
    decimal Amount, DateOnly EffectiveOn, DateTimeOffset RecordedAt, Guid? ReversesId, string Reference);
public sealed record AirlineTreasuryReceiptMovementResponse(Guid Id, string Kind, Guid? InvoiceId, Guid? ReversesId,
    DateOnly EffectiveOn, decimal ReceiptAmount, decimal InvoiceAmount, string ReceiptCurrency, string? InvoiceCurrency,
    decimal ExchangeRate, DateOnly ExchangeRateOn, string Reference, string Reason, DateTimeOffset RecordedAt);
public sealed record AirlineTreasuryReceiptResponse(Guid Id, Guid StationId, string StationCode, string Reference,
    string CurrencyCode, decimal Amount, decimal Applied, decimal Refunded, decimal Available, bool Reversed,
    string Method, DateOnly ReceivedOn, IReadOnlyList<AirlineTreasuryReceiptMovementResponse> Movements);
public sealed record AirlineTreasuryAdjustmentLineResponse(Guid InvoiceLineId, decimal Quantity, decimal Amount);
public sealed record AirlineTreasuryAdjustmentResponse(Guid Id, string Number, Guid InvoiceId, Guid? RelatedNoteId, string Kind,
    string CurrencyCode, decimal Amount, DateOnly EffectiveOn, string Reason, DateTimeOffset RecordedAt,
    IReadOnlyList<AirlineTreasuryAdjustmentLineResponse> Lines);
public sealed record AirlineTreasuryAdjustmentsResponse(Guid InvoiceId, string Number, string CurrencyCode,
    decimal LegacyCredited, IReadOnlyList<AirlineTreasuryAdjustmentResponse> Notes);
public sealed record AirlineTreasuryInvoiceLineResponse(Guid Id, int LineNumber, string Kind, int? ParentLineNumber, string OperationCode,
    DateOnly OperationDate, string ServiceCode, string ServiceName, decimal Quantity, string BillingUnit, decimal UnitPrice, decimal Amount, string? Reason);
public sealed record AirlineTreasuryInvoiceDetailResponse(AirlineTreasuryInvoiceResponse Invoice,
    IReadOnlyList<AirlineTreasuryInvoiceLineResponse> Lines, IReadOnlyList<AirlineTreasuryMovementResponse> Movements,
    IReadOnlyList<AirlineTreasuryAdjustmentResponse> Notes);
public sealed record AirlineTreasuryAgingResponse(string CurrencyCode, decimal Balance, decimal Current, decimal Days1To30,
    decimal Days31To60, decimal Days61To90, decimal Days91Plus, decimal Unallocated, decimal CreditBalance);
public sealed record AirlineTreasuryStatementResponse(Guid AirlineId, DateOnly AsOf, IReadOnlyList<AirlineTreasuryInvoiceResponse> Invoices,
    IReadOnlyList<AirlineTreasuryReceiptResponse> Receipts, IReadOnlyList<AirlineTreasuryMovementResponse> Movements,
    IReadOnlyList<AirlineTreasuryAgingResponse> Aging);
