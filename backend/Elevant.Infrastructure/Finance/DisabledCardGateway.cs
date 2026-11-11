using Elevant.Application.Finance;

namespace Elevant.Infrastructure.Finance;

/// <summary>
/// 4-N05: the card gateway of an environment without a card processor (the default, and always in Production until a
/// tokenized provider is approved). The payment handler refuses with <c>card_payments_unavailable</c> before any
/// gateway is reached; this gateway throws as a second guard, so a card can never be approved by mistake.
/// </summary>
public sealed class DisabledCardGateway : ICardPaymentGateway
{
    public CardAuthorization Authorize(CardCharge charge) =>
        throw new InvalidOperationException("No card gateway is configured in this environment.");
}
