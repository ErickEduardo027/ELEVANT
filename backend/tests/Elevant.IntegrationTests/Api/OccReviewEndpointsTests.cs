using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;
using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

public sealed class OccReviewEndpointsTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000001");
    private static readonly Guid StationId = Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly Guid OperationId = Guid.Parse("70000000-0000-7000-8000-000000000005");
    private static readonly Guid SubmissionId = Guid.Parse("85000000-0000-7000-8000-000000000022");
    private static readonly DateTimeOffset SubmittedAt =
        new(2026, 9, 23, 12, 0, 0, TimeSpan.Zero);
    private static readonly string Token = "\"" + new string('a', 64) + "\"";

    [Fact]
    public async Task QueueRequiresBearerAndScopesStationBeforeStore()
    {
        var state = new ReviewState { Actor = Actor() };
        await using var application = CreateApplication(state);
        using var anonymous = application.CreateClient();
        using var rejected = await anonymous.GetAsync(
            $"/api/v1/occ/review/queue?stationId={StationId:D}",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, rejected.StatusCode);
        Assert.Contains("no-store", rejected.Headers.CacheControl?.ToString(), StringComparison.Ordinal);

        using var client = Authorized(application);
        using var outOfScope = await client.GetAsync(
            "/api/v1/occ/review/queue?stationId=20000000-0000-7000-8000-000000000099",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NotFound, outOfScope.StatusCode);
        Assert.Equal(0, state.QueueReads);
    }

    [Fact]
    public async Task QueueAndDetailExposeOnlyCanonicalScopedEvidence()
    {
        var state = new ReviewState
        {
            Actor = Actor(),
            Queue = new OccReviewQueueData(StationId, "PUJ", "Punta Cana",
                "America/Santo_Domingo",
                [new OccReviewQueueItemData(OperationId, SubmissionId, 1,
                    "PendingReview", "DEV-TAT-0002", new DateOnly(2026, 9, 23),
                    "Demo Air", "Riley Ramp", SubmittedAt, 2, 1)], false),
            Detail = Detail(),
            History = new OccReviewSubmissionHistoryData(OperationId,
                [new OccReviewSubmissionHistoryItemData(SubmissionId, 1,
                    "PendingReview", SubmittedAt, null, null)], false),
        };
        await using var application = CreateApplication(state);
        using var client = Authorized(application);

        using var queue = await client.GetAsync(
            $"/api/v1/occ/review/queue?stationId={StationId:D}",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, queue.StatusCode);
        var queueJson = await queue.Content.ReadFromJsonAsync<JsonElement>(TestContext.Current.CancellationToken);
        Assert.Equal(OperationId,
            queueJson.GetProperty("operations")[0].GetProperty("operationId").GetGuid());
        Assert.Equal(1, state.QueueReads);

        using var detail = await client.GetAsync(
            $"/api/v1/occ/review/operations/{OperationId:D}",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, detail.StatusCode);
        Assert.Equal(Token, detail.Headers.ETag?.ToString());
        var body = await detail.Content.ReadFromJsonAsync<JsonElement>(TestContext.Current.CancellationToken);
        Assert.Equal("Submitted", body.GetProperty("checklistStatus").GetString());
        Assert.Single(body.GetProperty("services").EnumerateArray());
        Assert.Single(body.GetProperty("incidents").EnumerateArray());
        Assert.Equal(Token, body.GetProperty("reviewVersion").GetString());
        Assert.Equal([StationId], state.DetailStations);

        using var history = await client.GetAsync(
            $"/api/v1/occ/review/operations/{OperationId:D}/submissions",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, history.StatusCode);
        var historyJson = await history.Content.ReadFromJsonAsync<JsonElement>(
            TestContext.Current.CancellationToken);
        Assert.Equal(SubmissionId,
            historyJson.GetProperty("submissions")[0].GetProperty("submissionId").GetGuid());
        Assert.Equal([StationId], state.DetailStations);

        using var historical = await client.GetAsync(
            $"/api/v1/occ/review/operations/{OperationId:D}/submissions/{SubmissionId:D}",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, historical.StatusCode);
        var historicalJson = await historical.Content.ReadFromJsonAsync<JsonElement>(
            TestContext.Current.CancellationToken);
        Assert.Equal(SubmissionId, historicalJson.GetProperty("submissionId").GetGuid());
        Assert.Equal([StationId], state.DetailStations);
    }

    [Fact]
    public async Task DecisionRequiresStrongTokenAndDelegatesExactOutcome()
    {
        var state = new ReviewState
        {
            Actor = Actor(),
            DecisionResult = OccReviewDecisionWriteResult.Success(
                new OccReviewDecisionWriteData(OperationId, SubmissionId, "Returned",
                    "Returned", SubmittedAt.AddMinutes(5), "Corregir el servicio"), Guid.NewGuid()),
        };
        await using var application = CreateApplication(state);
        using var client = Authorized(application);
        using var absent = await DecisionRequest(client, null);
        Assert.Equal((HttpStatusCode)428, absent.StatusCode);
        using var malformed = await DecisionRequest(client, "not-an-etag");
        Assert.Equal(HttpStatusCode.BadRequest, malformed.StatusCode);
        Assert.Null(state.DecisionRequest);

        using var accepted = await DecisionRequest(client, Token);
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);
        Assert.NotNull(state.DecisionRequest);
        Assert.Equal(OperationId, state.DecisionRequest.OperationId);
        Assert.Equal(SubmissionId, state.DecisionRequest.SubmissionId);
        Assert.Equal(Token, state.DecisionRequest.ConcurrencyToken);
        Assert.Equal("Returned", state.DecisionRequest.Outcome);
        Assert.Equal("Corregir el servicio", state.DecisionRequest.Reason);
    }

    /// <summary>
    /// Phase 3, block D: every refusal of the decision carries a code (the precondition, the store's rule), and the
    /// optional Idempotency-Key reaches the store (expand: older callers keep deciding without one).
    /// </summary>
    [Fact]
    public async Task DecisionFailuresCarryCodesAndTheOptionalKeyReachesTheStore()
    {
        var state = new ReviewState
        {
            Actor = Actor(),
            DecisionResult = OccReviewDecisionWriteResult.Failed(OccReviewFailure.Conflict, "service_order_unsigned"),
        };
        await using var application = CreateApplication(state);
        using var client = Authorized(application);
        var ct = TestContext.Current.CancellationToken;
        using var absent = await DecisionRequest(client, null);
        Assert.Equal(((HttpStatusCode)428, "expected_version_required"), (absent.StatusCode, await CodeOf(absent, ct)));
        using var malformed = await DecisionRequest(client, "not-an-etag");
        Assert.Equal((HttpStatusCode.BadRequest, "invalid_review_request"), (malformed.StatusCode, await CodeOf(malformed, ct)));
        var key = Guid.NewGuid();
        using var unsigned = await DecisionRequest(client, Token, key);
        Assert.Equal((HttpStatusCode.Conflict, "service_order_unsigned"), (unsigned.StatusCode, await CodeOf(unsigned, ct)));
        Assert.Equal(key, state.DecisionRequest!.IdempotencyKey);
        using var legacy = await DecisionRequest(client, Token);
        Assert.Null(state.DecisionRequest!.IdempotencyKey);
        state.DecisionResult = OccReviewDecisionWriteResult.Failed(OccReviewFailure.PreconditionFailed, "version_conflict");
        using var stale = await DecisionRequest(client, Token, Guid.NewGuid());
        Assert.Equal((HttpStatusCode.PreconditionFailed, "version_conflict"), (stale.StatusCode, await CodeOf(stale, ct)));
    }

    /// <summary>
    /// 3-H: the reopening takes its Idempotency-Key, the review version and a reason, answers the new revision with its
    /// ETag, carries the store's codes and needs <c>operations.review.reopen</c>.
    /// </summary>
    [Fact]
    public async Task ReopeningNeedsKeyVersionReasonAndItsPermission()
    {
        var reopenedId = Guid.NewGuid();
        var state = new ReviewState
        {
            Actor = Actor(),
            ReopenResult = new OccReviewReopenResult(
                new OccReviewReopenData(OperationId, reopenedId, 2, "PendingReview", Token), null),
        };
        await using var application = CreateApplication(state);
        using var client = Authorized(application);
        var ct = TestContext.Current.CancellationToken;
        const string Body = """{"submissionId":"85000000-0000-7000-8000-000000000022","reason":"La aerolínea pidió revisar"}""";
        using var unversioned = await Send(client, $"/api/v1/occ/review/operations/{OperationId:D}/reopening", Body, null,
            Guid.NewGuid());
        Assert.Equal(((HttpStatusCode)428, "expected_version_required"),
            (unversioned.StatusCode, await CodeOf(unversioned, ct)));
        using var keyless = await Send(client, $"/api/v1/occ/review/operations/{OperationId:D}/reopening", Body, Token, null);
        Assert.Equal((HttpStatusCode.BadRequest, "idempotency_key_required"), (keyless.StatusCode, await CodeOf(keyless, ct)));
        using var brief = await Send(client, $"/api/v1/occ/review/operations/{OperationId:D}/reopening",
            """{"submissionId":"85000000-0000-7000-8000-000000000022","reason":"corta"}""", Token, Guid.NewGuid());
        Assert.Equal((HttpStatusCode.BadRequest, "reason_required"), (brief.StatusCode, await CodeOf(brief, ct)));
        Assert.Null(state.ReopenRequest);

        var key = Guid.NewGuid();
        using var reopened = await Send(client, $"/api/v1/occ/review/operations/{OperationId:D}/reopening", Body, Token, key);
        Assert.Equal(HttpStatusCode.OK, reopened.StatusCode);
        Assert.Equal(Token, reopened.Headers.ETag?.ToString());
        var json = await reopened.Content.ReadFromJsonAsync<JsonElement>(ct);
        Assert.Equal((reopenedId, 2, "PendingReview"), (json.GetProperty("submissionId").GetGuid(),
            json.GetProperty("revisionNumber").GetInt32(), json.GetProperty("status").GetString()));
        Assert.Equal((key, SubmissionId, "La aerolínea pidió revisar", Token), (state.ReopenRequest!.IdempotencyKey,
            state.ReopenRequest.SubmissionId, state.ReopenRequest.Reason, state.ReopenRequest.ConcurrencyToken));

        state.ReopenResult = OccReviewReopenResult.Failed(OccReviewFailure.Conflict, "already_invoiced");
        using var invoiced = await Send(client, $"/api/v1/occ/review/operations/{OperationId:D}/reopening", Body, Token,
            Guid.NewGuid());
        Assert.Equal((HttpStatusCode.Conflict, "already_invoiced"), (invoiced.StatusCode, await CodeOf(invoiced, ct)));

        state.Actor = Actor(["operations.review.read", "operations.review.decide"]);
        using var forbidden = await Send(client, $"/api/v1/occ/review/operations/{OperationId:D}/reopening", Body, Token,
            Guid.NewGuid());
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);
    }

    /// <summary>3-N11: the billing exclusion takes its key, the review version and a reason, like any adjustment.</summary>
    [Fact]
    public async Task BillingExclusionTakesKeyVersionAndReason()
    {
        var state = new ReviewState { Actor = Actor() };
        await using var application = CreateApplication(state);
        using var client = Authorized(application);
        var ct = TestContext.Current.CancellationToken;
        var serviceId = Guid.NewGuid();
        var path = $"/api/v1/occ/review/operations/{OperationId:D}/services/{serviceId:D}/billing-exclusion";
        const string Body = """{"submissionId":"85000000-0000-7000-8000-000000000022","excluded":true,"reason":"Falla del equipo GPU"}""";
        using var keyless = await Send(client, path, Body, Token, null);
        Assert.Equal((HttpStatusCode.BadRequest, "idempotency_key_required"), (keyless.StatusCode, await CodeOf(keyless, ct)));
        using var excluded = await Send(client, path, Body, Token, Guid.NewGuid());
        Assert.Equal(HttpStatusCode.OK, excluded.StatusCode);
        Assert.Equal("\"next\"", excluded.Headers.ETag?.ToString());
        Assert.Equal((serviceId, true, "Falla del equipo GPU"), (state.ExclusionRequest!.ServiceId,
            state.ExclusionRequest.Excluded, state.ExclusionRequest.Reason));
    }

    [Fact]
    public async Task OpenApiPublishesReviewContract()
    {
        using var client = factory.CreateClient();
        using var response = await client.GetAsync(
            "/swagger/v1/swagger.json", TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        var document = await response.Content.ReadFromJsonAsync<JsonElement>(TestContext.Current.CancellationToken);
        var paths = document.GetProperty("paths");
        Assert.True(paths.GetProperty("/api/v1/occ/review/queue").TryGetProperty("get", out _));
        Assert.True(paths.GetProperty("/api/v1/occ/review/operations/{operationId}")
            .TryGetProperty("get", out _));
        Assert.True(paths.GetProperty(
            "/api/v1/occ/review/operations/{operationId}/submissions")
            .TryGetProperty("get", out _));
        Assert.True(paths.GetProperty(
            "/api/v1/occ/review/operations/{operationId}/submissions/{submissionId}")
            .TryGetProperty("get", out _));
        Assert.True(paths.GetProperty("/api/v1/ramp/operations/{operationId}/correction")
            .TryGetProperty("post", out _));
        var decision = paths.GetProperty("/api/v1/occ/review/operations/{operationId}/decision")
            .GetProperty("post");
        Assert.True(decision.GetProperty("responses").TryGetProperty("412", out _));
        Assert.True(decision.GetProperty("responses").TryGetProperty("428", out _));
        foreach (var command in new[]
                 {
                     "/api/v1/occ/review/operations/{operationId}/reopening",
                     "/api/v1/occ/review/operations/{operationId}/services/{serviceId}/billing-exclusion",
                 })
        {
            var responses = paths.GetProperty(command).GetProperty("post").GetProperty("responses");
            Assert.True(responses.TryGetProperty("412", out _));
            Assert.True(responses.TryGetProperty("428", out _));
        }
    }

    private static async Task<string?> CodeOf(HttpResponseMessage response, CancellationToken cancellationToken) =>
        (await response.Content.ReadFromJsonAsync<JsonElement>(cancellationToken)).TryGetProperty("code", out var code)
            ? code.GetString() : null;

    private static async Task<HttpResponseMessage> Send(HttpClient client, string path, string json, string? token,
        Guid? idempotencyKey)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json"),
        };
        if (token is not null) request.Headers.TryAddWithoutValidation("If-Match", token);
        if (idempotencyKey is { } key) request.Headers.TryAddWithoutValidation("Idempotency-Key", key.ToString("D"));
        return await client.SendAsync(request, TestContext.Current.CancellationToken);
    }

    private WebApplicationFactory<Program> CreateApplication(ReviewState state) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<IActorContextResolver>();
            services.RemoveAll<IOccReviewStore>();
            services.AddSingleton(state);
            services.AddScoped<IActorContextResolver>(_ => state);
            services.AddScoped<IOccReviewStore>(_ => state);
        }));

    private static async Task<HttpResponseMessage> DecisionRequest(HttpClient client, string? token,
        Guid? idempotencyKey = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post,
            $"/api/v1/occ/review/operations/{OperationId:D}/decision")
        {
            Content = JsonContent.Create(new
            {
                submissionId = SubmissionId,
                outcome = "Returned",
                reason = "Corregir el servicio",
            }),
        };
        if (token is not null) request.Headers.TryAddWithoutValidation("If-Match", token);
        if (idempotencyKey is { } key) request.Headers.TryAddWithoutValidation("Idempotency-Key", key.ToString("D"));
        return await client.SendAsync(request, TestContext.Current.CancellationToken);
    }

    private static HttpClient Authorized(WebApplicationFactory<Program> application)
    {
        var client = application.CreateClient();
        var now = DateTimeOffset.UtcNow;
        var key = new SymmetricSecurityKey(
            Convert.FromBase64String(ElevantApiFactory.AuthenticationSigningKeyBase64));
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
                new System.Security.Claims.Claim(Elevant.Infrastructure.Authentication.SessionSecurityVersion.ClaimType, Elevant.Infrastructure.Authentication.SessionSecurityVersion.Fingerprint(ElevantApiFactory.TestSecurityStamp)),
            ]),
            TokenType = "at+jwt",
        });
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static ActorContext Actor(string[]? permissions = null) => new(
        AccountId, "admin.occ@dev.elevant.test", "Alex Operations",
        [new ActorRole(Guid.NewGuid(), "ADMIN_OCC", "Admin OCC", PortalKind.BackOffice, "admin_occ")],
        [new ActorMembership(Guid.NewGuid(), Guid.NewGuid(), "AVIAM", "AVIAM Development",
            OrganizationType.AviamOperator, MembershipKind.InternalStaff)],
        [new ActorStationScope(StationId, "PUJ")],
        permissions is null ? null
            : new DepartmentAccess(DepartmentAssignmentKind.Member, Department.Operations, permissions.ToHashSet()));

    private static OccReviewDetailData Detail() => new(
        OperationId, SubmissionId, 1, "PendingReview", "DEV-TAT-0002",
        new DateOnly(2026, 9, 23), StationId, "PUJ", "America/Santo_Domingo",
        "Demo Air", "Riley Ramp", SubmittedAt.AddHours(-2), null,
        SubmittedAt.AddHours(-1), SubmittedAt, SubmittedAt, "Sin novedades",
        "Submitted",
        [new OccReviewChecklistAnswerData("Chequeo", "SAFE-01", "Área segura", "Ok", null)],
        [new OccReviewServiceData(Guid.NewGuid(), "PASSENGER-BRIDGE", "Puente", "Completed", 1, 1, "uso")],
        [new OccReviewIncidentData(Guid.NewGuid(), "Operational", "Low", "Open", "Evento de prueba", SubmittedAt)],
        null, Token);

    private sealed class ReviewState : IActorContextResolver, IOccReviewStore
    {
        public ActorContext? Actor { get; set; }
        public OccReviewQueueData? Queue { get; init; }
        public OccReviewDetailData? Detail { get; init; }
        public OccReviewSubmissionHistoryData? History { get; init; }
        public OccReviewDecisionWriteResult DecisionResult { get; set; } =
            OccReviewDecisionWriteResult.Failed(OccReviewFailure.Conflict);
        public OccReviewReopenResult ReopenResult { get; set; } = OccReviewReopenResult.Failed(OccReviewFailure.Conflict);
        public OccReviewReopenRequest? ReopenRequest { get; private set; }
        public OccReviewBillingExclusionRequest? ExclusionRequest { get; private set; }
        public int QueueReads { get; private set; }
        public IReadOnlyCollection<Guid>? DetailStations { get; private set; }
        public OccReviewDecisionWriteRequest? DecisionRequest { get; private set; }

        public Task<ActorContext?> ResolveAsync(Guid accountId,
            CancellationToken cancellationToken = default) => Task.FromResult(Actor);

        public Task<OccReviewQueueData?> GetQueueAsync(Guid stationId,
            CancellationToken cancellationToken = default)
        {
            QueueReads++;
            return Task.FromResult(Queue);
        }

        public Task<OccReviewDetailData?> GetDetailAsync(Guid operationId,
            IReadOnlyCollection<Guid> allowedStationIds,
            CancellationToken cancellationToken = default)
        {
            DetailStations = allowedStationIds;
            return Task.FromResult(Detail);
        }

        public Task<OccReviewDetailData?> GetSubmissionDetailAsync(Guid operationId,
            Guid submissionId, IReadOnlyCollection<Guid> allowedStationIds,
            CancellationToken cancellationToken = default)
        {
            DetailStations = allowedStationIds;
            return Task.FromResult(Detail?.SubmissionId == submissionId ? Detail : null);
        }

        public Task<OccReviewSubmissionHistoryData?> GetSubmissionHistoryAsync(
            Guid operationId, IReadOnlyCollection<Guid> allowedStationIds,
            CancellationToken cancellationToken = default)
        {
            DetailStations = allowedStationIds;
            return Task.FromResult(History?.OperationId == operationId ? History : null);
        }

        public OccReviewChargeAdjustRequest? LastAdjust { get; private set; }

        public Task<OccReviewChargeAdjustResult> AdjustChargeAsync(OccReviewChargeAdjustRequest request,
            CancellationToken cancellationToken = default)
        {
            LastAdjust = request;
            return Task.FromResult(new OccReviewChargeAdjustResult("\"next\"", null));
        }

        public Task<OccReviewDecisionWriteResult> DecideAsync(
            OccReviewDecisionWriteRequest request, CancellationToken cancellationToken = default)
        {
            DecisionRequest = request;
            return Task.FromResult(DecisionResult);
        }

        public Task<OccReviewChargeAdjustResult> SetServiceBillingExclusionAsync(OccReviewBillingExclusionRequest request,
            CancellationToken cancellationToken = default)
        {
            ExclusionRequest = request;
            return Task.FromResult(new OccReviewChargeAdjustResult("\"next\"", null));
        }

        public Task<OccReviewReopenResult> ReopenAsync(OccReviewReopenRequest request,
            CancellationToken cancellationToken = default)
        {
            ReopenRequest = request;
            return Task.FromResult(ReopenResult);
        }
    }
}
