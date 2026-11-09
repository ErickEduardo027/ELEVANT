using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Finance;

/// <summary>
/// Simulated card payment of an invoice from the airline portal (ADR-0036). The card is checked here
/// (Luhn, expiry, security code) and authorized by <see cref="ICardPaymentGateway"/>; only the brand and the
/// last four digits are kept. A real deployment would use a provider's tokenized form instead.
/// </summary>
public static class CardPaymentPolicy
{
    public const int MaxCardholderLength = 80;

    public static string Digits(string? cardNumber) =>
        new((cardNumber ?? string.Empty).Where(character => character is not (' ' or '-')).ToArray());

    public static bool IsLuhnValid(string digits)
    {
        if (digits.Length is < 12 or > 19 || !digits.All(char.IsAsciiDigit)) return false;
        var sum = 0;
        for (var index = 0; index < digits.Length; index++)
        {
            var value = digits[digits.Length - 1 - index] - '0';
            if (index % 2 == 1) value = value * 2 > 9 ? value * 2 - 9 : value * 2;
            sum += value;
        }
        return sum % 10 == 0;
    }

    public static string Brand(string digits) => digits switch
    {
        _ when digits.StartsWith('4') => "Visa",
        _ when digits.Length >= 2 && int.Parse(digits[..2], CultureInfo.InvariantCulture) is >= 51 and <= 55 => "Mastercard",
        _ when digits.Length >= 4 && int.Parse(digits[..4], CultureInfo.InvariantCulture) is >= 2221 and <= 2720 => "Mastercard",
        _ when digits.StartsWith("34", StringComparison.Ordinal) || digits.StartsWith("37", StringComparison.Ordinal) => "Amex",
        _ when digits.StartsWith("6011", StringComparison.Ordinal) || digits.StartsWith("65", StringComparison.Ordinal) => "Discover",
        _ => "Tarjeta",
    };

    /// <summary>
    /// The card is valid through the last day of its expiry month, by AVIAM's business day in Santo Domingo (4-N10):
    /// at 21:30 of the last day it is still valid although the UTC day is the next month.
    /// </summary>
    public static bool IsNotExpired(int month, int year, DateTimeOffset now) =>
        month is >= 1 and <= 12 && year is >= 2000 and <= 2099 &&
        new DateOnly(year, month, 1).AddMonths(1) > Common.BusinessCalendar.Today(now);

    public static bool IsValidSecurityCode(string? code, string brand) =>
        code is not null && code.All(char.IsAsciiDigit) && code.Length == (brand == "Amex" ? 4 : 3);

    /// <summary>What the attempt asked for, without card data, so a reused key with another body is detected.</summary>
    public static string RequestHash(Guid invoiceId, decimal amount, string brand, string last4) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
            $"{invoiceId:D}|{amount.ToString("0.00##", CultureInfo.InvariantCulture)}|{brand}|{last4}"))).ToLowerInvariant();

    /// <summary>Checks the card before it reaches the gateway; the reasons go back in Problem Details.</summary>
    public static IReadOnlyList<string> Validate(PayInvoiceByCardRequest request, DateTimeOffset now)
    {
        var reasons = new List<string>();
        var digits = Digits(request.CardNumber);
        if (string.IsNullOrWhiteSpace(request.CardholderName) || request.CardholderName.Trim().Length is < 2 or > MaxCardholderLength)
            reasons.Add("cardholder_invalid");
        if (!IsLuhnValid(digits)) reasons.Add("card_number_invalid");
        if (!IsNotExpired(request.ExpiryMonth, request.ExpiryYear, now)) reasons.Add("card_expired");
        if (!IsValidSecurityCode(request.SecurityCode, IsLuhnValid(digits) ? Brand(digits) : "Tarjeta")) reasons.Add("security_code_invalid");
        if (request.Amount <= 0 || decimal.Round(request.Amount, 2) != request.Amount) reasons.Add("amount_invalid");
        return reasons;
    }
}

public sealed record PayInvoiceByCardRequest(Guid AccountId, Guid InvoiceId, Guid IdempotencyKey, string? CardholderName,
    string? CardNumber, int ExpiryMonth, int ExpiryYear, string? SecurityCode, decimal Amount);

/// <summary>What the gateway receives: the card is never persisted or logged.</summary>
public sealed record CardCharge(string CardNumber, int ExpiryMonth, int ExpiryYear, string SecurityCode, decimal Amount,
    string CurrencyCode);

public sealed record CardAuthorization(CardPaymentStatus Status, string? AuthorizationCode, string? DeclineCode);

/// <summary>Card processor port; Development uses a deterministic simulator with test cards.</summary>
public interface ICardPaymentGateway
{
    CardAuthorization Authorize(CardCharge charge);
}

/// <summary>
/// 4-N05: which card processor the API composes, from <c>CardPayments:Mode</c>. Disabled is the default; the simulated
/// gateway (ADR-0036) only runs in Development or Test, and any other environment refuses to start with it.
/// </summary>
public enum CardPaymentMode
{
    Disabled,
    Simulated,
}

/// <summary>
/// 4-N05: whether the airline portal may pay by card, and whether the gateway is the simulation («Simulación — sin
/// validez fiscal»). Without a gateway every payment is refused with <c>card_payments_unavailable</c>.
/// </summary>
public sealed record CardPaymentAvailability(bool Available, bool Simulated)
{
    public static CardPaymentAvailability Disabled { get; } = new(false, false);

    public static CardPaymentAvailability SimulatedGateway { get; } = new(true, true);
}

/// <summary>Problem Details codes of the card payment (phase 4, block C).</summary>
public static class CardPaymentCodes
{
    /// <summary>4-N05: no card gateway is configured in this environment.</summary>
    public const string Unavailable = "card_payments_unavailable";

    /// <summary>The card or the request is invalid; <c>reasons</c> name each rule.</summary>
    public const string Invalid = "card_payment_invalid";

    /// <summary>The invoice cannot be paid with this request and no reason names why.</summary>
    public const string Conflict = "card_payment_conflict";
}

public enum CardPaymentFailure
{
    Unauthorized,
    Forbidden,
    InvalidRequest,
    NotFound,
    Conflict,
    /// <summary>4-N05: no card gateway in this environment.</summary>
    Unavailable,
}

public sealed record CardPaymentAttemptData(Guid Id, Guid InvoiceId, string Status, string Brand, string Last4, decimal Amount,
    string CurrencyCode, string? AuthorizationCode, string? DeclineCode, Guid? ReceiptId, DateTimeOffset AttemptedAt);

public sealed record CardPaymentResult(CardPaymentAttemptData? Attempt, decimal? InvoiceBalance, bool Replayed,
    CardPaymentFailure? Failure, IReadOnlyList<string> Reasons)
{
    public bool IsSuccess => Attempt is not null && Failure is null;

    public static CardPaymentResult Failed(CardPaymentFailure failure, params string[] reasons) =>
        new(null, null, false, failure, reasons);
}

/// <summary>The simulated receipt of an approved card payment.</summary>
public sealed record CardPaymentReceiptData(Guid AttemptId, string AirlineName, string InvoiceNumber, string? FiscalNumber,
    string Brand, string Last4, string AuthorizationCode, decimal Amount, string CurrencyCode, DateTimeOffset PaidAt,
    string ReceiptReference);

public interface ICardPaymentStore
{
    Task<CardPaymentResult> PayAsync(PayInvoiceByCardRequest request, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<CardPaymentAttemptData>?> AirlineAttemptsAsync(Guid accountId, Guid invoiceId,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<CardPaymentAttemptData>?> FinanceAttemptsAsync(Guid accountId, Guid invoiceId,
        CancellationToken cancellationToken = default);

    Task<CardPaymentReceiptData?> AirlineReceiptAsync(Guid accountId, Guid attemptId, CancellationToken cancellationToken = default);
}

/// <summary>
/// Validates the card and the request before the store and the gateway see them. 4-N05: without a gateway the payment
/// is refused with <c>card_payments_unavailable</c> before the card is even checked.
/// </summary>
public sealed class PayInvoiceByCardHandler(ICardPaymentStore store, TimeProvider timeProvider,
    CardPaymentAvailability availability)
{
    public async Task<CardPaymentResult> HandleAsync(PayInvoiceByCardRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (request.AccountId == Guid.Empty) return CardPaymentResult.Failed(CardPaymentFailure.Unauthorized);
        if (!availability.Available)
            return CardPaymentResult.Failed(CardPaymentFailure.Unavailable, CardPaymentCodes.Unavailable);
        if (request.IdempotencyKey == Guid.Empty)
            return CardPaymentResult.Failed(CardPaymentFailure.InvalidRequest, "idempotency_key_required");
        if (request.InvoiceId == Guid.Empty) return CardPaymentResult.Failed(CardPaymentFailure.InvalidRequest);
        var reasons = CardPaymentPolicy.Validate(request, timeProvider.GetUtcNow());
        if (reasons.Count > 0) return CardPaymentResult.Failed(CardPaymentFailure.InvalidRequest, [.. reasons]);
        return await store.PayAsync(request, cancellationToken);
    }
}

/// <summary>
/// 4-N05: tells the airline portal whether it may offer the card payment and whether the gateway is the simulation.
/// Only an airline portal session reads it; anything else is forbidden.
/// </summary>
public sealed class CardPaymentAvailabilityHandler(Abstractions.Identity.IActorContextResolver actors,
    CardPaymentAvailability availability)
{
    public async Task<CardPaymentAvailability?> HandleAsync(Guid accountId, CancellationToken cancellationToken = default)
    {
        if (accountId == Guid.Empty) return null;
        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        return Abstractions.Finance.FinanceTreasuryPortalAccess.OrganizationId(actor, accountId) is null ? null : availability;
    }
}
