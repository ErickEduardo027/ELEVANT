using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace Elevant.Contracts.Finance;

/// <summary>
/// ADR-0036: the airline pays the whole balance of its invoice with a simulated card. The card number and
/// the security code are never stored or logged; only the brand and the last four digits are kept.
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record PayInvoiceByCardBody
{
    [Required, StringLength(80, MinimumLength = 2)]
    public string CardholderName { get; init; } = string.Empty;

    [Required, StringLength(23, MinimumLength = 12)]
    public string CardNumber { get; init; } = string.Empty;

    [Range(1, 12)]
    public int ExpiryMonth { get; init; }

    [Range(2000, 2099)]
    public int ExpiryYear { get; init; }

    [Required, StringLength(4, MinimumLength = 3)]
    public string SecurityCode { get; init; } = string.Empty;

    [Range(0.01, 100000000)]
    public decimal Amount { get; init; }
}

/// <param name="Status">Approved, Declined or Error (retry with a new key).</param>
public sealed record CardPaymentAttemptResponse(Guid Id, Guid InvoiceId, string Status, string Brand, string Last4,
    decimal Amount, string CurrencyCode, string? AuthorizationCode, string? DeclineCode, Guid? ReceiptId,
    DateTimeOffset AttemptedAt);

public sealed record CardPaymentResponse(CardPaymentAttemptResponse Attempt, decimal InvoiceBalance, bool Replayed);

public sealed record CardPaymentListResponse(Guid InvoiceId, IReadOnlyList<CardPaymentAttemptResponse> Attempts);

/// <summary>
/// 4-N05: whether the airline may pay by card in this environment, and whether the gateway is the simulation
/// («Simulación — sin validez fiscal»). A simulated gateway is always available.
/// </summary>
public sealed record CardPaymentAvailabilityResponse(bool Available, bool Simulated);
