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

public sealed class AttendanceDraftEndpointsTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000001");
    private static readonly Guid StationId = Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly Guid OperationId = Guid.Parse("70000000-0000-7000-8000-000000000005");
    private static readonly Guid AssignmentId = Guid.Parse("70000000-0000-7000-8000-000000000006");
    private static readonly Guid InstallationId = Guid.Parse("81000000-0000-7000-8000-000000000041");
    private static readonly Guid Key = Guid.Parse("82000000-0000-7000-8000-000000000041");
    private const string Path = "/api/v1/operations/70000000-0000-7000-8000-000000000005/assignments/70000000-0000-7000-8000-000000000006/attendance-draft";

    [Fact]
    public async Task ReadRequiresBearerAndReturnsBothNullLanes()
    {
        var state = new StubStore();
        await using var app = CreateApplication(state);
        using var anonymous = app.CreateClient();
        using var denied = await anonymous.GetAsync(Path, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, denied.StatusCode);
        AssertPrivate(denied);

        using var client = CreateAuthenticatedClient(app);
        using var response = await client.GetAsync(Path, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        AssertPrivate(response);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(
            TestContext.Current.CancellationToken);
        Assert.Equal(OperationId, body.GetProperty("operationId").GetGuid());
        Assert.Equal(AssignmentId, body.GetProperty("assignmentId").GetGuid());
        Assert.Equal(StationId, body.GetProperty("stationId").GetGuid());
        Assert.Equal(JsonValueKind.Null, body.GetProperty("occ").ValueKind);
        Assert.Equal(JsonValueKind.Null, body.GetProperty("rampAgent").ValueKind);
        Assert.Equal((AccountId, OperationId, AssignmentId, (Guid?)null), state.LastRead);
    }

    [Theory]
    [InlineData("occ", false)]
    [InlineData("ramp-agent", true)]
    public async Task WriteDerivesLaneAndActorFromRouteAndToken(string route, bool mobile)
    {
        var state = new StubStore();
        await using var app = CreateApplication(state);
        using var client = CreateAuthenticatedClient(app);
        using var request = NewWrite(route, mobile);
        using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        AssertPrivate(response);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(
            TestContext.Current.CancellationToken);
        Assert.Equal(1, body.GetProperty("contribution").GetProperty("revision").GetInt32());
        Assert.False(body.GetProperty("replayed").GetBoolean());
        Assert.NotNull(state.LastWrite);
        Assert.Equal(AccountId, state.LastWrite.ActorAccountId);
        Assert.Equal(mobile ? AttendanceDraftLane.RampAgent : AttendanceDraftLane.Occ,
            state.LastWrite.Lane);
        Assert.Equal(mobile ? InstallationId : null, state.LastWrite.InstallationId);
        Assert.Equal(Key, state.LastWrite.IdempotencyKey);
    }

    [Theory]
    [InlineData("{\"incidentNote\":\"Ok\"}")]
    [InlineData("{\"expectedRevision\":0,\"incidentNote\":\" \"}")]
    [InlineData("{\"expectedRevision\":-1,\"incidentNote\":\"Ok\"}")]
    [InlineData("{\"expectedRevision\":0,\"incidentNote\":\"Ok\",\"lane\":\"Occ\"}")]
    [InlineData("{\"expectedRevision\":0,\"incidentNote\":\"Ok\",\"authorAccountId\":\"40000000-0000-7000-8000-000000000001\"}")]
    public async Task WriteRejectsInvalidOrCallerSelectedFields(string json)
    {
        var state = new StubStore();
        await using var app = CreateApplication(state);
        using var client = CreateAuthenticatedClient(app);
        using var request = NewWrite("occ", false, json);
        using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        AssertPrivate(response);
        Assert.Null(state.LastWrite);
    }

    [Fact]
    public async Task RampReadAndWriteRequireInstallationAndWritesRequireIdempotency()
    {
        var state = new StubStore();
        await using var app = CreateApplication(state);
        using var client = CreateAuthenticatedClient(app);
        using var missingKey = NewWrite("ramp-agent", true);
        missingKey.Headers.Remove("Idempotency-Key");
        using var missingKeyResponse = await client.SendAsync(missingKey,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, missingKeyResponse.StatusCode);

        using var missingInstallation = NewWrite("ramp-agent", false);
        using var missingInstallationResponse = await client.SendAsync(missingInstallation,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, missingInstallationResponse.StatusCode);
        Assert.Null(state.LastWrite);

        using var read = new HttpRequestMessage(HttpMethod.Get, Path);
        read.Headers.Add("X-Elevant-Installation-Id", InstallationId.ToString("D"));
        using var readResponse = await client.SendAsync(read, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, readResponse.StatusCode);
        Assert.Equal(InstallationId, state.LastRead?.InstallationId);
    }

    [Theory]
    [InlineData(AttendanceDraftFailure.Forbidden, HttpStatusCode.Forbidden)]
    [InlineData(AttendanceDraftFailure.NotFound, HttpStatusCode.NotFound)]
    [InlineData(AttendanceDraftFailure.Conflict, HttpStatusCode.Conflict)]
    public async Task WriteMapsStoreFailures(AttendanceDraftFailure failure,
        HttpStatusCode expectedStatus)
    {
        var state = new StubStore { WriteFailure = failure };
        await using var app = CreateApplication(state);
        using var client = CreateAuthenticatedClient(app);
        using var request = NewWrite("occ", false);
        using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);
        Assert.Equal(expectedStatus, response.StatusCode);
        AssertPrivate(response);
    }

    [Fact]
    public async Task WriteRejectsOversizedJsonBeforeStore()
    {
        var state = new StubStore();
        await using var app = CreateApplication(state);
        using var client = CreateAuthenticatedClient(app);
        using var request = NewWrite("occ", false,
            $"{{\"expectedRevision\":0,\"incidentNote\":\"{new string('x', 17000)}\"}}");
        using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        Assert.Null(state.LastWrite);
    }

    [Fact]
    public async Task OpenApiRequiresExplicitNullableDraftFields()
    {
        using var client = factory.CreateClient();
        using var response = await client.GetAsync("/swagger/v1/swagger.json",
            TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        var document = await response.Content.ReadFromJsonAsync<JsonElement>(
            TestContext.Current.CancellationToken);
        var schemas = document.GetProperty("components").GetProperty("schemas");
        var contributionRequired = schemas.GetProperty("AttendanceDraftContributionResponse")
            .GetProperty("required").EnumerateArray().Select(item => item.GetString()).ToArray();
        Assert.Contains("observedStartAt", contributionRequired);
        Assert.Contains("observedEndAt", contributionRequired);
        Assert.Contains("incidentNote", contributionRequired);
        var snapshotRequired = schemas.GetProperty("AttendanceDraftSnapshotResponse")
            .GetProperty("required").EnumerateArray().Select(item => item.GetString()).ToArray();
        Assert.Contains("occ", snapshotRequired);
        Assert.Contains("rampAgent", snapshotRequired);
    }

    private WebApplicationFactory<Program> CreateApplication(StubStore state) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<IAttendanceDraftStore>();
            services.AddScoped<IAttendanceDraftStore>(_ => state);
        }));

    private static HttpRequestMessage NewWrite(string lane, bool mobile, string? json = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Put, $"{Path}/{lane}");
        request.Headers.Add("Idempotency-Key", Key.ToString("D"));
        if (mobile) request.Headers.Add("X-Elevant-Installation-Id", InstallationId.ToString("D"));
        request.Content = new StringContent(json ??
            "{\"expectedRevision\":0,\"incidentNote\":\"Equipo listo\"}",
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

    private sealed class StubStore : IAttendanceDraftStore
    {
        public (Guid ActorId, Guid OperationId, Guid AssignmentId, Guid? InstallationId)? LastRead { get; private set; }
        public AttendanceDraftWriteRequest? LastWrite { get; private set; }
        public AttendanceDraftFailure? WriteFailure { get; init; }

        public Task<AttendanceDraftReadResult> GetAsync(Guid actorAccountId,
            Guid operationId, Guid assignmentId, Guid? installationId,
            CancellationToken cancellationToken = default)
        {
            LastRead = (actorAccountId, operationId, assignmentId, installationId);
            return Task.FromResult(AttendanceDraftReadResult.Success(
                new AttendanceDraftSnapshotData(operationId, assignmentId,
                    StationId, null, null)));
        }

        public Task<AttendanceDraftWriteResult> SaveAsync(AttendanceDraftWriteRequest request,
            CancellationToken cancellationToken = default)
        {
            LastWrite = request;
            return Task.FromResult(WriteFailure is AttendanceDraftFailure failure
                ? AttendanceDraftWriteResult.Failed(failure)
                : AttendanceDraftWriteResult.Success(new AttendanceDraftContributionData(
                    1, request.ActorAccountId, DateTimeOffset.UtcNow,
                    request.ObservedStartAt, request.ObservedEndAt,
                    request.IncidentNote)));
        }
    }
}
