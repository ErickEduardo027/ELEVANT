using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

/// <summary>
/// Phase 3, block B over HTTP: the coverage commands forward their Idempotency-Key (3-J), «Liberar agente» names the
/// assignment OCC saw (3-J) and «Relevar agente» hands a started operation over (3-F). Every failure answers Problem
/// Details with its stable code; a refused permission stays a bare 403. The rules live in the store (SQL tests).
/// </summary>
public sealed class OccCoverageEndpointsTests(ElevantApiFactory factory) : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000001");
    private static readonly Guid StationId = Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly Guid TurnaroundId = Guid.Parse("70000000-0000-7000-8000-000000000012");
    private static readonly Guid AssignmentId = Guid.Parse("71000000-0000-7000-8000-000000000001");
    private static readonly Guid NewAssignmentId = Guid.Parse("71000000-0000-7000-8000-000000000002");
    private static readonly Guid Riley = Guid.Parse("33000000-0000-7000-8000-000000000001");
    private static readonly Guid Ximena = Guid.Parse("33000000-0000-7000-8000-000000000002");

    [Fact]
    public async Task HandoverForwardsTheKeyAndTheAssignmentAndNamesEveryRefusal()
    {
        var stub = new Stub();
        await using var application = Application(stub);
        using var client = Authenticated(application);
        var key = Guid.NewGuid();
        var route = $"/api/v1/occ/planning/turnarounds/{TurnaroundId:D}/assignment/handover";
        var body = $$"""{"agentId":"{{Ximena:D}}","expectedAssignmentId":"{{AssignmentId:D}}","reason":"El agente pasa a B21."}""";

        using (var handed = await SendAsync(client, HttpMethod.Post, route, body, key))
        {
            Assert.Equal(HttpStatusCode.OK, handed.StatusCode);
            using var json = await JsonAsync(handed);
            Assert.Equal(["turnaroundId", "assignmentId", "agentId", "previousAgentId", "replayed"],
                json.RootElement.EnumerateObject().Select(property => property.Name).ToArray());
            Assert.Equal(NewAssignmentId, json.RootElement.GetProperty("assignmentId").GetGuid());
        }
        Assert.Equal((TurnaroundId, new HandOverOperationInput(Ximena, AssignmentId, "El agente pasa a B21."), (Guid?)key),
            stub.Handover);

        // The new command needs its key: the store answers why without one.
        stub.HandoverFailure = (PositionCoverageFailure.Invalid, "idempotency_key_required");
        using (var keyless = await SendAsync(client, HttpMethod.Post, route, body, null))
            await AssertProblemAsync(keyless, HttpStatusCode.BadRequest, "idempotency_key_required");
        Assert.Null(stub.Handover!.Value.Key);

        // An unknown member is refused before the store.
        stub.Handover = null;
        using (var unknown = await SendAsync(client, HttpMethod.Post, route,
                   $$"""{"agentId":"{{Ximena:D}}","expectedAssignmentId":"{{AssignmentId:D}}","reason":"Relevo.","stationId":"x"}""",
                   key))
            Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);
        Assert.Null(stub.Handover);

        foreach (var (failure, code, status) in new[]
                 {
                     (PositionCoverageFailure.Conflict, "assignment_changed", HttpStatusCode.Conflict),
                     (PositionCoverageFailure.Conflict, "handover_not_allowed", HttpStatusCode.Conflict),
                     (PositionCoverageFailure.Conflict, "agent_not_eligible", HttpStatusCode.Conflict),
                     (PositionCoverageFailure.Conflict, "idempotency_conflict", HttpStatusCode.Conflict),
                     (PositionCoverageFailure.Invalid, "same_agent", HttpStatusCode.BadRequest),
                     (PositionCoverageFailure.Invalid, "reason_required", HttpStatusCode.BadRequest),
                     (PositionCoverageFailure.NotFound, "not_found", HttpStatusCode.NotFound),
                 })
        {
            stub.HandoverFailure = (failure, code);
            using var refused = await SendAsync(client, HttpMethod.Post, route, body, key);
            await AssertProblemAsync(refused, status, code);
        }

        stub.HandoverFailure = (PositionCoverageFailure.Forbidden, null);
        using var forbidden = await SendAsync(client, HttpMethod.Post, route, body, key);
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);
        using var problem = await JsonAsync(forbidden);
        Assert.False(problem.RootElement.TryGetProperty("code", out _));
    }

    [Fact]
    public async Task HandoverOptionsAnswerTheirShapeOrWhyTheOperationIsNotHandedOver()
    {
        var stub = new Stub();
        await using var application = Application(stub);
        using var client = Authenticated(application);
        var route = $"/api/v1/occ/planning/turnarounds/{TurnaroundId:D}/assignment/handover-options";

        using (var options = await client.GetAsync(route, TestContext.Current.CancellationToken))
        {
            Assert.Equal(HttpStatusCode.OK, options.StatusCode);
            using var json = await JsonAsync(options);
            Assert.Equal(["turnaroundId", "operationId", "operationStatus", "currentAssignmentId", "currentAgentId",
                    "currentAgentName", "remainingFrom", "remainingUntil", "agents"],
                json.RootElement.EnumerateObject().Select(property => property.Name).ToArray());
            var agent = Assert.Single(json.RootElement.GetProperty("agents").EnumerateArray());
            Assert.Equal(["id", "displayName", "employeeNumber", "eligible", "eligibilityReasons"],
                agent.EnumerateObject().Select(property => property.Name).ToArray());
        }

        stub.OptionsFailure = (PositionCoverageFailure.Conflict, "handover_not_allowed");
        using var closed = await client.GetAsync(route, TestContext.Current.CancellationToken);
        await AssertProblemAsync(closed, HttpStatusCode.Conflict, "handover_not_allowed");
    }

    [Fact]
    public async Task AgentReleaseForwardsTheAssignmentOccSawAndKeepsOlderClientsWorking()
    {
        var stub = new Stub();
        await using var application = Application(stub);
        using var client = Authenticated(application);
        var key = Guid.NewGuid();
        var route = $"/api/v1/occ/planning/turnarounds/{TurnaroundId:D}/assignment/release";

        using (var released = await SendAsync(client, HttpMethod.Post, $"{route}?expectedAssignmentId={AssignmentId:D}",
                   null, key))
            Assert.Equal(HttpStatusCode.NoContent, released.StatusCode);
        Assert.Equal(new ReleaseOperationAgentInput(AssignmentId, key), stub.Release);

        // An older client sends neither the assignment nor the key (expand): the release keeps its meaning.
        using (var older = await SendAsync(client, HttpMethod.Post, route, null, null))
            Assert.Equal(HttpStatusCode.NoContent, older.StatusCode);
        Assert.Equal(new ReleaseOperationAgentInput(), stub.Release);

        foreach (var (failure, code, status) in new[]
                 {
                     (PositionCoverageFailure.Conflict, "assignment_changed", HttpStatusCode.Conflict),
                     (PositionCoverageFailure.Conflict, "operation_started", HttpStatusCode.Conflict),
                     (PositionCoverageFailure.Invalid, "expected_version_required", HttpStatusCode.BadRequest),
                     (PositionCoverageFailure.NotFound, "not_found", HttpStatusCode.NotFound),
                 })
        {
            stub.ReleaseResult = OperationAgentCommandResult.Fail(failure, code);
            using var refused = await SendAsync(client, HttpMethod.Post, route, null, key);
            await AssertProblemAsync(refused, status, code);
        }
    }

    [Fact]
    public async Task CoverageCommandsForwardTheirKeyAndNameTheirFailures()
    {
        var stub = new Stub();
        await using var application = Application(stub);
        using var client = Authenticated(application);
        var key = Guid.NewGuid();
        var coverage = $$"""
            {"stationId":"{{StationId:D}}","date":"2026-11-09","agentId":"{{Riley:D}}","terminalId":"{{Guid.NewGuid():D}}",
             "standIds":["{{Guid.NewGuid():D}}"],"startsAt":null,"endsAt":null,"mentorAgentId":null,"vehicleCode":null,
             "isReinforcement":false}
            """;

        using (var created = await SendAsync(client, HttpMethod.Post, "/api/v1/occ/coverage", coverage, key))
            Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        Assert.Equal(key, stub.CoverageKey);
        var coverageId = Guid.NewGuid();
        using (var released = await SendAsync(client, HttpMethod.Post,
                   $"/api/v1/occ/coverage/{coverageId:D}/release?date=2026-11-09", null, key))
            Assert.Equal(HttpStatusCode.OK, released.StatusCode);
        Assert.Equal(key, stub.CoverageKey);

        stub.CoverageFailure = CoverageResult.Fail(PositionCoverageFailure.Conflict, null, "idempotency_conflict");
        using (var reused = await SendAsync(client, HttpMethod.Post, "/api/v1/occ/coverage", coverage, key))
            await AssertProblemAsync(reused, HttpStatusCode.Conflict, "idempotency_conflict");
        // A concurrent write without its own code tells the screen to read the board again.
        stub.CoverageFailure = CoverageResult.Fail(PositionCoverageFailure.Conflict);
        using (var concurrent = await SendAsync(client, HttpMethod.Post, "/api/v1/occ/coverage", coverage, key))
            await AssertProblemAsync(concurrent, HttpStatusCode.Conflict, "version_conflict");
        // The broken rules travel in `reasons`, with a code even when the rule has none of its own.
        stub.CoverageFailure = CoverageResult.Fail(PositionCoverageFailure.Rejected, ["terminal_scope_missing"]);
        using (var rejected = await SendAsync(client, HttpMethod.Post, "/api/v1/occ/coverage", coverage, key))
        {
            using var problem = await AssertProblemAsync(rejected, (HttpStatusCode)422, "coverage_rejected");
            Assert.Equal(["terminal_scope_missing"], problem.RootElement.GetProperty("reasons").EnumerateArray()
                .Select(item => item.GetString()!).ToArray());
        }

        stub.CoverageFailure = null;
        stub.CoverageKey = null;
        using (var stationless = await SendAsync(client, HttpMethod.Post, "/api/v1/occ/coverage",
                   coverage.Replace(StationId.ToString("D"), Guid.Empty.ToString("D"), StringComparison.Ordinal), key))
            await AssertProblemAsync(stationless, HttpStatusCode.BadRequest, "invalid_coverage_request");
        Assert.Null(stub.CoverageKey);
    }

    private WebApplicationFactory<Program> Application(Stub stub) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IPositionCoverageStore>();
            services.AddSingleton<IPositionCoverageStore>(stub);
        }));

    private static HttpClient Authenticated(WebApplicationFactory<Program> application)
    {
        var client = application.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());
        return client;
    }

    private static async Task<HttpResponseMessage> SendAsync(HttpClient client, HttpMethod method, string route, string? body,
        Guid? key)
    {
        using var request = new HttpRequestMessage(method, route);
        if (body is not null) request.Content = new StringContent(body, Encoding.UTF8, "application/json");
        if (key is { } value) request.Headers.Add("Idempotency-Key", value.ToString("D"));
        return await client.SendAsync(request, TestContext.Current.CancellationToken);
    }

    private static async Task<JsonDocument> JsonAsync(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));

    private static async Task<JsonDocument> AssertProblemAsync(HttpResponseMessage response, HttpStatusCode status,
        string code)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var problem = await JsonAsync(response);
        Assert.Equal(code, problem.RootElement.GetProperty("code").GetString());
        return problem;
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
                new SymmetricSecurityKey(Convert.FromBase64String(ElevantApiFactory.AuthenticationSigningKeyBase64)),
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

    private sealed class Stub : IPositionCoverageStore
    {
        public (Guid TurnaroundId, HandOverOperationInput Input, Guid? Key)? Handover { get; set; }
        public (PositionCoverageFailure Failure, string? Code)? HandoverFailure { get; set; }
        public (PositionCoverageFailure Failure, string Code)? OptionsFailure { get; set; }
        public ReleaseOperationAgentInput? Release { get; private set; }
        public OperationAgentCommandResult ReleaseResult { get; set; } = OperationAgentCommandResult.Done;
        public Guid? CoverageKey { get; set; }
        public CoverageResult? CoverageFailure { get; set; }

        private static CoverageBoardData Board(DateOnly date) =>
            new(StationId, "PUJ", date, [], [], [], [], [], CanAssign: true, CanConfigure: false);

        public Task<CoverageResult> ReadAsync(Guid actorId, Guid stationId, DateOnly date,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(new CoverageResult(Board(date), null, []));

        public Task<CoverageResult> CreateAsync(Guid actorId, Guid stationId, CreateCoverageInput input,
            Guid? idempotencyKey, CancellationToken cancellationToken = default)
        {
            CoverageKey = idempotencyKey;
            return Task.FromResult(CoverageFailure ?? new CoverageResult(Board(input.Date), null, []));
        }

        public Task<CoverageResult> ReleaseAsync(Guid actorId, Guid coverageId, DateOnly date, Guid? idempotencyKey,
            CancellationToken cancellationToken = default)
        {
            CoverageKey = idempotencyKey;
            return Task.FromResult(CoverageFailure ?? new CoverageResult(Board(date), null, []));
        }

        public Task<CoverageResult> UpdateStandAsync(Guid actorId, Guid standId, StandAttributesInput input, DateOnly date,
            CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<CoverageResult> UpdateTerminalAsync(Guid actorId, Guid terminalId, TerminalRulesInput input,
            DateOnly date, CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<CoverageResult> AddConstraintAsync(Guid actorId, StandConstraintInput input, DateOnly date,
            CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<CoverageResult> RemoveConstraintAsync(Guid actorId, Guid constraintId, DateOnly date,
            CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<OperationAgentCommandResult> ReleaseOperationAgentAsync(Guid actorId, Guid turnaroundId,
            ReleaseOperationAgentInput input, CancellationToken cancellationToken = default)
        {
            Release = input;
            return Task.FromResult(ReleaseResult);
        }

        public Task<OccHandoverResult<OccHandoverOptionsData>> ReadHandoverOptionsAsync(Guid actorId, Guid turnaroundId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(OptionsFailure is { } failure
                ? OccHandoverResult<OccHandoverOptionsData>.Fail(failure.Failure, failure.Code)
                : OccHandoverResult<OccHandoverOptionsData>.Success(new OccHandoverOptionsData(turnaroundId, Guid.NewGuid(),
                    "InProgress", AssignmentId, Riley, "Riley Ramp", DateTimeOffset.UtcNow,
                    DateTimeOffset.UtcNow.AddMinutes(40),
                    [new OccAgentOptionData(Ximena, "Ximena Ramp", "QA-RA-302", true, [])])));

        public Task<OccHandoverResult<OccOperationHandoverData>> HandOverOperationAsync(Guid actorId, Guid turnaroundId,
            HandOverOperationInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default)
        {
            Handover = (turnaroundId, input, idempotencyKey);
            return Task.FromResult(HandoverFailure is { } failure
                ? new OccHandoverResult<OccOperationHandoverData>(null, failure.Failure, failure.Code)
                : OccHandoverResult<OccOperationHandoverData>.Success(new OccOperationHandoverData(turnaroundId,
                    NewAssignmentId, input.AgentId, Riley, false)));
        }

        public Task<IReadOnlyList<OwnCoverageData>?> ReadOwnAsync(Guid accountId,
            CancellationToken cancellationToken = default) => throw new NotSupportedException();
    }
}
