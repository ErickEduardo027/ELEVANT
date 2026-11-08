using Elevant.Application.Finance;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Finance;

namespace Elevant.UnitTests.Application;

public sealed class CardPaymentPolicyTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 5, 12, 0, 0, TimeSpan.Zero);

    private static PayInvoiceByCardRequest Request(string number = "4111 1111 1111 1111", int month = 12, int year = 2030,
        string cvv = "123", decimal amount = 118m, string name = "Casey Airline") =>
        new(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), name, number, month, year, cvv, amount);

    [Theory]
    [InlineData("4111111111111111", true)]
    [InlineData("5555555555554444", true)]
    [InlineData("4000000000000002", true)]
    [InlineData("4000000000000069", true)]
    [InlineData("4000000000000119", true)]
    [InlineData("4111111111111112", false)]
    [InlineData("41111111111", false)]
    public void LuhnRecognizesTheTestCards(string digits, bool valid) => Assert.Equal(valid, CardPaymentPolicy.IsLuhnValid(digits));

    [Theory]
    [InlineData("4111111111111111", "Visa")]
    [InlineData("5555555555554444", "Mastercard")]
    [InlineData("2223003122003222", "Mastercard")]
    [InlineData("378282246310005", "Amex")]
    [InlineData("6011111111111117", "Discover")]
    public void BrandComesFromThePrefix(string digits, string brand) => Assert.Equal(brand, CardPaymentPolicy.Brand(digits));

    [Fact]
    public void ACardIsValidThroughTheLastDayOfItsExpiryMonth()
    {
        Assert.True(CardPaymentPolicy.IsNotExpired(11, 2026, Now));
        Assert.False(CardPaymentPolicy.IsNotExpired(10, 2026, Now));
        Assert.False(CardPaymentPolicy.IsNotExpired(13, 2030, Now));
    }

    /// <summary>4-N10: at 21:30 of 30/11 in Santo Domingo a card of 11/26 is still valid; the UTC day is already 1/12.</summary>
    [Fact]
    public void ACardExpiresWithTheBusinessDayInSantoDomingo()
    {
        Assert.True(CardPaymentPolicy.IsNotExpired(11, 2026, new DateTimeOffset(2026, 12, 1, 1, 30, 0, TimeSpan.Zero)));
        Assert.False(CardPaymentPolicy.IsNotExpired(11, 2026, new DateTimeOffset(2026, 12, 1, 4, 30, 0, TimeSpan.Zero)));
    }

    [Fact]
    public void ValidationReturnsEveryReasonWithoutTouchingTheGateway()
    {
        Assert.Empty(CardPaymentPolicy.Validate(Request(), Now));
        Assert.Equal(["cardholder_invalid", "card_number_invalid", "card_expired", "security_code_invalid", "amount_invalid"],
            CardPaymentPolicy.Validate(Request("4111111111111112", 1, 2020, "12", 0.001m, " "), Now));
        Assert.Contains("security_code_invalid", CardPaymentPolicy.Validate(Request("378282246310005", cvv: "123"), Now));
        Assert.Empty(CardPaymentPolicy.Validate(Request("3782 8224 6310 005", cvv: "1234"), Now));
    }

    [Fact]
    public void RequestHashNeverContainsTheCardAndChangesWithTheBody()
    {
        var invoice = Guid.NewGuid();
        var hash = CardPaymentPolicy.RequestHash(invoice, 118m, "Visa", "1111");
        Assert.Equal(64, hash.Length);
        Assert.DoesNotContain("4111", hash, StringComparison.Ordinal);
        Assert.Equal(hash, CardPaymentPolicy.RequestHash(invoice, 118.00m, "Visa", "1111"));
        Assert.NotEqual(hash, CardPaymentPolicy.RequestHash(invoice, 118.01m, "Visa", "1111"));
    }

    [Theory]
    [InlineData("4111111111111111", CardPaymentStatus.Approved, null)]
    [InlineData("5555 5555 5555 4444", CardPaymentStatus.Approved, null)]
    [InlineData("4000000000000002", CardPaymentStatus.Declined, "insufficient_funds")]
    [InlineData("4000000000000069", CardPaymentStatus.Declined, "expired_card")]
    [InlineData("4000000000000119", CardPaymentStatus.Error, "processing_error")]
    [InlineData("4242424242424242", CardPaymentStatus.Declined, "card_not_accepted")]
    public void SimulatedGatewayAnswersEachTestCard(string number, CardPaymentStatus status, string? decline)
    {
        var result = new SimulatedCardGateway().Authorize(new CardCharge(number, 12, 2030, "123", 118m, "USD"));
        Assert.Equal(status, result.Status);
        Assert.Equal(decline, result.DeclineCode);
        if (status == CardPaymentStatus.Approved) Assert.Matches("^[A-Z2-9]{6}$", result.AuthorizationCode!);
        else Assert.Null(result.AuthorizationCode);
    }

    [Fact]
    public async Task HandlerRejectsAnInvalidCardBeforeTheStore()
    {
        var store = new Store();
        var handler = new PayInvoiceByCardHandler(store, new FixedTime(Now));
        var ct = TestContext.Current.CancellationToken;
        var invalid = await handler.HandleAsync(Request("4111111111111112"), ct);
        Assert.Equal(CardPaymentFailure.InvalidRequest, invalid.Failure);
        Assert.Equal(["card_number_invalid"], invalid.Reasons);
        Assert.Equal(CardPaymentFailure.Unauthorized, (await handler.HandleAsync(Request() with { AccountId = Guid.Empty }, ct)).Failure);
        Assert.Equal(0, store.Calls);
        await handler.HandleAsync(Request(), ct);
        Assert.Equal(1, store.Calls);
    }

    private sealed class FixedTime(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private sealed class Store : ICardPaymentStore
    {
        public int Calls { get; private set; }

        public Task<CardPaymentResult> PayAsync(PayInvoiceByCardRequest request, CancellationToken cancellationToken = default)
        {
            Calls++;
            return Task.FromResult(CardPaymentResult.Failed(CardPaymentFailure.NotFound));
        }

        public Task<IReadOnlyList<CardPaymentAttemptData>?> AirlineAttemptsAsync(Guid accountId, Guid invoiceId,
            CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<CardPaymentAttemptData>?>(null);

        public Task<IReadOnlyList<CardPaymentAttemptData>?> FinanceAttemptsAsync(Guid accountId, Guid invoiceId,
            CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<CardPaymentAttemptData>?>(null);

        public Task<CardPaymentReceiptData?> AirlineReceiptAsync(Guid accountId, Guid attemptId,
            CancellationToken cancellationToken = default) => Task.FromResult<CardPaymentReceiptData?>(null);
    }
}
