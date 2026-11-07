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
                DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, null, "AAAAAAAAB9E=")]) };
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
        // The version is the expected version of a decision or an amendment (2-N22).
        Assert.Equal("AAAAAAAAB9E=", json.RootElement.GetProperty("requests")[0]
            .GetProperty("version").GetString());
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

        Assert.Null(stub.ResolveKey);

        // Phase 2 (2-N08): the key travels to the store and a refused approval carries its rule.
        var key = Guid.NewGuid();
        using var keyed = new HttpRequestMessage(HttpMethod.Post,
            $"/api/v1/human-resources/availability-requests/{id:D}/resolution")
        {
            Content = JsonContent.Create(resolution with { ExpectedVersion = "AAAAAAAAB9E=" }),
        };
        keyed.Headers.Add("Idempotency-Key", key.ToString("D"));
        stub.Failure = HumanResourcesAvailabilityWriteFailure.Conflict;
        stub.Code = "agent_has_operation_in_progress";
        using var conflict = await client.SendAsync(keyed, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Conflict, conflict.StatusCode);
        Assert.Equal(key, stub.ResolveKey);
        Assert.Equal("AAAAAAAAB9E=", stub.ResolveRequest!.Value.Input.ExpectedVersion);
        using (var problem = JsonDocument.Parse(await conflict.Content.ReadAsStringAsync(
                   TestContext.Current.CancellationToken)))
            Assert.Equal("agent_has_operation_in_progress", problem.RootElement.GetProperty("code").GetString());
        stub.Code = null;
        stub.Failure = HumanResourcesAvailabilityWriteFailure.NotFound;
        using var missing = await client.PostAsJsonAsync(
            $"/api/v1/human-resources/availability-requests/{id:D}/resolution",
            resolution, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        stub.Failure = HumanResourcesAvailabilityWriteFailure.Forbidden;
        using var denied = await client.PutAsJsonAsync(
            $"/api/v1/human-resources/availability-requests/{id:D}", input,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
    }

    [Fact]
    public async Task AmendmentNeedsAKeyPassesTheIntentAndMapsItsRule()
    {
        var id = Guid.NewGuid();
        var stub = new WriteStub();
        await using var application = factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IHumanResourcesAvailabilityWriteStore>();
                services.AddSingleton<IHumanResourcesAvailabilityWriteStore>(stub);
            }));
        using var client = application.CreateClient();
        using var anonymous = await client.PostAsJsonAsync(
            $"/api/v1/human-resources/availability-requests/{id:D}/amendment", new { action = "Cancel" },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());
        var input = new AmendHumanResourcesAvailabilityInput("Shorten", new DateOnly(2026, 10, 4),
            "Alta médica antes de lo previsto", "AAAAAAAAB9E=");

        // A new command: without its key it never reaches the store.
        using var keyless = await client.PostAsJsonAsync(
            $"/api/v1/human-resources/availability-requests/{id:D}/amendment", input,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, keyless.StatusCode);
        Assert.Null(stub.AmendRequest);

        var key = Guid.NewGuid();
        async Task<HttpResponseMessage> AmendAsync()
        {
            using var request = new HttpRequestMessage(HttpMethod.Post,
                $"/api/v1/human-resources/availability-requests/{id:D}/amendment") { Content = JsonContent.Create(input) };
            request.Headers.Add("Idempotency-Key", key.ToString("D"));
            return await client.SendAsync(request, TestContext.Current.CancellationToken);
        }
        using (var amended = await AmendAsync())
        {
            Assert.Equal(HttpStatusCode.OK, amended.StatusCode);
            Assert.Equal((AccountId, id, input, key), stub.AmendRequest);
            using var json = JsonDocument.Parse(await amended.Content.ReadAsStringAsync(
                TestContext.Current.CancellationToken));
            Assert.Equal("2026-10-04", json.RootElement.GetProperty("endsOn").GetString());
            Assert.Equal("Approved", json.RootElement.GetProperty("status").GetString());
            Assert.Equal("AAAAAAAAB9I=", json.RootElement.GetProperty("version").GetString());
        }
        foreach (var (failure, code, status) in new[]
                 {
                     (HumanResourcesAvailabilityWriteFailure.Conflict, "absence_started", HttpStatusCode.Conflict),
                     (HumanResourcesAvailabilityWriteFailure.Invalid, "absence_end_invalid", HttpStatusCode.BadRequest),
                     (HumanResourcesAvailabilityWriteFailure.NotFound, "not_found", HttpStatusCode.NotFound),
                 })
        {
            stub.Failure = failure;
            stub.Code = code;
            using var refused = await AmendAsync();
            Assert.Equal(status, refused.StatusCode);
            using var problem = JsonDocument.Parse(await refused.Content.ReadAsStringAsync(
                TestContext.Current.CancellationToken));
            Assert.Equal(code, problem.RootElement.GetProperty("code").GetString());
        }
        stub.Failure = HumanResourcesAvailabilityWriteFailure.Forbidden;
        using (var denied = await AmendAsync())
            Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);

        using var swagger = await client.GetAsync("/swagger/v1/swagger.json", TestContext.Current.CancellationToken);
        using var document = JsonDocument.Parse(await swagger.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        var operation = document.RootElement.GetProperty("paths")
            .GetProperty("/api/v1/human-resources/availability-requests/{id}/amendment").GetProperty("post");
        foreach (var response in new[] { "200", "400", "403", "404", "409" })
            Assert.True(operation.GetProperty("responses").TryGetProperty(response, out _), response);
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
        public string? Code { get; set; }
        public (Guid ActorId, Guid Id, RecordHumanResourcesAvailabilityInput Input)? RecordRequest
        { get; private set; }
        public (Guid ActorId, Guid Id, ResolveHumanResourcesAvailabilityInput Input)? ResolveRequest
        { get; private set; }
        public Guid? ResolveKey { get; private set; }
        public (Guid ActorId, Guid Id, AmendHumanResourcesAvailabilityInput Input, Guid Key)? AmendRequest
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
            Guid requestId, ResolveHumanResourcesAvailabilityInput input, Guid? idempotencyKey,
            CancellationToken cancellationToken = default)
        {
            ResolveRequest = (actorId, requestId, input);
            ResolveKey = idempotencyKey;
            return Task.FromResult(Failure is null
                ? HumanResourcesAvailabilityWriteResult.Success(requestId, "Approved")
                : HumanResourcesAvailabilityWriteResult.Failed(Failure.Value, Code));
        }

        public Task<HumanResourcesAvailabilityAmendmentResult> AmendAsync(Guid actorId, Guid requestId,
            AmendHumanResourcesAvailabilityInput input, Guid idempotencyKey,
            CancellationToken cancellationToken = default)
        {
            AmendRequest = (actorId, requestId, input, idempotencyKey);
            return Task.FromResult(Failure is null
                ? HumanResourcesAvailabilityAmendmentResult.Success(new HumanResourcesAvailabilityAmended(requestId,
                    "Approved", input.EndsOn ?? new DateOnly(2026, 10, 2), "AAAAAAAAB9I="))
                : HumanResourcesAvailabilityAmendmentResult.Failed(Failure.Value, Code ?? "forbidden"));
        }
    }
}
