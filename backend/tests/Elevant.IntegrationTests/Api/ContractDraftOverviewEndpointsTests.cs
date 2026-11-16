using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Elevant.Application.Abstractions.Commercial;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

public sealed class ContractDraftOverviewEndpointsTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000013");

    [Fact]
    public async Task PublishedAgreementsReturnPagedAuthorizedDataAndDenyWrongRole()
    {
        var data = new ManagedContractPageData(2, 1, false,
            [new ManagedContractData(Guid.NewGuid(), "DEV-CTR", "Demo Airlines", "EV",
                "Active", null, null, [])]);
        var store = new ManagedContractStoreStub { Data = data };
        await using var application = CreateApplication(store);
        using var client = application.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());

        using var response = await client.GetAsync("/api/v1/contracts/agreements?page=2&limit=1",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString());
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        Assert.Equal("DEV-CTR", json.RootElement.GetProperty("contracts")[0].GetProperty("code").GetString());
        Assert.Equal((AccountId, 2, 1), store.Request);

        store.Data = null;
        using var denied = await client.GetAsync("/api/v1/contracts/agreements",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);

        using var invalid = await client.GetAsync("/api/v1/contracts/agreements?page=0",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
    }

    [Fact]
    public async Task PublishedAgreementsHaveProtectedVersionedContract()
    {
        using var client = factory.CreateClient();
        using var anonymous = await client.GetAsync("/api/v1/contracts/agreements",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        using var response = await client.GetAsync("/swagger/v1/swagger.json",
            TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        var endpoint = json.RootElement.GetProperty("paths")
            .GetProperty("/api/v1/contracts/agreements").GetProperty("get");
        Assert.True(endpoint.GetProperty("responses").TryGetProperty("200", out _));
    }

    [Fact]
    public async Task PublishesProtectedDraftOverview()
    {
        using var client = factory.CreateClient();
        using var anonymous = await client.GetAsync("/api/v1/contracts/drafts/overview",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        using var response = await client.GetAsync("/swagger/v1/swagger.json",
            TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        var endpoint = json.RootElement.GetProperty("paths")
            .GetProperty("/api/v1/contracts/drafts/overview").GetProperty("get");
        Assert.True(endpoint.GetProperty("responses").TryGetProperty("200", out _));
    }

    private WebApplicationFactory<Program> CreateApplication(ManagedContractStoreStub store) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IManagedContractReadStore>();
            services.AddSingleton<IManagedContractReadStore>(store);
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

    private sealed class ManagedContractStoreStub : IManagedContractReadStore
    {
        public ManagedContractPageData? Data { get; set; }
        public (Guid AccountId, int Page, int Limit)? Request { get; private set; }

        public Task<ManagedContractPageData?> ListAsync(Guid actorId, int page, int limit,
            CancellationToken cancellationToken = default)
        {
            Request = (actorId, page, limit);
            return Task.FromResult(Data);
        }
    }
}
