using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Reflection;
using System.Text.Json;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Messaging;
using Elevant.Application.Finance;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

/// <summary>
/// Phase 1, block E: the superadmin outbox with reasons and references (1-N22), the email status of an
/// issued invoice (1-N08) and the client password reset over a pending invitation (1-N12).
/// </summary>
public sealed class GovernanceAccountEmailEndpointsTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000007");
    private static readonly Guid TargetId = Guid.Parse("70000000-0000-7000-8000-0000000000e1");

    [Fact]
    public async Task TheOutboxPageCarriesReasonsAndReferencesWithoutBodies()
    {
        var entry = new EmailOutboxEntryData(TargetId, "ana@carrier.example.com", "Activation", "Discarded", 0,
            DateTimeOffset.Parse("2026-11-06T10:00:00Z", System.Globalization.CultureInfo.InvariantCulture), null,
            DateTimeOffset.Parse("2026-11-06T10:05:00Z", System.Globalization.CultureInfo.InvariantCulture), "superseded",
            new EmailReferenceData("account", AccountId, "Ana Rivera", "Carrier Air"));
        var outbox = new OutboxStub { Page = new EmailOutboxPageData(2, 10, true, [entry]) };
        await using var application = WithServices(services =>
        {
            services.RemoveAll<IEmailOutboxStore>();
            services.AddSingleton<IEmailOutboxStore>(outbox);
        });
        using var client = Authorized(application);
        var ct = TestContext.Current.CancellationToken;

        using var response = await client.GetAsync("/api/v1/governance/email/outbox?status=Discarded&page=2&limit=10", ct);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(new EmailOutboxQuery("Discarded", 2, 10), outbox.LastQuery);
        using var page = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        Assert.False(page.RootElement.GetProperty("smtpConfigured").GetBoolean());
        Assert.True(page.RootElement.GetProperty("hasMore").GetBoolean());
        var item = Assert.Single(page.RootElement.GetProperty("entries").EnumerateArray().ToArray());
        Assert.Equal("superseded", item.GetProperty("reason").GetString());
        Assert.Equal("account", item.GetProperty("reference").GetProperty("kind").GetString());
        Assert.Equal("Carrier Air", item.GetProperty("reference").GetProperty("context").GetString());
        Assert.False(item.TryGetProperty("htmlBody", out _));
        Assert.False(item.TryGetProperty("subject", out _));

        using var invalid = await client.GetAsync("/api/v1/governance/email/outbox?status=Lost", ct);
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        Assert.Equal("invalid_email_outbox_query", await CodeAsync(invalid));

        outbox.Page = null;
        using var forbidden = await client.GetAsync("/api/v1/governance/email/outbox", ct);
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);
        Assert.Equal(new EmailOutboxQuery("All", 1, 25), outbox.LastQuery);
    }

    [Fact]
    public async Task AnIssuedInvoiceReadsItsOwnEmailStatus()
    {
        var invoiceId = Guid.Parse("71000000-0000-7000-8000-0000000000e1");
        var store = new InvoiceEmailsStub
        {
            Deliveries = [new InvoiceEmailDeliveryData("billing@carrier.example.com", "Pending", null,
                DateTimeOffset.Parse("2026-11-06T10:00:00Z", System.Globalization.CultureInfo.InvariantCulture), null)],
        };
        await using var application = WithServices(services =>
        {
            services.RemoveAll<IInvoiceEmailStatusStore>();
            services.AddSingleton<IInvoiceEmailStatusStore>(store);
        });
        using var client = Authorized(application);
        var ct = TestContext.Current.CancellationToken;

        using var response = await client.GetAsync($"/api/v1/finance/invoices/{invoiceId}/email-deliveries", ct);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal((AccountId, invoiceId), store.LastCall);
        using var status = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        Assert.Equal(invoiceId, status.RootElement.GetProperty("invoiceId").GetGuid());
        Assert.False(status.RootElement.GetProperty("smtpConfigured").GetBoolean());
        Assert.Equal("Pending", Assert.Single(status.RootElement.GetProperty("deliveries").EnumerateArray().ToArray())
            .GetProperty("status").GetString());

        store.Deliveries = null;
        using var missing = await client.GetAsync($"/api/v1/finance/invoices/{invoiceId}/email-deliveries", ct);
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        Assert.Equal("not_found", await CodeAsync(missing));
    }

    [Fact]
    public async Task TheClientPasswordResetTakesTheAccountVersionWithItsKey()
    {
        var calls = new List<object?[]>();
        var store = DispatchProxy.Create<IDepartmentGovernanceStore, GovernanceStoreProxy>();
        ((GovernanceStoreProxy)(object)store).Handler = (method, arguments) =>
        {
            if (method.Name != nameof(IDepartmentGovernanceStore.ResetClientUserPasswordAsync))
                throw new NotSupportedException(method.Name);
            calls.Add(arguments!);
            var input = (ResetClientUserPasswordInput)arguments![3]!;
            return Task.FromResult(input.TemporaryPassword == "short"
                ? GovernanceResult.Failed(GovernanceFailure.Invalid, "password_policy")
                : GovernanceResult.Success(TargetId));
        };
        await using var application = WithServices(services =>
        {
            services.RemoveAll<IDepartmentGovernanceStore>();
            services.AddSingleton(store);
        });
        using var client = Authorized(application);
        var ct = TestContext.Current.CancellationToken;
        var organizationId = Guid.Parse("10000000-0000-7000-8000-0000000000e1");
        var path = $"/api/v1/governance/clients/{organizationId}/users/{TargetId}/password-reset";
        var key = Guid.NewGuid();

        using var reset = new HttpRequestMessage(HttpMethod.Post, path)
            { Content = JsonContent.Create(new { temporaryPassword = "Synthetic-Temporary!2026", expectedVersion = "AAAAAAAAB9E=" }) };
        reset.Headers.Add("Idempotency-Key", key.ToString());
        using var ok = await client.SendAsync(reset, ct);
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.Equal(new ResetClientUserPasswordInput("Synthetic-Temporary!2026", "AAAAAAAAB9E="), calls[^1][3]);
        Assert.Equal(key, calls[^1][4]);

        // Older clients send only the password (expand phase); a refusal carries its code.
        using var legacy = await client.PostAsJsonAsync(path, new { temporaryPassword = "short" }, ct);
        Assert.Equal(HttpStatusCode.BadRequest, legacy.StatusCode);
        Assert.Equal("password_policy", await CodeAsync(legacy));
        Assert.Null(calls[^1][4]);
        Assert.Null(((ResetClientUserPasswordInput)calls[^1][3]!).ExpectedVersion);
    }

    /// <summary>Stands in for the large governance store: only the method under test answers.</summary>
    public class GovernanceStoreProxy : DispatchProxy
    {
        public Func<MethodInfo, object?[]?, object?> Handler { get; set; } = (_, _) => throw new NotSupportedException();

        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args) => Handler(targetMethod!, args);
    }

    private sealed class OutboxStub : IEmailOutboxStore
    {
        public EmailOutboxPageData? Page { get; set; }

        public EmailOutboxQuery? LastQuery { get; private set; }

        public Task<IReadOnlyList<OutboxEmail>> ClaimDueAsync(int maximum, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<OutboxEmail>>([]);

        public Task MarkSentAsync(long id, CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task MarkFailedAsync(long id, string reason, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task<int> DiscardExpiredAsync(bool scrubHistory, CancellationToken cancellationToken = default) =>
            Task.FromResult(0);

        public Task<Guid?> EnqueueTestAsync(Guid actorId, string recipient, CancellationToken cancellationToken = default) =>
            Task.FromResult<Guid?>(null);

        public Task<IReadOnlyList<EmailDeliveryData>?> ListRecentAsync(Guid actorId, int limit,
            CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<EmailDeliveryData>?>(null);

        public Task<EmailOutboxPageData?> ListOutboxAsync(Guid actorId, EmailOutboxQuery query,
            CancellationToken cancellationToken = default)
        {
            LastQuery = query;
            return Task.FromResult(Page);
        }
    }

    private sealed class InvoiceEmailsStub : IInvoiceEmailStatusStore
    {
        public IReadOnlyList<InvoiceEmailDeliveryData>? Deliveries { get; set; }

        public (Guid ActorId, Guid InvoiceId)? LastCall { get; private set; }

        public Task<IReadOnlyList<InvoiceEmailDeliveryData>?> ListAsync(Guid actorId, Guid invoiceId,
            CancellationToken cancellationToken = default)
        {
            LastCall = (actorId, invoiceId);
            return Task.FromResult(Deliveries);
        }
    }

    private WebApplicationFactory<Program> WithServices(Action<IServiceCollection> configure) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(configure));

    private static async Task<string?> CodeAsync(HttpResponseMessage response)
    {
        using var problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        return problem.RootElement.TryGetProperty("code", out var code) ? code.GetString() : null;
    }

    private static HttpClient Authorized(WebApplicationFactory<Program> application)
    {
        var client = application.CreateClient();
        var now = DateTimeOffset.UtcNow;
        var token = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Audience = ElevantApiFactory.AuthenticationAudience,
            Expires = now.AddMinutes(15).UtcDateTime,
            IssuedAt = now.UtcDateTime,
            Issuer = ElevantApiFactory.AuthenticationIssuer,
            NotBefore = now.AddSeconds(-5).UtcDateTime,
            SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(
                Convert.FromBase64String(ElevantApiFactory.AuthenticationSigningKeyBase64)),
                SecurityAlgorithms.HmacSha256),
            Subject = new System.Security.Claims.ClaimsIdentity(
            [
                new System.Security.Claims.Claim(JwtRegisteredClaimNames.Sub, AccountId.ToString("D")),
                new System.Security.Claims.Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("D")),
                new System.Security.Claims.Claim(
                    Elevant.Infrastructure.Authentication.SessionSecurityVersion.ClaimType,
                    Elevant.Infrastructure.Authentication.SessionSecurityVersion.Fingerprint(
                        ElevantApiFactory.TestSecurityStamp)),
            ]),
            TokenType = "at+jwt",
        });
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }
}
