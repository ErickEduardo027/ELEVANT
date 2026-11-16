using System.Security.Cryptography;
using Elevant.Application.Finance;
using Elevant.Domain.Enumerations;

namespace Elevant.Infrastructure.Finance;

/// <summary>
/// Deterministic card processor for Development and demos (ADR-0036). No network call is made and the
/// card number is only compared in memory. The test cards and their outcomes are documented in the ADR.
/// </summary>
public sealed class SimulatedCardGateway : ICardPaymentGateway
{
    private static readonly Dictionary<string, (CardPaymentStatus Status, string? Decline)> Outcomes = new(StringComparer.Ordinal)
    {
        ["4111111111111111"] = (CardPaymentStatus.Approved, null),
        ["5555555555554444"] = (CardPaymentStatus.Approved, null),
        ["4000000000000002"] = (CardPaymentStatus.Declined, "insufficient_funds"),
        ["4000000000000069"] = (CardPaymentStatus.Declined, "expired_card"),
        ["4000000000000119"] = (CardPaymentStatus.Error, "processing_error"),
    };

    public CardAuthorization Authorize(CardCharge charge)
    {
        ArgumentNullException.ThrowIfNull(charge);
        var digits = CardPaymentPolicy.Digits(charge.CardNumber);
        var (status, decline) = Outcomes.TryGetValue(digits, out var outcome)
            ? outcome : (CardPaymentStatus.Declined, "card_not_accepted");
        return status == CardPaymentStatus.Approved
            ? new CardAuthorization(status, AuthorizationCode(), null)
            : new CardAuthorization(status, null, decline);
    }

    private static string AuthorizationCode()
    {
        const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        return new string(RandomNumberGenerator.GetBytes(6).Select(value => alphabet[value % alphabet.Length]).ToArray());
    }
}
