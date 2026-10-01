namespace Elevant.Contracts.Finance;

public sealed record RecordNonFiscalPaymentRequest(
    Guid InvoiceId, Guid RequestId, string Reference);

public sealed record RecordNonFiscalPaymentResponse(
    Guid Id, Guid InvoiceId, string Reference, string CurrencyCode,
    decimal Amount, bool Replayed);

public sealed record NonFiscalPaymentResponse(
    Guid Id, Guid InvoiceId, string Reference, string CurrencyCode,
    decimal Amount, DateTimeOffset RecordedAt);

public sealed record NonFiscalPaymentLookupResponse(
    Guid InvoiceId, NonFiscalPaymentResponse? Payment);
