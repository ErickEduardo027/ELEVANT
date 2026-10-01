using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Elevant.Application.Abstractions.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

public sealed class HumanResourcesAvailabilityEndpointsTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000004");

    [Fact]
    public async Task AvailabilityReadIsAuthenticatedVersionedAndPublished()
    {
        using var client = factory.CreateClient();
        using var anonymous = await client.GetAsync(
            "/api/v1/human-resources/availability-requests?from=2026-09-28&to=2026-10-04",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);

        using var response = await client.GetAsync("/swagger/v1/swagger.json",
            TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        var endpoint = json.RootElement.GetProperty("paths")
            .GetProperty("/api/v1/human-resources/availability-requests")
            .GetProperty("get");
        Assert.True(endpoint.GetProperty("responses").TryGetProperty("200", out _));
        Assert.True(endpoint.GetProperty("responses").TryGetProperty("403", out _));
    }

    [Fact]
    public async Task AvailabilityWriteRoutesAreVersionedAndAuthenticated()
    {
        using var client = factory.CreateClient();
        var id = Guid.NewGuid();
        using var anonymousRecord = await client.PutAsJsonAsync(
            $"/api/v1/human-resources/availability-requests/{id}", new
            {
                rampProfileId = Guid.NewGuid(), startsOn = "2026-10-01",
                endsOn = "2026-10-02", type = "DayOff", reason = "Synthetic leave",
            }, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymousRecord.StatusCode);
        using var anonymousResolution = await client.PostAsJsonAsync(
            $"/api/v1/human-resources/availability-requests/{id}/resolution",
            new { decision = "Approve", note = "Coverage arranged" },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymousResolution.StatusCode);

        using var response = await client.GetAsync("/swagger/v1/swagger.json",
            TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        var paths = json.RootElement.GetProperty("paths");
        var record = paths.GetProperty("/api/v1/human-resources/availability-requests/{id}")
            .GetProperty("put");
        var resolution = paths.GetProperty(
            "/api/v1/human-resources/availability-requests/{id}/resolution")
            .GetProperty("post");
        Assert.True(record.GetProperty("responses").TryGetProperty("409", out _));
        Assert.True(resolution.GetProperty("responses").TryGetProperty("409", out _));
    }

    [Fact]
    public async Task AvailabilityReadValidatesRangeAndReturnsOnlyTheAuthorizedStorePage()
    {
        var id = Guid.NewGuid();
        var stub = new Stub { Data = new HumanResourcesAvailabilityRequestPage(
            new DateOnly(2026, 9, 28), new DateOnly(2026, 10, 4), 2, 1, false,
            [new HumanResourcesAvailabilityRequestData(id, Guid.NewGuid(),
                "Riley Ramp", "DEV-RA-001", new DateOnly(2026, 10, 1),
                new DateOnly(2026, 10, 2), "DayOff", "Approved", "Test leave",
                DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, null)]) };
        await using var application = factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IHumanResourcesAvailabilityReadStore>();
                services.AddSingleton<IHumanResourcesAvailabilityReadStore>(stub);
            }));
        using var client = application.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());

        using var missing = await client.GetAsync(
            "/api/v1/human-resources/availability-requests",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        using var tooWide = await client.GetAsync(
            "/api/v1/human-resources/availability-requests?from=2026-09-01&to=2026-10-04",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, tooWide.StatusCode);
        using var response = await client.GetAsync(
            "/api/v1/human-resources/availability-requests?from=2026-09-28&to=2026-10-04&page=2&limit=1",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString());
        Assert.Equal((AccountId, new DateOnly(2026, 9, 28),
            new DateOnly(2026, 10, 4), 2, 1), stub.Request);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        Assert.Equal(id, json.RootElement.GetProperty("requests")[0]
            .GetProperty("id").GetGuid());
        stub.Data = null;
        using var denied = await client.GetAsync(
            "/api/v1/human-resources/availability-requests?from=2026-09-28&to=2026-10-04",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
    }

    [Fact]
    public async Task AvailabilityWritesPassExactIntentAndMapFailures()
    {
        var id = Guid.NewGuid();
        var input = new RecordHumanResourcesAvailabilityInput(Guid.NewGuid(),
            new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 2),
            "DayOff", "Synthetic leave");
        var resolution = new ResolveHumanResourcesAvailabilityInput(
            "Approve", "Coverage arranged");
        var stub = new WriteStub();
        await using var application = factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IHumanResourcesAvailabilityWriteStore>();
                services.AddSingleton<IHumanResourcesAvailabilityWriteStore>(stub);
            }));
        using var client = application.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());
        using var first = await client.PutAsJsonAsync(
            $"/api/v1/human-resources/availability-requests/{id:D}", input,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal((AccountId, id, input), stub.RecordRequest);
        using var decision = await client.PostAsJsonAsync(
            $"/api/v1/human-resources/availability-requests/{id:D}/resolution",
            resolution, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, decision.StatusCode);
        Assert.Equal((AccountId, id, resolution), stub.ResolveRequest);
        using var json = JsonDocument.Parse(await decision.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        Assert.Equal("Approved", json.RootElement.GetProperty("status").GetString());

        stub.Failure = HumanResourcesAvailabilityWriteFailure.Conflict;
        using var conflict = await client.PostAsJsonAsync(
            $"/api/v1/human-resources/availability-requests/{id:D}/resolution",
            resolution, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Conflict, conflict.StatusCode);
        stub.Failure = HumanResourcesAvailabilityWriteFailure.Forbidden;
        using var denied = await client.PutAsJsonAsync(
            $"/api/v1/human-resources/availability-requests/{id:D}", input,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
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

    private sealed class Stub : IHumanResourcesAvailabilityReadStore
    {
        public HumanResourcesAvailabilityRequestPage? Data { get; set; }
        public (Guid AccountId, DateOnly From, DateOnly To, int Page, int Limit)? Request
        { get; private set; }

        public Task<HumanResourcesAvailabilityRequestPage?> ListAsync(Guid actorId,
            DateOnly from, DateOnly to, int page, int limit,
            CancellationToken cancellationToken = default)
        {
            Request = (actorId, from, to, page, limit);
            return Task.FromResult(Data);
        }
    }

    private sealed class WriteStub : IHumanResourcesAvailabilityWriteStore
    {
        public HumanResourcesAvailabilityWriteFailure? Failure { get; set; }
        public (Guid ActorId, Guid Id, RecordHumanResourcesAvailabilityInput Input)? RecordRequest
        { get; private set; }
        public (Guid ActorId, Guid Id, ResolveHumanResourcesAvailabilityInput Input)? ResolveRequest
        { get; private set; }

        public Task<HumanResourcesAvailabilityWriteResult> RecordAsync(Guid actorId,
            Guid requestId, RecordHumanResourcesAvailabilityInput input,
            CancellationToken cancellationToken = default)
        {
            RecordRequest = (actorId, requestId, input);
            return Task.FromResult(Failure is null
                ? HumanResourcesAvailabilityWriteResult.Success(requestId, "Pending")
                : HumanResourcesAvailabilityWriteResult.Failed(Failure.Value));
        }

        public Task<HumanResourcesAvailabilityWriteResult> ResolveAsync(Guid actorId,
            Guid requestId, ResolveHumanResourcesAvailabilityInput input,
            CancellationToken cancellationToken = default)
        {
            ResolveRequest = (actorId, requestId, input);
            return Task.FromResult(Failure is null
                ? HumanResourcesAvailabilityWriteResult.Success(requestId, "Approved")
                : HumanResourcesAvailabilityWriteResult.Failed(Failure.Value));
        }
    }
}
