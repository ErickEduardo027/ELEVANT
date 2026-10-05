using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Globalization;
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
    private static readonly Guid OccAccountId = Guid.Parse("40000000-0000-7000-8000-000000000001");

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
    public async Task ShiftRecordingHasAnAuthenticatedVersionedRoute()
    {
        using var client = factory.CreateClient();
        using var anonymous = await client.PutAsync(
            $"/api/v1/human-resources/shifts/{Guid.NewGuid():D}",
            new StringContent("{}"), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        using var response = await client.GetAsync("/swagger/v1/swagger.json",
            TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        var endpoint = json.RootElement.GetProperty("paths")
            .GetProperty("/api/v1/human-resources/shifts/{id}").GetProperty("put");
        Assert.True(endpoint.GetProperty("deprecated").GetBoolean());
        Assert.True(endpoint.GetProperty("responses").TryGetProperty("200", out _));
        Assert.True(endpoint.GetProperty("responses").TryGetProperty("409", out _));
    }

    [Fact]
    public async Task AssignmentOptionsRequireAuthenticationAndPublishAnExactAgentDateRoute()
    {
        using var client = factory.CreateClient();
        using var anonymous = await client.GetAsync(
            $"/api/v1/human-resources/shifts/options?rampProfileId={Guid.NewGuid():D}&workDate=2026-10-01",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        using var response = await client.GetAsync("/swagger/v1/swagger.json",
            TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        var endpoint = json.RootElement.GetProperty("paths")
            .GetProperty("/api/v1/human-resources/shifts/options").GetProperty("get");
        Assert.True(endpoint.GetProperty("responses").TryGetProperty("200", out _));
        Assert.True(endpoint.GetProperty("responses").TryGetProperty("403", out _));
    }

    [Fact]
    public async Task AssignmentOptionsRequireBothFiltersAndReturnOnlyTheStoreResult()
    {
        var agentId = Guid.NewGuid();
        var stationId = Guid.NewGuid();
        var terminalId = Guid.NewGuid();
        var date = new DateOnly(2026, 10, 1);
        var stub = new Stub { Options = new HumanResourcesShiftAssignmentOptions(agentId,
            date, false, [new HumanResourcesShiftStationOption(stationId, "PUJ",
                [new HumanResourcesShiftTerminalOption(terminalId, "A")])]) };
        await using var application = factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IHumanResourcesShiftReadStore>();
                services.AddSingleton<IHumanResourcesShiftReadStore>(stub);
            }));
        using var client = application.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());
        using var missing = await client.GetAsync(
            $"/api/v1/human-resources/shifts/options?rampProfileId={agentId:D}",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        using var response = await client.GetAsync(
            $"/api/v1/human-resources/shifts/options?rampProfileId={agentId:D}&workDate=2026-10-01",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal((AccountId, agentId, date), stub.OptionsRequest);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        Assert.Equal(terminalId, json.RootElement.GetProperty("stations")[0]
            .GetProperty("terminals")[0].GetProperty("id").GetGuid());
    }

    [Fact]
    public async Task AuthenticatedShiftRecordingPassesExactIntentAndMapsConflict()
    {
        var id = Guid.NewGuid();
        var input = new RecordHumanResourcesShiftInput(Guid.NewGuid(), Guid.NewGuid(),
            Guid.NewGuid(), new DateOnly(2026, 10, 1), new TimeOnly(6, 0),
            new TimeOnly(14, 0), "Development coverage");
        var stub = new WriteStub();
        await using var application = factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IHumanResourcesShiftWriteStore>();
                services.AddSingleton<IHumanResourcesShiftWriteStore>(stub);
            }));
        using var client = application.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token(OccAccountId));
        using var first = await client.PutAsJsonAsync(
            $"/api/v1/human-resources/shifts/{id:D}", input,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal((OccAccountId, id, input), stub.Request);
        using var json = JsonDocument.Parse(await first.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        Assert.Equal(id, json.RootElement.GetProperty("id").GetGuid());

        stub.Conflict = true;
        using var second = await client.PutAsJsonAsync(
            $"/api/v1/human-resources/shifts/{id:D}", input,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
    }

    [Fact]
    public async Task ShiftRecordingMapsForbiddenWithoutPublishingAResult()
    {
        var stub = new WriteStub { Forbidden = true };
        await using var application = factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IHumanResourcesShiftWriteStore>();
                services.AddSingleton<IHumanResourcesShiftWriteStore>(stub);
            }));
        using var client = application.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());
        var input = new RecordHumanResourcesShiftInput(Guid.NewGuid(), Guid.NewGuid(),
            Guid.NewGuid(), new DateOnly(2026, 10, 1), new TimeOnly(6, 0),
            new TimeOnly(14, 0), null);
        using var response = await client.PutAsJsonAsync(
            $"/api/v1/human-resources/shifts/{Guid.NewGuid():D}", input,
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.NotNull(stub.Request);
    }

    [Fact]
    public async Task ReturnsBoundedRangeAndRejectsInvalidRangeOrPaging()
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
            "/api/v1/human-resources/shifts?from=2026-10-01&to=2026-11-01",
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

    [Theory]
    [InlineData("2026-10-01", "2026-10-31")]
    [InlineData("2028-02-01", "2028-02-29")]
    [InlineData("2026-08-17", "2026-08-31")]
    public async Task AcceptsMonthAndFifteenDayReadRanges(string from, string to)
    {
        var start = DateOnly.ParseExact(from, "yyyy-MM-dd", CultureInfo.InvariantCulture);
        var end = DateOnly.ParseExact(to, "yyyy-MM-dd", CultureInfo.InvariantCulture);
        var stub = new Stub
        {
            Data = new HumanResourcesShiftPage(start, end,
                1, 20, false, []),
        };
        await using var application = factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IHumanResourcesShiftReadStore>();
                services.AddSingleton<IHumanResourcesShiftReadStore>(stub);
            }));
        using var client = application.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());

        using var response = await client.GetAsync(
            $"/api/v1/human-resources/shifts?from={from}&to={to}&page=1&limit=20",
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal((AccountId, start, end, 1, 20),
            stub.Request);
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

    private static string Token(Guid? accountId = null)
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
                new System.Security.Claims.Claim(JwtRegisteredClaimNames.Sub,
                    (accountId ?? AccountId).ToString("D")),
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
        public HumanResourcesShiftAssignmentOptions? Options { get; init; }
        public (Guid AccountId, DateOnly From, DateOnly To, int Page, int Limit)? Request { get; private set; }
        public (Guid AccountId, Guid RampProfileId, DateOnly WorkDate)? OptionsRequest { get; private set; }

        public Task<HumanResourcesShiftPage?> ListAsync(Guid actorId, DateOnly from, DateOnly to,
            int page, int limit, CancellationToken cancellationToken = default)
        {
            Request = (actorId, from, to, page, limit);
            return Task.FromResult(Data);
        }

        public Task<HumanResourcesShiftAssignmentOptions?> GetAssignmentOptionsAsync(
            Guid actorId, Guid rampProfileId, DateOnly workDate,
            CancellationToken cancellationToken = default)
        {
            OptionsRequest = (actorId, rampProfileId, workDate);
            return Task.FromResult(Options);
        }
    }

    private sealed class WriteStub : IHumanResourcesShiftWriteStore
    {
        public (Guid ActorId, Guid ShiftId, RecordHumanResourcesShiftInput Input)? Request
        { get; private set; }
        public bool Conflict { get; set; }
        public bool Forbidden { get; set; }

        public Task<HumanResourcesShiftWriteResult> RecordAsync(Guid actorId, Guid shiftId,
            RecordHumanResourcesShiftInput input, CancellationToken cancellationToken = default)
        {
            Request = (actorId, shiftId, input);
            return Task.FromResult(Forbidden
                ? HumanResourcesShiftWriteResult.Failed(HumanResourcesShiftWriteFailure.Forbidden)
                : Conflict
                    ? HumanResourcesShiftWriteResult.Failed(HumanResourcesShiftWriteFailure.Conflict)
                    : HumanResourcesShiftWriteResult.Success(shiftId));
        }
    }
}
