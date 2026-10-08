namespace Elevant.Contracts.Finance;

/// <summary>Amount defaults to the remaining balance; Method is Transfer, Check, Cash or Other.</summary>
public sealed record RecordNonFiscalPaymentRequest(
    Guid InvoiceId, Guid RequestId, string Reference,
    decimal? Amount = null, string? Method = null, DateOnly? PaidOn = null);

public sealed record RecordNonFiscalPaymentResponse(
    Guid Id, Guid InvoiceId, string Reference, string CurrencyCode,
    decimal Amount, bool Replayed);

public sealed record NonFiscalPaymentResponse(
    Guid Id, Guid InvoiceId, string Reference, string CurrencyCode,
    decimal Amount, DateTimeOffset RecordedAt);

public sealed record NonFiscalPaymentLookupResponse(
    Guid InvoiceId, NonFiscalPaymentResponse? Payment);
