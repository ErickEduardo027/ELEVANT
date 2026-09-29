using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Enumerations;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

public sealed class HumanResourcesPermitEndpointsTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000004");

    [Fact]
    public async Task PermitReadRequiresAuthenticationAndIsPublishedInOpenApi()
    {
        using var client = factory.CreateClient();
        using var anonymous = await client.GetAsync("/api/v1/human-resources/permits",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);

        using var response = await client.GetAsync("/swagger/v1/swagger.json",
            TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        var endpoint = json.RootElement.GetProperty("paths")
            .GetProperty("/api/v1/human-resources/permits").GetProperty("get");
        Assert.True(endpoint.GetProperty("responses").TryGetProperty("200", out _));
        Assert.True(endpoint.GetProperty("responses").TryGetProperty("403", out _));
    }

    [Fact]
    public async Task ReturnsBoundedCurrentPermitsAndRejectsInvalidPaging()
    {
        var permitId = Guid.NewGuid();
        var stub = new Stub
        {
            Data = new HumanResourcesPermitPage(2, 1, false,
            [new HumanResourcesPermitData(permitId, Guid.NewGuid(), "Riley Ramp",
                "DEV-RA-001", "AirportId", 1, "DEV-AIRPORT-ID",
                new DateOnly(2026, 1, 1), new DateOnly(2099, 12, 31))]),
        };
        await using var application = factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IHumanResourcesPermitReadStore>();
                services.AddSingleton<IHumanResourcesPermitReadStore>(stub);
            }));
        using var client = application.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());

        using var bad = await client.GetAsync("/api/v1/human-resources/permits?page=0",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        using var tooLarge = await client.GetAsync("/api/v1/human-resources/permits?limit=101",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, tooLarge.StatusCode);
        using var incompleteFilter = await client.GetAsync(
            $"/api/v1/human-resources/permits?rampProfileId={Guid.NewGuid():D}",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, incompleteFilter.StatusCode);
        using var response = await client.GetAsync("/api/v1/human-resources/permits?page=2&limit=1",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString());
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        Assert.Equal(permitId, json.RootElement.GetProperty("permits")[0].GetProperty("id").GetGuid());
        Assert.Equal("AirportId", json.RootElement.GetProperty("permits")[0]
            .GetProperty("documentType").GetString());
        Assert.Equal((AccountId, 2, 1), stub.Request);
        var filteredAgentId = Guid.NewGuid();
        using var filtered = await client.GetAsync(
            $"/api/v1/human-resources/permits?page=1&limit=1&rampProfileId={filteredAgentId:D}&documentType=AirportId",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, filtered.StatusCode);
        Assert.Equal((AccountId, 1, 1, filteredAgentId, PermitDocumentType.AirportId),
            stub.FilterRequest);
    }

    [Fact]
    public async Task DeniedActorDoesNotReceivePermitRows()
    {
        await using var application = factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IHumanResourcesPermitReadStore>();
                services.AddSingleton<IHumanResourcesPermitReadStore>(new Stub());
            }));
        using var client = application.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());
        using var response = await client.GetAsync("/api/v1/human-resources/permits",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

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

    private sealed class Stub : IHumanResourcesPermitReadStore
    {
        public HumanResourcesPermitPage? Data { get; init; }
        public (Guid AccountId, int Page, int Limit)? Request { get; private set; }
        public (Guid AccountId, int Page, int Limit, Guid AgentId, PermitDocumentType DocumentType)?
            FilterRequest { get; private set; }

        public Task<HumanResourcesPermitPage?> ListCurrentAsync(Guid actorId, int page,
            int limit, CancellationToken cancellationToken = default)
        {
            Request = (actorId, page, limit);
            return Task.FromResult(Data);
        }

        public Task<HumanResourcesPermitPage?> ListCurrentAsync(Guid actorId, int page,
            int limit, Guid rampProfileId, PermitDocumentType documentType,
            CancellationToken cancellationToken = default)
        {
            FilterRequest = (actorId, page, limit, rampProfileId, documentType);
            return Task.FromResult(Data);
        }
    }
}
