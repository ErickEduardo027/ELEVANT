namespace Elevant.Application.Finance;

/// <summary>
/// A recorded payment and what its receipt prints: the payer, the method, the day it was paid, the invoice it settles
/// (its e-NCF when it has one), the invoice total and the balance left on <paramref name="BalanceOn"/>.
/// </summary>
public sealed record NonFiscalPaymentData(
    Guid Id, Guid InvoiceId, string Reference, string CurrencyCode,
    decimal Amount, DateTimeOffset RecordedAt, string? PayerName = null, string? Method = null, DateOnly? PaidOn = null,
    string? InvoiceFiscalNumber = null, decimal? InvoiceTotal = null, decimal? Balance = null, DateOnly? BalanceOn = null);

public sealed record NonFiscalPaymentLookupData(
    Guid InvoiceId, NonFiscalPaymentData? Payment, string InvoiceNumber = "");
