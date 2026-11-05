using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Commercial;

/// <summary>
/// One simulated card payment attempt from the airline portal (ADR-0036). It keeps only the brand and
/// the last four digits: never the card number, the security code or the cardholder name. An approved
/// attempt points to the treasury receipt that paid the invoice.
/// </summary>
public sealed class CardPaymentAttempt : AuditableEntity
{
    public long InvoiceId { get; set; }

    public long AirlineId { get; set; }

    public long AccountId { get; set; }

    public Guid IdempotencyKey { get; set; }

    /// <summary>SHA-256 of what the attempt asked for, without card data, to detect a reused key.</summary>
    public string RequestHash { get; set; } = string.Empty;

    public decimal Amount { get; set; }

    public string CurrencyCode { get; set; } = string.Empty;

    public string Brand { get; set; } = string.Empty;

    public string Last4 { get; set; } = string.Empty;

    public CardPaymentStatus Status { get; set; }

    public string? DeclineCode { get; set; }

    public string? AuthorizationCode { get; set; }

    public long? ReceiptId { get; set; }
}
