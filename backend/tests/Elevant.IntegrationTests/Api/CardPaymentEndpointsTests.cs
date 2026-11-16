using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Finance;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

/// <summary>
/// 4-N05 through the real HTTP pipeline: the card gateway comes from <c>CardPayments:Mode</c>. By default there is none
/// and every payment is a coded 409 <c>card_payments_unavailable</c>; the simulated gateway only starts in Development
/// or Test; every refusal carries its code.
/// </summary>
public sealed class CardPaymentEndpointsTests(ElevantApiFactory factory) : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid Account = Guid.Parse("40000000-0000-7000-8000-000000000003");
    private const string Body = """
        {"cardholderName":"Casey Airline","cardNumber":"4111 1111 1111 1111","expiryMonth":12,"expiryYear":2030,"securityCode":"123","amount":118}
        """;

    [Fact]
    public async Task WithoutAGatewayThePortalSeesItUnavailableAndEveryPaymentIsRefused()
    {
        var store = new Store();
        await using var app = App(store, mode: null);
        using var client = Client(app);
        var ct = TestContext.Current.CancellationToken;
        using var availability = await client.GetAsync("/api/v1/airline/portal/card-payments/availability", ct);
        Assert.Equal(HttpStatusCode.OK, availability.StatusCode);
        var body = await availability.Content.ReadFromJsonAsync<JsonElement>(ct);
        Assert.Equal((false, false), (body.GetProperty("available").GetBoolean(), body.GetProperty("simulated").GetBoolean()));

        using var refused = await client.SendAsync(Pay(Guid.NewGuid().ToString("D")), ct);
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Equal("card_payments_unavailable", await CodeAsync(refused, ct));
        Assert.Equal(0, store.Calls);
    }

    [Fact]
    public async Task TheSimulatedGatewayRunsInTestAndEveryRefusalCarriesItsCode()
    {
        var store = new Store { Next = CardPaymentResult.Failed(CardPaymentFailure.Conflict, "invoice_paid") };
        await using var app = App(store, mode: "Simulated", environment: "Test");
        using var client = Client(app);
        var ct = TestContext.Current.CancellationToken;
        using var availability = await client.GetAsync("/api/v1/airline/portal/card-payments/availability", ct);
        var body = await availability.Content.ReadFromJsonAsync<JsonElement>(ct);
        Assert.Equal((true, true), (body.GetProperty("available").GetBoolean(), body.GetProperty("simulated").GetBoolean()));

        using var paid = await client.SendAsync(Pay(Guid.NewGuid().ToString("D")), ct);
        Assert.Equal((HttpStatusCode.Conflict, "invoice_paid"), (paid.StatusCode, await CodeAsync(paid, ct)));
        Assert.Equal(1, store.Calls);
        store.Next = CardPaymentResult.Failed(CardPaymentFailure.Conflict);
        using var conflict = await client.SendAsync(Pay(Guid.NewGuid().ToString("D")), ct);
        Assert.Equal("card_payment_conflict", await CodeAsync(conflict, ct));
        store.Next = CardPaymentResult.Failed(CardPaymentFailure.NotFound);
        using var missing = await client.SendAsync(Pay(Guid.NewGuid().ToString("D")), ct);
        Assert.Equal((HttpStatusCode.NotFound, "not_found"), (missing.StatusCode, await CodeAsync(missing, ct)));

        using var keyless = await client.SendAsync(Pay(null), ct);
        Assert.Equal((HttpStatusCode.BadRequest, "idempotency_key_required"), (keyless.StatusCode, await CodeAsync(keyless, ct)));
        using var malformed = await client.SendAsync(Pay(Guid.NewGuid().ToString("D"), """{"cardNumber":1}"""), ct);
        Assert.Equal((HttpStatusCode.BadRequest, "card_payment_invalid"), (malformed.StatusCode, await CodeAsync(malformed, ct)));
        using var invalid = await client.SendAsync(Pay(Guid.NewGuid().ToString("D"),
            Body.Replace("4111 1111 1111 1111", "4111 1111 1111 1112", StringComparison.Ordinal)), ct);
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        var text = await invalid.Content.ReadAsStringAsync(ct);
        using var problem = JsonDocument.Parse(text);
        Assert.Equal("card_payment_invalid", problem.RootElement.GetProperty("code").GetString());
        Assert.Equal("card_number_invalid", problem.RootElement.GetProperty("reasons")[0].GetString());
        // The card number never comes back, in any answer.
        Assert.DoesNotContain("4111", text, StringComparison.Ordinal);
        Assert.Equal(3, store.Calls);
    }

    [Theory]
    [InlineData("Production")]
    [InlineData("Staging")]
    public void TheSimulatedGatewayNeverStartsOutsideDevelopmentOrTest(string environment)
    {
        using var app = App(new Store(), mode: "Simulated", environment: environment);
        var refused = Assert.ThrowsAny<Exception>(() => app.CreateClient());
        Assert.Contains("simulated card gateway", refused.GetBaseException().Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task OnlyAnAirlinePortalSessionReadsTheAvailability()
    {
        await using var app = App(new Store(), mode: null, internalActor: true);
        using var client = Client(app);
        var ct = TestContext.Current.CancellationToken;
        using var forbidden = await client.GetAsync("/api/v1/airline/portal/card-payments/availability", ct);
        Assert.Equal((HttpStatusCode.Forbidden, "forbidden"), (forbidden.StatusCode, await CodeAsync(forbidden, ct)));
        using var anonymous = await app.CreateClient().GetAsync("/api/v1/airline/portal/card-payments/availability", ct);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
    }

    private WebApplicationFactory<Program> App(Store store, string? mode, string? environment = null,
        bool internalActor = false) =>
        factory.WithWebHostBuilder(builder =>
        {
            if (environment is not null) builder.UseSetting("DOTNET_ENVIRONMENT", environment);
            if (mode is not null) builder.UseSetting("CardPayments:Mode", mode);
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<ICardPaymentStore>();
                services.RemoveAll<IActorContextResolver>();
                services.AddSingleton<ICardPaymentStore>(store);
                services.AddSingleton<IActorContextResolver>(new Actors(internalActor));
            });
        });

    private static HttpClient Client(WebApplicationFactory<Program> app)
    {
        var client = app.CreateClient();
        var now = DateTimeOffset.UtcNow;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", new JsonWebTokenHandler()
            .CreateToken(new SecurityTokenDescriptor
            {
                Audience = ElevantApiFactory.AuthenticationAudience, Issuer = ElevantApiFactory.AuthenticationIssuer,
                Expires = now.AddMinutes(15).UtcDateTime, IssuedAt = now.UtcDateTime, NotBefore = now.AddSeconds(-5).UtcDateTime,
                SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(
                    Convert.FromBase64String(ElevantApiFactory.AuthenticationSigningKeyBase64)), SecurityAlgorithms.HmacSha256),
                Subject = new ClaimsIdentity([new Claim(JwtRegisteredClaimNames.Sub, Account.ToString("D")),
                    new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("D")),
                    new Claim(Elevant.Infrastructure.Authentication.SessionSecurityVersion.ClaimType,
                        Elevant.Infrastructure.Authentication.SessionSecurityVersion.Fingerprint(ElevantApiFactory.TestSecurityStamp))]),
                TokenType = "at+jwt",
            }));
        return client;
    }

    private static HttpRequestMessage Pay(string? key, string body = Body)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/airline/portal/invoices/{Guid.NewGuid():D}/card-payments")
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };
        if (key is not null) request.Headers.TryAddWithoutValidation("Idempotency-Key", key);
        return request;
    }

    private static async Task<string?> CodeAsync(HttpResponseMessage response, CancellationToken ct)
    {
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        return (await response.Content.ReadFromJsonAsync<JsonElement>(ct)).TryGetProperty("code", out var code)
            ? code.GetString() : null;
    }

    private sealed class Actors(bool internalActor) : IActorContextResolver
    {
        public Task<ActorContext?> ResolveAsync(Guid accountId, CancellationToken cancellationToken = default) =>
            Task.FromResult<ActorContext?>(internalActor
                ? new ActorContext(accountId, "finance@dev.elevant.test", "Finance",
                    [new ActorRole(Guid.NewGuid(), "FINANZAS", "Finanzas", PortalKind.BackOffice, "internal_staff")],
                    [new ActorMembership(Guid.NewGuid(), Guid.NewGuid(), "AVIAM", "AVIAM", OrganizationType.AviamOperator,
                        MembershipKind.InternalStaff)], [], null)
                : new ActorContext(accountId, "synthetic@airline.invalid", "Casey Airline",
                    [new ActorRole(Guid.NewGuid(), "AIRLINE_CLIENT", "Airline", PortalKind.AirlinePortal, "airline_client")],
                    [new ActorMembership(Guid.NewGuid(), Guid.NewGuid(), "QA", "QA Airline", OrganizationType.AirlineCustomer,
                        MembershipKind.AirlineClient)], [], null));
    }

    private sealed class Store : ICardPaymentStore
    {
        public int Calls { get; private set; }
        public CardPaymentResult Next { get; set; } = CardPaymentResult.Failed(CardPaymentFailure.NotFound);

        public Task<CardPaymentResult> PayAsync(PayInvoiceByCardRequest request, CancellationToken cancellationToken = default)
        {
            Calls++;
            return Task.FromResult(Next);
        }

        public Task<IReadOnlyList<CardPaymentAttemptData>?> AirlineAttemptsAsync(Guid accountId, Guid invoiceId,
            CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<CardPaymentAttemptData>?>(null);

        public Task<IReadOnlyList<CardPaymentAttemptData>?> FinanceAttemptsAsync(Guid accountId, Guid invoiceId,
            CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<CardPaymentAttemptData>?>(null);

        public Task<CardPaymentReceiptData?> AirlineReceiptAsync(Guid accountId, Guid attemptId,
            CancellationToken cancellationToken = default) => Task.FromResult<CardPaymentReceiptData?>(null);
    }
}
