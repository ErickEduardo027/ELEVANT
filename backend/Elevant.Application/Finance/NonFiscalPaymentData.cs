namespace Elevant.Application.Finance;

public sealed record NonFiscalPaymentData(
    Guid Id, Guid InvoiceId, string Reference, string CurrencyCode,
    decimal Amount, DateTimeOffset RecordedAt);

public sealed record NonFiscalPaymentLookupData(
    Guid InvoiceId, NonFiscalPaymentData? Payment, string InvoiceNumber = "");
