using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Elevant.Api.Realtime;
using Elevant.Application.Abstractions.Realtime;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

public sealed class AccountChangesEndpointsTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000001");
    private static readonly Guid EventId = Guid.Parse("a0000000-0000-7000-8000-000000000001");
    private static readonly Guid ResourceId = Guid.Parse("90000000-0000-7000-8000-000000000001");

    [Fact]
    public async Task ReturnsAccountBoundPagedChangesWithoutInternalIds()
    {
        var state = new FakeStore();
        await using var app = Application(state);
        using var client = Authorized(app);

        using var first = await client.GetAsync(
            "/api/v1/changes?limit=1", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        var firstJson = await first.Content.ReadFromJsonAsync<JsonElement>(TestContext.Current.CancellationToken);
        var cursor = firstJson.GetProperty("nextCursor").GetString();
        Assert.False(string.IsNullOrWhiteSpace(cursor));
        Assert.True(firstJson.GetProperty("hasMore").GetBoolean());
        Assert.Equal(EventId, firstJson.GetProperty("changes")[0].GetProperty("eventId").GetGuid());
        Assert.Equal("notifications", firstJson.GetProperty("changes")[0].GetProperty("resource").GetString());
        Assert.Equal(ResourceId, firstJson.GetProperty("changes")[0].GetProperty("resourceId").GetGuid());
        Assert.DoesNotContain("recipientAccountId", firstJson.GetRawText(), StringComparison.Ordinal);
        Assert.Equal((AccountId, 0L, 1), state.LastRead);

        using var second = await client.GetAsync(
            $"/api/v1/changes?after={Uri.EscapeDataString(cursor!)}&limit=1",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        Assert.Equal((AccountId, 42L, 1), state.LastRead);
    }

    [Fact]
    public async Task RejectsAnonymousMalformedForeignCursorAndInvalidLimit()
    {
        var state = new FakeStore();
        await using var app = Application(state);
        using var anonymous = app.CreateClient();
        using var unauthorized = await anonymous.GetAsync(
            "/api/v1/changes", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, unauthorized.StatusCode);

        using var client = Authorized(app);
        using var malformed = await client.GetAsync(
            "/api/v1/changes?after=invalid", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, malformed.StatusCode);
        var codec = new AccountChangeCursorCodec(
            Convert.FromBase64String(ElevantApiFactory.AuthenticationSigningKeyBase64));
        var foreign = codec.Encode(Guid.NewGuid(), 42);
        using var crossAccount = await client.GetAsync(
            $"/api/v1/changes?after={Uri.EscapeDataString(foreign)}",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, crossAccount.StatusCode);
        using var invalidLimit = await client.GetAsync(
            "/api/v1/changes?limit=0", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, invalidLimit.StatusCode);
        Assert.Equal(0, state.Reads);
    }

    [Fact]
    public async Task DeniedActorGetsNoFeed()
    {
        var state = new FakeStore { Deny = true };
        await using var app = Application(state);
        using var client = Authorized(app);
        using var response = await client.GetAsync(
            "/api/v1/changes", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task ForwardsCurrentInstallationForDeviceScopedHints()
    {
        var state = new FakeStore();
        await using var app = Application(state);
        using var client = Authorized(app);
        var installationId = Guid.CreateVersion7();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/changes");
        request.Headers.Add("X-Elevant-Installation-Id", installationId.ToString("D"));
        using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(installationId, state.LastInstallationId);
    }

    [Fact]
    public async Task OpenApiPublishesVersionedChangeFeed()
    {
        using var client = factory.CreateClient();
        using var response = await client.GetAsync(
            "/swagger/v1/swagger.json", TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        var document = await response.Content.ReadFromJsonAsync<JsonElement>(
            TestContext.Current.CancellationToken);
        var operation = document.GetProperty("paths")
            .GetProperty("/api/v1/changes").GetProperty("get");
        Assert.Equal("GetAccountChanges", operation.GetProperty("operationId").GetString());
    }

    private WebApplicationFactory<Program> Application(FakeStore state) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<IAccountChangeReadStore>();
            services.AddSingleton<IAccountChangeReadStore>(state);
        }));

    private static HttpClient Authorized(WebApplicationFactory<Program> app)
    {
        var client = app.CreateClient();
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

    private sealed class FakeStore : IAccountChangeReadStore
    {
        public int Reads { get; private set; }
        public (Guid, long, int) LastRead { get; private set; }
        public Guid? LastInstallationId { get; private set; }
        public bool Deny { get; init; }

        public Task<AccountChangePage?> ReadAsync(Guid accountId, long after, int limit,
            CancellationToken cancellationToken = default) =>
            ReadAsync(accountId, after, limit, null, cancellationToken);

        public Task<AccountChangePage?> ReadAsync(Guid accountId, long after, int limit,
            Guid? installationId, CancellationToken cancellationToken = default)
        {
            Reads++;
            LastRead = (accountId, after, limit);
            LastInstallationId = installationId;
            if (Deny) return Task.FromResult<AccountChangePage?>(null);
            return Task.FromResult<AccountChangePage?>(after == 0
                ? new AccountChangePage(
                    [new AccountChangeData(EventId, 42, "notifications", ResourceId,
                        new DateTimeOffset(2026, 9, 26, 12, 0, 0, TimeSpan.Zero))], true)
                : new AccountChangePage([], false));
        }
    }
}
