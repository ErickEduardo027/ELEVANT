using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Finance;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Authentication;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

public sealed class FinancialDocumentEndpointsTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000007");
    private static readonly Guid OrganizationId = Guid.Parse("30000000-0000-7000-8000-000000000007");

    [Fact]
    public async Task PdfRoutesAreProtectedAndDeclaredAsBinaryResponses()
    {
        using var client = factory.CreateClient();
        var id = Guid.NewGuid();
        // 4-A: every document is addressed by its invoice; the preinvoice routes left with the preinvoice.
        var routes = new[]
        {
            $"/api/v1/airline/portal/invoices/{id:D}/document",
            $"/api/v1/airline/portal/invoices/{id:D}/receipt",
            $"/api/v1/finance/invoices/{id:D}/document",
            $"/api/v1/finance/payments/by-invoice/{id:D}/receipt",
        };
        foreach (var route in routes)
        {
            using var response = await client.GetAsync(route,
                TestContext.Current.CancellationToken);
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }

        using var swagger = await client.GetAsync("/swagger/v1/swagger.json",
            TestContext.Current.CancellationToken);
        swagger.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await swagger.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        var paths = json.RootElement.GetProperty("paths");
        foreach (var route in routes)
        {
            var template = route.Replace(id.ToString("D"), "{invoiceId}");
            var response = paths.GetProperty(template).GetProperty("get")
                .GetProperty("responses").GetProperty("200");
            Assert.True(response.GetProperty("content")
                .TryGetProperty("application/pdf", out _));
        }
        Assert.False(paths.TryGetProperty("/api/v1/airline/portal/preinvoices/{preinvoiceId}/invoice/document", out _));
        Assert.False(paths.TryGetProperty("/api/v1/finance/invoices/by-preinvoice/{preinvoiceId}/document", out _));
    }

    [Fact]
    public async Task StorageFailureKeepsPrivatePdfResponseGeneric()
    {
        var state = new FailingDocumentState();
        await using var application = factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IActorContextResolver>();
                services.RemoveAll<INonFiscalInvoiceReadStore>();
                services.RemoveAll<IFinancialDocumentStore>();
                services.AddScoped<IActorContextResolver>(_ => state);
                services.AddScoped<INonFiscalInvoiceReadStore>(_ => state);
                services.AddScoped<IFinancialDocumentStore>(_ => state);
            }));
        using var client = application.CreateClient();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", AirlineToken());

        using var response = await client.GetAsync(
            $"/api/v1/airline/portal/invoices/{state.InvoiceId:D}/document",
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        Assert.False(response.Headers.Contains("X-Content-SHA256"));
        var body = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
        Assert.Contains("Financial document is unavailable.", body, StringComparison.Ordinal);
        Assert.DoesNotContain("private-object-key-and-secret", body, StringComparison.Ordinal);
        Assert.DoesNotContain("StorageWrite", body, StringComparison.Ordinal);
    }

    private static string AirlineToken()
    {
        var now = DateTimeOffset.UtcNow;
        return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Audience = ElevantApiFactory.AuthenticationAudience,
            Expires = now.AddMinutes(15).UtcDateTime,
            IssuedAt = now.UtcDateTime,
            Issuer = ElevantApiFactory.AuthenticationIssuer,
            NotBefore = now.AddSeconds(-5).UtcDateTime,
            SigningCredentials = new SigningCredentials(
                new SymmetricSecurityKey(Convert.FromBase64String(
                    ElevantApiFactory.AuthenticationSigningKeyBase64)),
                SecurityAlgorithms.HmacSha256),
            Subject = new System.Security.Claims.ClaimsIdentity(
            [
                new System.Security.Claims.Claim(JwtRegisteredClaimNames.Sub, AccountId.ToString("D")),
                new System.Security.Claims.Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("D")),
                new System.Security.Claims.Claim(SessionSecurityVersion.ClaimType,
                    SessionSecurityVersion.Fingerprint(ElevantApiFactory.TestSecurityStamp)),
            ]),
            TokenType = "at+jwt",
        });
    }

    private sealed class FailingDocumentState : IActorContextResolver,
        INonFiscalInvoiceReadStore, IFinancialDocumentStore
    {
        public Guid PreinvoiceId { get; } = Guid.NewGuid();

        public Guid InvoiceId { get; } = Guid.NewGuid();

        public Task<Guid?> PreinvoiceOfInvoiceAsync(Guid invoiceId, CancellationToken cancellationToken = default) =>
            Task.FromResult<Guid?>(invoiceId == InvoiceId ? PreinvoiceId : null);

        public Task<ActorContext?> ResolveAsync(Guid accountId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult<ActorContext?>(new ActorContext(AccountId,
                "synthetic.airline@dev.elevant.test", "Synthetic Airline User",
                [new ActorRole(Guid.NewGuid(), "AIRLINE_CLIENT", "Airline Client",
                    PortalKind.AirlinePortal, "airline_client")],
                [new ActorMembership(Guid.NewGuid(), OrganizationId, "SYNTHETIC-AIR",
                    "Synthetic Airline", OrganizationType.AirlineCustomer,
                    MembershipKind.AirlineClient)], []));

        public Task<NonFiscalInvoiceData?> GetForAirlineAsync(Guid organizationId,
            Guid preinvoiceId, CancellationToken cancellationToken = default) =>
            Task.FromResult<NonFiscalInvoiceData?>(organizationId == OrganizationId &&
                preinvoiceId == PreinvoiceId
                ? new NonFiscalInvoiceData(Guid.NewGuid(), PreinvoiceId, Guid.NewGuid(),
                    Guid.NewGuid(), "NF-SYNTHETIC", "USD", 10m,
                    DateTimeOffset.UtcNow, [])
                : null);

        public Task<NonFiscalInvoiceData?> GetForFinanceAsync(Guid accountId,
            Guid preinvoiceId, CancellationToken cancellationToken = default) =>
            Task.FromResult<NonFiscalInvoiceData?>(null);

        public Task<FinancialDocumentData> OpenInvoiceAsync(NonFiscalInvoiceData invoice,
            CancellationToken cancellationToken = default) =>
            throw new FinancialDocumentUnavailableException(
                FinancialDocumentFailureStage.StorageWrite,
                new InvalidOperationException("private-object-key-and-secret"));

        public Task<FinancialDocumentData> OpenReceiptAsync(NonFiscalPaymentData payment,
            string invoiceNumber, CancellationToken cancellationToken = default) =>
            throw new FinancialDocumentUnavailableException(
                FinancialDocumentFailureStage.StorageRead,
                new InvalidOperationException("private-object-key-and-secret"));
    }
}
