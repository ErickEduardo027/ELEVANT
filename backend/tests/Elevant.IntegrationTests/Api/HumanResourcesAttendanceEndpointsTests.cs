using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

public sealed class HumanResourcesAttendanceEndpointsTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000001");
    private static readonly Guid StationId = Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly Guid AssignmentId = Guid.Parse("70000000-0000-7000-8000-000000000006");
    private static readonly Guid Key = Guid.Parse("82000000-0000-7000-8000-000000000052");
    private static readonly DateTimeOffset Start = new(2026, 10, 5, 10, 0, 0, TimeSpan.Zero);
    private const string Route = "/api/v1/human-resources/attendance";

    [Fact]
    public async Task GetRequiresBearerAndMapsScopedPage()
    {
        var state = new StubStore();
        await using var app = CreateApplication(state);
        using var anonymous = app.CreateClient();
        using var denied = await anonymous.GetAsync(Query(), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, denied.StatusCode);
        AssertPrivate(denied);

        using var client = CreateAuthenticatedClient(app);
        using var response = await client.GetAsync(Query(), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        AssertPrivate(response);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>(
            TestContext.Current.CancellationToken);
        Assert.Equal(StationId, json.GetProperty("stationId").GetGuid());
        Assert.Equal(AssignmentId, json.GetProperty("items")[0].GetProperty("assignmentId").GetGuid());
        Assert.Equal(1, json.GetProperty("items")[0].GetProperty("occ")
            .GetProperty("revision").GetInt32());
        Assert.Equal((AccountId, StationId, new DateOnly(2026, 10, 1),
            new DateOnly(2026, 10, 5), 1, 20), state.LastRead);
    }

    [Theory]
    [InlineData("from=2026-10-01&to=2026-11-01")]
    [InlineData("from=2026-10-01&to=2026-10-31")]
    [InlineData("from=2026-10-05&to=2026-10-01")]
    [InlineData("from=2026-10-01&to=2026-10-05&page=0")]
    [InlineData("from=2026-10-01&to=2026-10-05&limit=101")]
    public async Task GetRejectsInvalidPagingOrRangeBeforeStore(string query)
    {
        var state = new StubStore();
        await using var app = CreateApplication(state);
        using var client = CreateAuthenticatedClient(app);
        using var response = await client.GetAsync($"{Route}?stationId={StationId}&{query}",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        AssertPrivate(response);
        Assert.Null(state.LastRead);
    }

    [Fact]
    public async Task GetDeniesWrongRoleAndDoesNotRevealAnyRows()
    {
        var state = new StubStore { ReadForbidden = true };
        await using var app = CreateApplication(state);
        using var client = CreateAuthenticatedClient(app);
        using var response = await client.GetAsync(Query(), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        AssertPrivate(response);
        var body = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
        Assert.DoesNotContain("EV 311", body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task PutUsesTokenAndIdempotencyHeaderAndReturnsDecision()
    {
        var state = new StubStore { Replayed = true };
        await using var app = CreateApplication(state);
        using var client = CreateAuthenticatedClient(app);
        using var request = NewWrite();
        using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        AssertPrivate(response);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(
            TestContext.Current.CancellationToken);
        Assert.True(body.GetProperty("replayed").GetBoolean());
        Assert.Equal(Start, body.GetProperty("decision").GetProperty("startAt")
            .GetDateTimeOffset());
        Assert.NotNull(state.LastWrite);
        Assert.Equal(AccountId, state.LastWrite.ActorAccountId);
        Assert.Equal(StationId, state.LastWrite.StationId);
        Assert.Equal(AssignmentId, state.LastWrite.AssignmentId);
        Assert.Equal(Key, state.LastWrite.IdempotencyKey);
        Assert.Equal("RampAgent", state.LastWrite.EndSource);
    }

    [Theory]
    [InlineData(AttendanceValidationFailure.Forbidden, HttpStatusCode.Forbidden)]
    [InlineData(AttendanceValidationFailure.NotFound, HttpStatusCode.NotFound)]
    [InlineData(AttendanceValidationFailure.Conflict, HttpStatusCode.Conflict)]
    public async Task PutMapsStoreFailures(AttendanceValidationFailure failure,
        HttpStatusCode status)
    {
        var state = new StubStore { WriteFailure = failure };
        await using var app = CreateApplication(state);
        using var client = CreateAuthenticatedClient(app);
        using var request = NewWrite();
        using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);
        Assert.Equal(status, response.StatusCode);
        AssertPrivate(response);
    }

    [Theory]
    [InlineData("{\"expectedOccRevision\":1,\"expectedRampAgentRevision\":1,\"startSource\":\"OCC\",\"endSource\":\"RampAgent\"}")]
    [InlineData("{\"expectedOccRevision\":0,\"expectedRampAgentRevision\":1,\"startSource\":\"Occ\",\"endSource\":\"RampAgent\"}")]
    [InlineData("{\"expectedOccRevision\":1,\"expectedRampAgentRevision\":1,\"startSource\":\"Occ\",\"endSource\":\"RampAgent\",\"validatedByAccountId\":\"40000000-0000-7000-8000-000000000001\"}")]
    public async Task PutRejectsMalformedOrCallerSelectedFields(string json)
    {
        var state = new StubStore();
        await using var app = CreateApplication(state);
        using var client = CreateAuthenticatedClient(app);
        using var request = NewWrite(json);
        using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Null(state.LastWrite);
    }

    [Fact]
    public async Task PutRequiresIdempotencyHeader()
    {
        var state = new StubStore();
        await using var app = CreateApplication(state);
        using var client = CreateAuthenticatedClient(app);
        using var request = NewWrite();
        request.Headers.Remove("Idempotency-Key");
        using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Null(state.LastWrite);
    }

    [Fact]
    public async Task OpenApiPublishesRequiredStationScopeAndRevisionBoundBody()
    {
        using var client = factory.CreateClient();
        using var response = await client.GetAsync("/swagger/v1/swagger.json",
            TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        var document = await response.Content.ReadFromJsonAsync<JsonElement>(
            TestContext.Current.CancellationToken);
        var paths = document.GetProperty("paths");
        var get = paths.GetProperty(Route).GetProperty("get");
        Assert.Equal("GetHumanResourcesAttendance", get.GetProperty("operationId").GetString());
        Assert.Contains(get.GetProperty("parameters").EnumerateArray(), item =>
            item.GetProperty("name").GetString() == "stationId" &&
            item.GetProperty("required").GetBoolean());
        var put = paths.GetProperty($"{Route}/{{assignmentId}}/validation")
            .GetProperty("put");
        Assert.Equal("ValidateHumanResourcesAttendance",
            put.GetProperty("operationId").GetString());
        Assert.Contains(put.GetProperty("parameters").EnumerateArray(), item =>
            item.GetProperty("name").GetString() == "Idempotency-Key" &&
            item.GetProperty("required").GetBoolean());
        var schemas = document.GetProperty("components").GetProperty("schemas");
        var required = schemas.GetProperty("ValidateAttendanceRequest")
            .GetProperty("required").EnumerateArray()
            .Select(item => item.GetString()).ToArray();
        Assert.Contains("expectedOccRevision", required);
        Assert.Contains("expectedRampAgentRevision", required);
        Assert.Contains("startSource", required);
        Assert.Contains("endSource", required);
    }

    private static string Query() =>
        $"{Route}?stationId={StationId}&from=2026-10-01&to=2026-10-05&page=1&limit=20";

    private WebApplicationFactory<Program> CreateApplication(StubStore state) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<IAttendanceValidationStore>();
            services.AddScoped<IAttendanceValidationStore>(_ => state);
        }));

    private static HttpRequestMessage NewWrite(string? json = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Put,
            $"{Route}/{AssignmentId}/validation?stationId={StationId}");
        request.Headers.Add("Idempotency-Key", Key.ToString("D"));
        request.Content = new StringContent(json ??
            "{\"expectedOccRevision\":1,\"expectedRampAgentRevision\":1,\"startSource\":\"Occ\",\"endSource\":\"RampAgent\",\"reason\":\"Incidencia revisada\"}",
            Encoding.UTF8, "application/json");
        return request;
    }

    private static HttpClient CreateAuthenticatedClient(WebApplicationFactory<Program> app)
    {
        var client = app.CreateClient();
        var now = DateTimeOffset.UtcNow;
        var key = new SymmetricSecurityKey(Convert.FromBase64String(
            ElevantApiFactory.AuthenticationSigningKeyBase64));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Bearer", new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
            {
                Audience = ElevantApiFactory.AuthenticationAudience,
                Expires = now.AddMinutes(15).UtcDateTime,
                IssuedAt = now.UtcDateTime,
                Issuer = ElevantApiFactory.AuthenticationIssuer,
                NotBefore = now.AddSeconds(-5).UtcDateTime,
                SigningCredentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256),
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

    private static void AssertPrivate(HttpResponseMessage response) =>
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString(),
            StringComparison.Ordinal);

    private sealed class StubStore : IAttendanceValidationStore
    {
        public (Guid Actor, Guid Station, DateOnly From, DateOnly To, int Page, int Limit)? LastRead { get; private set; }
        public AttendanceValidationCommand? LastWrite { get; private set; }
        public bool ReadForbidden { get; init; }
        public bool Replayed { get; init; }
        public AttendanceValidationFailure? WriteFailure { get; init; }

        public Task<HumanResourcesAttendancePage?> ListAsync(Guid actorAccountId,
            Guid stationId, DateOnly startDate, DateOnly endDate,
            int page, int limit, CancellationToken cancellationToken = default)
        {
            LastRead = (actorAccountId, stationId, startDate, endDate, page, limit);
            if (ReadForbidden) return Task.FromResult<HumanResourcesAttendancePage?>(null);
            return Task.FromResult<HumanResourcesAttendancePage?>(new(
                stationId, startDate, endDate, page, limit, false,
                [new HumanResourcesAttendanceRow(Guid.NewGuid(), AssignmentId,
                    stationId, startDate, "EV 311", "Agente de prueba",
                    new AttendanceDraftContributionData(1, AccountId, Start,
                        Start, Start.AddHours(2), null), null, null, false)]));
        }

        public Task<AttendanceValidationResult> ValidateAsync(
            AttendanceValidationCommand command,
            CancellationToken cancellationToken = default)
        {
            LastWrite = command;
            return Task.FromResult(WriteFailure is AttendanceValidationFailure failure
                ? AttendanceValidationResult.Failed(failure)
                : AttendanceValidationResult.Success(new AttendanceValidationDecisionData(
                    Guid.NewGuid(), AssignmentId, 1, 1, "Occ", "RampAgent", Start,
                    Start.AddHours(2), "Incidencia revisada", AccountId, Start), Replayed));
        }
    }
}
