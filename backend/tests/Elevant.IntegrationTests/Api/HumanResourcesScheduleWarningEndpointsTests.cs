using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

public sealed class HumanResourcesScheduleWarningEndpointsTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000004");
    private static readonly Guid StationId = Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly Guid OtherStationId = Guid.Parse("20000000-0000-7000-8000-000000000091");
    private const string Route = "/api/v1/human-resources/schedule-warnings";

    [Fact]
    public async Task AuthorizedPageIsPrivateAndOmitsRestrictedStationDetails()
    {
        var state = new StubStore();
        await using var app = Application(state);
        using var anonymous = app.CreateClient();
        using var denied = await anonymous.GetAsync(Query(),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, denied.StatusCode);
        Assert.Contains("no-store", denied.Headers.CacheControl?.ToString(),
            StringComparison.Ordinal);

        using var client = Authenticated(app);
        using var response = await client.GetAsync(Query(),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString(),
            StringComparison.Ordinal);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>(
            TestContext.Current.CancellationToken);
        Assert.Equal(StationId, json.GetProperty("stationId").GetGuid());
        Assert.Equal("dev-2026-10-05", json.GetProperty("ruleVersion").GetString());
        var warning = Assert.Single(json.GetProperty("warnings").EnumerateArray());
        Assert.Equal("ShortRest", warning.GetProperty("kind").GetString());
        Assert.True(warning.GetProperty("hasRestrictedEvidence").GetBoolean());
        Assert.Equal(JsonValueKind.Null, warning.GetProperty("measuredMinutes").ValueKind);
        var serialized = json.GetRawText();
        Assert.DoesNotContain(OtherStationId.ToString("D"), serialized,
            StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("JFK", serialized, StringComparison.Ordinal);
        Assert.DoesNotContain("2026-10-04T23:00", serialized, StringComparison.Ordinal);
        Assert.Equal(1, state.ReadCount);
    }

    [Theory]
    [InlineData("stationId=00000000-0000-0000-0000-000000000000&from=2026-10-01&to=2026-10-30")]
    [InlineData("from=2026-10-01&to=2026-10-31")]
    [InlineData("from=2026-10-30&to=2026-10-01")]
    [InlineData("from=2026-10-01&to=2026-10-30&page=0")]
    [InlineData("from=2026-10-01&to=2026-10-30&limit=101")]
    public async Task InvalidQueryNeverReadsStore(string rawQuery)
    {
        var state = new StubStore();
        await using var app = Application(state);
        using var client = Authenticated(app);
        var query = rawQuery.Contains("stationId=", StringComparison.Ordinal)
            ? rawQuery : $"stationId={StationId}&{rawQuery}";
        using var response = await client.GetAsync($"{Route}?{query}",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(0, state.ReadCount);
    }

    [Theory]
    [InlineData(ScheduleWarningFailure.ForbiddenRole, HttpStatusCode.Forbidden)]
    [InlineData(ScheduleWarningFailure.ForbiddenStation, HttpStatusCode.NotFound)]
    public async Task DenialNeverReturnsWarningData(ScheduleWarningFailure failure,
        HttpStatusCode status)
    {
        var state = new StubStore { Failure = failure };
        await using var app = Application(state);
        using var client = Authenticated(app);
        using var response = await client.GetAsync(Query(),
            TestContext.Current.CancellationToken);
        Assert.Equal(status, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString(),
            StringComparison.Ordinal);
        Assert.DoesNotContain("DEV-SCHEDULE-001",
            await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken),
            StringComparison.Ordinal);
    }

    private static string Query() =>
        $"{Route}?stationId={StationId}&from=2026-10-01&to=2026-10-30&page=1&limit=20";

    private WebApplicationFactory<Program> Application(StubStore state) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<IHumanResourcesScheduleWarningStore>();
            services.AddScoped<IHumanResourcesScheduleWarningStore>(_ => state);
        }));

    private static HttpClient Authenticated(WebApplicationFactory<Program> app)
    {
        var client = app.CreateClient();
        var now = DateTimeOffset.UtcNow;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Bearer", new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
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
                Subject = new System.Security.Claims.ClaimsIdentity([
                    new System.Security.Claims.Claim(JwtRegisteredClaimNames.Sub,
                        AccountId.ToString("D")),
                    new System.Security.Claims.Claim(JwtRegisteredClaimNames.Jti,
                        Guid.NewGuid().ToString("D")),
                    new System.Security.Claims.Claim(
                        Elevant.Infrastructure.Authentication.SessionSecurityVersion.ClaimType,
                        Elevant.Infrastructure.Authentication.SessionSecurityVersion.Fingerprint(
                            ElevantApiFactory.TestSecurityStamp)),
                ]),
                TokenType = "at+jwt",
            }));
        return client;
    }

    private sealed class StubStore : IHumanResourcesScheduleWarningStore
    {
        public ScheduleWarningFailure? Failure { get; set; }
        public int ReadCount { get; private set; }

        public Task<ScheduleWarningReadResult> ListAsync(Guid actorId,
            Guid stationId, DateOnly startDate, DateOnly endDate,
            int page, int limit, CancellationToken cancellationToken = default)
        {
            ReadCount++;
            Assert.Equal(AccountId, actorId);
            Assert.Equal(StationId, stationId);
            if (Failure is { } failure)
                return Task.FromResult(new ScheduleWarningReadResult(null, failure));
            var anchorId = Guid.Parse("50000000-0000-7000-8000-000000000011");
            var warning = new ScheduleWarning(anchorId, Guid.NewGuid(),
                "Synthetic agent", "DEV-SCHEDULE-001", startDate,
                ScheduleWarningKind.ShortRest,
                [new ScheduleWarningEvidence(anchorId, stationId, "PUJ",
                    new DateTimeOffset(2026, 10, 1, 12, 0, 0, TimeSpan.Zero),
                    new DateTimeOffset(2026, 10, 1, 20, 0, 0, TimeSpan.Zero))],
                true, null, 720, "dev-2026-10-05", new DateOnly(2026, 10, 5), null);
            return Task.FromResult(new ScheduleWarningReadResult(
                new ScheduleWarningPage(stationId, startDate, endDate,
                    page, limit, false, DateTimeOffset.UtcNow,
                    "dev-2026-10-05", new DateOnly(2026, 10, 5), [warning]), null));
        }
    }
}
