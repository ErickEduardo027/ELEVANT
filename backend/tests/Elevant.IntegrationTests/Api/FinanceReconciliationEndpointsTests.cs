using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Elevant.Application.Abstractions.Finance;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

public sealed class FinanceReconciliationEndpointsTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000006");
    private static readonly Guid StationId = Guid.Parse("20000000-0000-7000-8000-000000000003");

    [Fact]
    public async Task RequiresSessionAndStationScopeAndBoundsPaging()
    {
        await using var application = CreateApplication(new Stub());
        using var client = application.CreateClient();
        using var anonymous = await client.GetAsync(Path(), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());
        using var missing = await client.GetAsync("/api/v1/finance/reconciliation",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        using var invalid = await client.GetAsync($"{Path()}&limit=51",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
    }

    [Fact]
    public async Task ReturnsActualInvoiceAndManualPaymentWithoutClaimingBankSettlement()
    {
        var preinvoiceId = Guid.NewGuid();
        var invoiceId = Guid.NewGuid();
        var stub = new Stub
        {
            Data = new FinanceReconciliationPageData(StationId, 1, 20, false,
                [new FinanceReconciliationData(preinvoiceId, Guid.NewGuid(),
                    "Synthetic Airline", new DateOnly(2026, 8, 18), new DateOnly(2026, 8, 18),
                    "USD", 125.50m, "Invoiced", invoiceId, "NF-TEST", 125.50m,
                    DateTimeOffset.UtcNow, Guid.NewGuid(), "DEV-PAY-TEST", 125.50m,
                    DateTimeOffset.UtcNow)]),
        };
        await using var application = CreateApplication(stub);
        using var client = application.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());
        using var response = await client.GetAsync(Path(), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString());
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        var item = json.RootElement.GetProperty("rows")[0];
        Assert.Equal(invoiceId, item.GetProperty("invoiceId").GetGuid());
        Assert.Equal("DEV-PAY-TEST", item.GetProperty("paymentReference").GetString());
        Assert.Equal((AccountId, StationId, 1, 20), stub.Request);
    }

    [Fact]
    public async Task ForbiddenStoreResultDoesNotLeakFinancialRows()
    {
        await using var application = CreateApplication(new Stub());
        using var client = application.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());
        using var response = await client.GetAsync(Path(), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task OpenApiPublishesTheRequiredStationParameter()
    {
        using var client = factory.CreateClient();
        using var response = await client.GetAsync("/swagger/v1/swagger.json",
            TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        var endpoint = json.RootElement.GetProperty("paths")
            .GetProperty("/api/v1/finance/reconciliation").GetProperty("get");
        Assert.True(endpoint.GetProperty("responses").TryGetProperty("200", out _));
        Assert.True(endpoint.GetProperty("responses").TryGetProperty("403", out _));
        Assert.Contains(endpoint.GetProperty("parameters").EnumerateArray(), item =>
            item.GetProperty("name").GetString() == "stationId" &&
            item.GetProperty("required").GetBoolean());
    }

    private static string Path() => $"/api/v1/finance/reconciliation?stationId={StationId:D}";

    private WebApplicationFactory<Program> CreateApplication(Stub stub) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IFinanceReconciliationReadStore>();
            services.AddSingleton<IFinanceReconciliationReadStore>(stub);
        }));

    private static string Token()
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
                new System.Security.Claims.Claim(
                    Elevant.Infrastructure.Authentication.SessionSecurityVersion.ClaimType,
                    Elevant.Infrastructure.Authentication.SessionSecurityVersion.Fingerprint(
                        ElevantApiFactory.TestSecurityStamp)),
            ]),
            TokenType = "at+jwt",
        });
    }

    private sealed class Stub : IFinanceReconciliationReadStore
    {
        public FinanceReconciliationPageData? Data { get; init; }
        public (Guid AccountId, Guid StationId, int Page, int Limit)? Request { get; private set; }
        public Task<FinanceReconciliationPageData?> ListAsync(Guid accountId, Guid stationId,
            int page, int limit, CancellationToken cancellationToken = default)
        {
            Request = (accountId, stationId, page, limit);
            return Task.FromResult(Data);
        }
    }
}
