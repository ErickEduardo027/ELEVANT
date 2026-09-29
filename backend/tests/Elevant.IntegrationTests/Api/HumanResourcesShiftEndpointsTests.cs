using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Elevant.Application.Abstractions.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

public sealed class HumanResourcesShiftEndpointsTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000004");

    [Fact]
    public async Task ShiftReadRequiresAuthenticationAndIsPublishedInOpenApi()
    {
        using var client = factory.CreateClient();
        using var anonymous = await client.GetAsync(
            "/api/v1/human-resources/shifts?from=2026-08-17&to=2026-08-23",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);

        using var response = await client.GetAsync("/swagger/v1/swagger.json",
            TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        var endpoint = json.RootElement.GetProperty("paths")
            .GetProperty("/api/v1/human-resources/shifts").GetProperty("get");
        Assert.True(endpoint.GetProperty("responses").TryGetProperty("200", out _));
        Assert.True(endpoint.GetProperty("responses").TryGetProperty("403", out _));
    }

    [Fact]
    public async Task ReturnsBoundedWeekAndRejectsInvalidRangeOrPaging()
    {
        var shiftId = Guid.NewGuid();
        var stub = new Stub
        {
            Data = new HumanResourcesShiftPage(new DateOnly(2026, 8, 17),
                new DateOnly(2026, 8, 23), 2, 1, false,
                [new HumanResourcesShiftData(shiftId, Guid.NewGuid(), "Riley Ramp",
                    "DEV-RA-001", Guid.NewGuid(), "PUJ", Guid.NewGuid(), "A",
                    Guid.NewGuid(), "RAMP-AGENT", new DateOnly(2026, 8, 18),
                    new TimeOnly(6, 0), new TimeOnly(14, 0), "Morning")]),
        };
        await using var application = factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IHumanResourcesShiftReadStore>();
                services.AddSingleton<IHumanResourcesShiftReadStore>(stub);
            }));
        using var client = application.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());

        using var missing = await client.GetAsync("/api/v1/human-resources/shifts",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        using var tooWide = await client.GetAsync(
            "/api/v1/human-resources/shifts?from=2026-08-01&to=2026-08-23",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, tooWide.StatusCode);
        using var tooLarge = await client.GetAsync(
            "/api/v1/human-resources/shifts?from=2026-08-17&to=2026-08-23&limit=101",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, tooLarge.StatusCode);
        using var response = await client.GetAsync(
            "/api/v1/human-resources/shifts?from=2026-08-17&to=2026-08-23&page=2&limit=1",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString());
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        Assert.Equal(shiftId, json.RootElement.GetProperty("shifts")[0].GetProperty("id").GetGuid());
        Assert.Equal("PUJ", json.RootElement.GetProperty("shifts")[0]
            .GetProperty("stationCode").GetString());
        Assert.Equal((AccountId, new DateOnly(2026, 8, 17), new DateOnly(2026, 8, 23), 2, 1), stub.Request);
    }

    [Fact]
    public async Task DeniedActorDoesNotReceiveShiftRows()
    {
        await using var application = factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IHumanResourcesShiftReadStore>();
                services.AddSingleton<IHumanResourcesShiftReadStore>(new Stub());
            }));
        using var client = application.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());
        using var response = await client.GetAsync(
            "/api/v1/human-resources/shifts?from=2026-08-17&to=2026-08-23",
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

    private sealed class Stub : IHumanResourcesShiftReadStore
    {
        public HumanResourcesShiftPage? Data { get; init; }
        public (Guid AccountId, DateOnly From, DateOnly To, int Page, int Limit)? Request { get; private set; }

        public Task<HumanResourcesShiftPage?> ListAsync(Guid actorId, DateOnly from, DateOnly to,
            int page, int limit, CancellationToken cancellationToken = default)
        {
            Request = (actorId, from, to, page, limit);
            return Task.FromResult(Data);
        }
    }
}
