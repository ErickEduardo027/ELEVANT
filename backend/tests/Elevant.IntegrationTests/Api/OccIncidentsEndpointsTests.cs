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

/// <summary>3-G through the HTTP pipeline: statuses, codes, the ETag and the replay of OCC's incident commands.</summary>
public sealed class OccIncidentsEndpointsTests(ElevantApiFactory factory) : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000001");
    private static readonly Guid OperationId = Guid.Parse("70000000-0000-7000-8000-000000000005");
    private static readonly Guid IncidentId = Guid.Parse("73000000-0000-7000-8000-000000000001");

    [Fact]
    public async Task ListAndReportAnswerCodesTheETagAndTheReplayStatus()
    {
        var state = new State();
        await using var application = Create(state);
        var ct = TestContext.Current.CancellationToken;
        using var anonymous = application.CreateClient();
        using var unauthenticated = await anonymous.GetAsync($"/api/v1/occ/operations/{OperationId:D}/incidents", ct);
        Assert.Equal(HttpStatusCode.Unauthorized, unauthenticated.StatusCode);

        using var client = Authorized(application);
        state.List = MasterDataResult<OccIncidentListData>.Failed(MasterDataFailure.Forbidden, "forbidden");
        using var forbidden = await client.GetAsync($"/api/v1/occ/operations/{OperationId:D}/incidents", ct);
        Assert.Equal((HttpStatusCode.Forbidden, "forbidden"), (forbidden.StatusCode, await CodeOf(forbidden, ct)));
        state.List = MasterDataResult<OccIncidentListData>.Success(new OccIncidentListData(OperationId, "PUJ-20261108-001",
            "InProgress", "America/Santo_Domingo", true, [Incident()]));
        using var listed = await client.GetAsync($"/api/v1/occ/operations/{OperationId:D}/incidents", ct);
        Assert.Equal(HttpStatusCode.OK, listed.StatusCode);
        var list = await listed.Content.ReadFromJsonAsync<JsonElement>(ct);
        Assert.Equal("Seguridad en plataforma", list.GetProperty("incidents")[0].GetProperty("description").GetString());
        Assert.Equal(["InReview", "Resolved"], list.GetProperty("incidents")[0].GetProperty("allowedStatuses")
            .EnumerateArray().Select(item => item.GetString() ?? string.Empty).ToArray());

        const string Report = """{"incidentType":"Safety","severity":"High","description":"Seguridad en plataforma","occurredAt":"2026-11-08T14:00:00Z","delayCode":null}""";
        state.Report = MasterDataResult<OccIncidentData>.Success(Incident());
        using var created = await client.SendAsync(Post($"/api/v1/occ/operations/{OperationId:D}/incidents", Report,
            Guid.NewGuid(), null), ct);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal("\"AAAAAAAAB9E=\"", created.Headers.ETag?.ToString());
        Assert.Equal(("Safety", "High"), (state.ReportInput!.IncidentType, state.ReportInput.Severity));
        state.Report = MasterDataResult<OccIncidentData>.Success(Incident(), replayed: true);
        using var replayed = await client.SendAsync(Post($"/api/v1/occ/operations/{OperationId:D}/incidents", Report,
            Guid.NewGuid(), null), ct);
        Assert.Equal(HttpStatusCode.OK, replayed.StatusCode);
        state.Report = MasterDataResult<OccIncidentData>.Failed(MasterDataFailure.Conflict, "operation_closed");
        using var closed = await client.SendAsync(Post($"/api/v1/occ/operations/{OperationId:D}/incidents", Report,
            Guid.NewGuid(), null), ct);
        Assert.Equal((HttpStatusCode.Conflict, "operation_closed"), (closed.StatusCode, await CodeOf(closed, ct)));
        // A report has no If-Match: a repeated deadlock stays a 409.
        state.Report = MasterDataResult<OccIncidentData>.Failed(MasterDataFailure.Conflict, "version_conflict");
        using var deadlock = await client.SendAsync(Post($"/api/v1/occ/operations/{OperationId:D}/incidents", Report,
            Guid.NewGuid(), null), ct);
        Assert.Equal(HttpStatusCode.Conflict, deadlock.StatusCode);
    }

    [Fact]
    public async Task AStateChangeNeedsItsVersionInIfMatch()
    {
        var state = new State();
        await using var application = Create(state);
        using var client = Authorized(application);
        var ct = TestContext.Current.CancellationToken;
        const string Change = """{"status":"Resolved","note":"Revisado con la aerolínea"}""";
        var path = $"/api/v1/occ/incidents/{IncidentId:D}/status";

        state.Change = MasterDataResult<OccIncidentData>.Failed(MasterDataFailure.Invalid, "expected_version_required");
        using var unversioned = await client.SendAsync(Post(path, Change, Guid.NewGuid(), null), ct);
        Assert.Equal(((HttpStatusCode)428, "expected_version_required"),
            (unversioned.StatusCode, await CodeOf(unversioned, ct)));
        Assert.Null(state.ChangeInput!.ExpectedVersion);
        // A version that is not a strong ETag is a malformed request, never a refused transition; the store is not asked.
        state.Change = MasterDataResult<OccIncidentData>.Failed(MasterDataFailure.Conflict, "incident_transition_invalid");
        foreach (var ifMatch in new[] { "W/\"weak\"", "AAAAAAAAB9E=", "\"AAAA\"AAAA\"" })
        {
            using var malformed = await client.SendAsync(Post(path, Change, Guid.NewGuid(), ifMatch), ct);
            var problem = await malformed.Content.ReadFromJsonAsync<JsonElement>(ct);
            Assert.Equal((HttpStatusCode.BadRequest, "invalid_incident_request", "La versión enviada en If-Match no es válida."),
                (malformed.StatusCode, problem.GetProperty("code").GetString(), problem.GetProperty("title").GetString()));
        }
        Assert.Null(state.ChangeInput.ExpectedVersion);

        state.Change = MasterDataResult<OccIncidentData>.Failed(MasterDataFailure.Conflict, "version_conflict");
        using var stale = await client.SendAsync(Post(path, Change, Guid.NewGuid(), "\"AAAAAAAAB9A=\""), ct);
        Assert.Equal((HttpStatusCode.PreconditionFailed, "version_conflict"), (stale.StatusCode, await CodeOf(stale, ct)));
        Assert.Equal("AAAAAAAAB9A=", state.ChangeInput.ExpectedVersion);

        state.Change = MasterDataResult<OccIncidentData>.Failed(MasterDataFailure.Conflict, "incident_transition_invalid");
        using var invalid = await client.SendAsync(Post(path, Change, Guid.NewGuid(), "\"AAAAAAAAB9E=\""), ct);
        Assert.Equal((HttpStatusCode.Conflict, "incident_transition_invalid"), (invalid.StatusCode, await CodeOf(invalid, ct)));
        // An approved or cancelled operation's incident is not taken back into review.
        state.Change = MasterDataResult<OccIncidentData>.Failed(MasterDataFailure.Conflict, "operation_closed");
        using var closed = await client.SendAsync(Post(path, Change, Guid.NewGuid(), "\"AAAAAAAAB9E=\""), ct);
        var closedProblem = await closed.Content.ReadFromJsonAsync<JsonElement>(ct);
        Assert.Equal((HttpStatusCode.Conflict, "operation_closed", "La operación ya está aprobada o cancelada."),
            (closed.StatusCode, closedProblem.GetProperty("code").GetString(),
                closedProblem.GetProperty("title").GetString()));

        state.Change = MasterDataResult<OccIncidentData>.Success(Incident() with { Status = "Resolved", Version = "AAAAAAAAB9I=" });
        var key = Guid.NewGuid();
        using var resolved = await client.SendAsync(Post(path, Change, key, "\"AAAAAAAAB9E=\""), ct);
        Assert.Equal(HttpStatusCode.OK, resolved.StatusCode);
        Assert.Equal("\"AAAAAAAAB9I=\"", resolved.Headers.ETag?.ToString());
        Assert.Equal((key, "Resolved", "Revisado con la aerolínea"), (state.ChangeKey, state.ChangeInput.Status,
            state.ChangeInput.Note));
    }

    private static OccIncidentData Incident() => new(IncidentId, "Safety", "High", "Open", "Seguridad en plataforma",
        new DateTimeOffset(2026, 11, 8, 14, 0, 0, TimeSpan.Zero), new DateTimeOffset(2026, 11, 8, 14, 2, 0, TimeSpan.Zero),
        null, "Alex Operations", "Occ", null, null, null, "AAAAAAAAB9E=", ["InReview", "Resolved"],
        [new OccIncidentEventData(null, "Open", "Reportada por OCC.", new DateTimeOffset(2026, 11, 8, 14, 2, 0,
            TimeSpan.Zero), "Alex Operations")]);

    private static async Task<string?> CodeOf(HttpResponseMessage response, CancellationToken cancellationToken) =>
        (await response.Content.ReadFromJsonAsync<JsonElement>(cancellationToken)).TryGetProperty("code", out var code)
            ? code.GetString() : null;

    private static HttpRequestMessage Post(string path, string json, Guid key, string? ifMatch)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json"),
        };
        request.Headers.TryAddWithoutValidation("Idempotency-Key", key.ToString("D"));
        if (ifMatch is not null) request.Headers.TryAddWithoutValidation("If-Match", ifMatch);
        return request;
    }

    private WebApplicationFactory<Program> Create(State state) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<IOccIncidentStore>();
            services.AddSingleton(state);
            services.AddScoped<IOccIncidentStore>(_ => state);
        }));

    private static HttpClient Authorized(WebApplicationFactory<Program> application)
    {
        var client = application.CreateClient();
        var now = DateTimeOffset.UtcNow;
        var key = new SymmetricSecurityKey(Convert.FromBase64String(ElevantApiFactory.AuthenticationSigningKeyBase64));
        var token = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Audience = ElevantApiFactory.AuthenticationAudience,
            Expires = now.AddMinutes(15).UtcDateTime,
            IssuedAt = now.UtcDateTime,
            Issuer = ElevantApiFactory.AuthenticationIssuer,
            NotBefore = now.AddSeconds(-5).UtcDateTime,
            SigningCredentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256),
            Subject = new System.Security.Claims.ClaimsIdentity(
            [
                new System.Security.Claims.Claim(JwtRegisteredClaimNames.Sub, AccountId.ToString("D")),
                new System.Security.Claims.Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("D")),
                new System.Security.Claims.Claim(Elevant.Infrastructure.Authentication.SessionSecurityVersion.ClaimType,
                    Elevant.Infrastructure.Authentication.SessionSecurityVersion.Fingerprint(ElevantApiFactory.TestSecurityStamp)),
            ]),
            TokenType = "at+jwt",
        });
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private sealed class State : IOccIncidentStore
    {
        public MasterDataResult<OccIncidentListData> List { get; set; } =
            MasterDataResult<OccIncidentListData>.Failed(MasterDataFailure.NotFound, "not_found");
        public MasterDataResult<OccIncidentData> Report { get; set; } =
            MasterDataResult<OccIncidentData>.Failed(MasterDataFailure.NotFound, "not_found");
        public MasterDataResult<OccIncidentData> Change { get; set; } =
            MasterDataResult<OccIncidentData>.Failed(MasterDataFailure.NotFound, "not_found");
        public OccIncidentReportInput? ReportInput { get; private set; }
        public OccIncidentStatusInput? ChangeInput { get; private set; }
        public Guid? ChangeKey { get; private set; }

        public Task<MasterDataResult<OccIncidentListData>> ListAsync(Guid actorId, Guid operationId,
            CancellationToken cancellationToken = default) => Task.FromResult(List);

        public Task<MasterDataResult<OccIncidentData>> ReportAsync(Guid actorId, Guid operationId,
            OccIncidentReportInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default)
        {
            ReportInput = input;
            return Task.FromResult(Report);
        }

        public Task<MasterDataResult<OccIncidentData>> ChangeStatusAsync(Guid actorId, Guid incidentId,
            OccIncidentStatusInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default)
        {
            (ChangeInput, ChangeKey) = (input, idempotencyKey);
            return Task.FromResult(Change);
        }
    }
}
