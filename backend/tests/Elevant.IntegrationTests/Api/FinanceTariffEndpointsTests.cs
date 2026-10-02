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

public sealed class FinanceTariffEndpointsTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000006");
    private static readonly Guid StationId = Guid.Parse("20000000-0000-7000-8000-000000000003");

    [Fact]
    public async Task RequiresAuthenticationAndStationAndRejectsInvalidPaging()
    {
        await using var application = CreateApplication(new Stub());
        using var client = application.CreateClient();
        using var anonymous = await client.GetAsync(Path(), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());
        using var missing = await client.GetAsync("/api/v1/finance/tariffs",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        using var invalid = await client.GetAsync($"{Path()}&limit=51",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
    }

    [Fact]
    public async Task ReturnsBoundedStationScopedPublishedRatesWithoutWrites()
    {
        var rateId = Guid.NewGuid();
        var stub = new Stub
        {
            Data = new FinanceTariffPageData(StationId, 1, 20, false,
                [new FinanceTariffData(rateId, Guid.NewGuid(), "DEV-CONTRACT-0001",
                    Guid.NewGuid(), "Synthetic Airline", 1, "Approved",
                    new DateOnly(2026, 1, 1), null, "USD", "GPU", "Ground power",
                    "operation", 125.50m, 1m)]),
        };
        await using var application = CreateApplication(stub);
        using var client = application.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());

        using var response = await client.GetAsync(Path(), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString());
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        Assert.Equal(StationId, json.RootElement.GetProperty("stationId").GetGuid());
        Assert.Equal(rateId, json.RootElement.GetProperty("tariffs")[0].GetProperty("id").GetGuid());
        Assert.Equal(125.50m, json.RootElement.GetProperty("tariffs")[0]
            .GetProperty("unitPrice").GetDecimal());
        Assert.Equal((AccountId, StationId, 1, 20), stub.Request);
    }

    [Fact]
    public async Task ForbiddenStoreResultDoesNotLeakTariffs()
    {
        var stub = new Stub();
        await using var application = CreateApplication(stub);
        using var client = application.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());
        using var response = await client.GetAsync(Path(), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task OpenApiPublishesRequiredStationParameter()
    {
        using var client = factory.CreateClient();
        using var response = await client.GetAsync("/swagger/v1/swagger.json",
            TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        var endpoint = json.RootElement.GetProperty("paths")
            .GetProperty("/api/v1/finance/tariffs").GetProperty("get");
        Assert.True(endpoint.GetProperty("responses").TryGetProperty("200", out _));
        Assert.True(endpoint.GetProperty("responses").TryGetProperty("403", out _));
        Assert.Contains(endpoint.GetProperty("parameters").EnumerateArray(), item =>
            item.GetProperty("name").GetString() == "stationId" &&
            item.GetProperty("required").GetBoolean());
    }

    private static string Path() => $"/api/v1/finance/tariffs?stationId={StationId:D}";

    private WebApplicationFactory<Program> CreateApplication(Stub stub) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IFinanceTariffReadStore>();
            services.AddSingleton<IFinanceTariffReadStore>(stub);
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

    private sealed class Stub : IFinanceTariffReadStore
    {
        public FinanceTariffPageData? Data { get; init; }
        public (Guid AccountId, Guid StationId, int Page, int Limit)? Request { get; private set; }

        public Task<FinanceTariffPageData?> ListAsync(Guid accountId, Guid stationId,
            int page, int limit, CancellationToken cancellationToken = default)
        {
            Request = (accountId, stationId, page, limit);
            return Task.FromResult(Data);
        }
    }
}
