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

public sealed class FinancePreinvoiceListEndpointsTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000006");
    private static readonly Guid StationId = Guid.Parse("20000000-0000-7000-8000-000000000003");

    [Fact]
    public async Task ListsAuthorizedStationAndRejectsDeniedOrInvalidScope()
    {
        var itemId = Guid.NewGuid();
        var store = new Stub { Data = new FinancePreinvoicePageData(2, 1, false,
            [new FinancePreinvoiceListItem(itemId, Guid.NewGuid(), "Demo Airlines",
                StationId, new DateOnly(2026, 8, 18), new DateOnly(2026, 8, 18),
                "USD", 42.0001m, "Draft", 1, DateTimeOffset.UtcNow)]) };
        await using var application = factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IFinancePreinvoiceListStore>();
                services.AddSingleton<IFinancePreinvoiceListStore>(store);
            }));
        using var client = application.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());
        using var response = await client.GetAsync(Path(2, 1), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString());
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        Assert.Equal(itemId, json.RootElement.GetProperty("preinvoices")[0].GetProperty("id").GetGuid());
        Assert.Equal(42.0001m, json.RootElement.GetProperty("preinvoices")[0]
            .GetProperty("total").GetDecimal());
        Assert.Equal((AccountId, StationId, 2, 1), store.Request);

        store.Data = null;
        using var denied = await client.GetAsync(Path(1, 20), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
        using var invalid = await client.GetAsync(Path(0, 20), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
    }

    [Fact]
    public async Task PublishesProtectedStationScopedPreinvoiceList()
    {
        using var client = factory.CreateClient();
        using var anonymous = await client.GetAsync(
            $"/api/v1/finance/preinvoices?stationId={Guid.NewGuid():D}",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);

        using var swagger = await client.GetAsync("/swagger/v1/swagger.json",
            TestContext.Current.CancellationToken);
        swagger.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await swagger.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        var endpoint = json.RootElement.GetProperty("paths")
            .GetProperty("/api/v1/finance/preinvoices").GetProperty("get");
        Assert.True(endpoint.GetProperty("responses").TryGetProperty("200", out _));
        Assert.Contains(endpoint.GetProperty("parameters").EnumerateArray(), item =>
            item.GetProperty("name").GetString() == "stationId" &&
            item.GetProperty("required").GetBoolean());
    }

    private static string Path(int page, int limit) =>
        $"/api/v1/finance/preinvoices?stationId={StationId:D}&page={page}&limit={limit}";

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

    private sealed class Stub : IFinancePreinvoiceListStore
    {
        public FinancePreinvoicePageData? Data { get; set; }
        public (Guid AccountId, Guid StationId, int Page, int Limit)? Request { get; private set; }

        public Task<FinancePreinvoicePageData?> ListAsync(Guid accountId, Guid stationId,
            int page, int limit, CancellationToken cancellationToken = default)
        {
            Request = (accountId, stationId, page, limit);
            return Task.FromResult(Data);
        }
    }
}
