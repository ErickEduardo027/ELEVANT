using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Elevant.Application.Abstractions.Commercial;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

/// <summary>Contratos' review commands: headers, versions and coded Problem Details (phase 1, block A).</summary>
public sealed class CommercialRequestsEndpointsTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000005");
    private static readonly Guid RequestId = Guid.Parse("70000000-0000-7000-8000-0000000000a1");

    [Fact]
    public async Task TheInboxFiltersOnTheServerAndRejectsAnUnknownFilterWithACode()
    {
        var store = new StubStore();
        await using var application = Application(store);
        using var anonymous = application.CreateClient();
        using var denied = await anonymous.GetAsync("/api/v1/contracts/commercial-requests/inbox",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, denied.StatusCode);

        using var client = Authorized(application);
        using var open = await client.GetAsync("/api/v1/contracts/commercial-requests/inbox",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, open.StatusCode);
        Assert.Equal(new CommercialInboxQuery("Open", null, 1, 25), store.LastQuery);
        using var searched = await client.GetAsync(
            "/api/v1/contracts/commercial-requests/inbox?status=Cancelled&search=%20ana%40&page=2&limit=10",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, searched.StatusCode);
        Assert.Equal(new CommercialInboxQuery("Cancelled", "ana@", 2, 10), store.LastQuery);

        foreach (var invalid in new[] { "status=Archived", "limit=0", "limit=51", "page=0" })
        {
            using var response = await client.GetAsync($"/api/v1/contracts/commercial-requests/inbox?{invalid}",
                TestContext.Current.CancellationToken);
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Equal("invalid_inbox_query", await CodeAsync(response));
        }

        store.DenyRead = true;
        using var forbidden = await client.GetAsync("/api/v1/contracts/commercial-requests/inbox",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);
    }

    [Fact]
    public async Task NewCommandsNeedTheIdempotencyKeyAndPassItWithTheExpectedVersion()
    {
        var store = new StubStore();
        await using var application = Application(store);
        using var client = Authorized(application);
        var key = Guid.NewGuid();

        using var missing = await client.PostAsJsonAsync($"/api/v1/contracts/commercial-requests/{RequestId}/cancellation",
            new { expectedVersion = "AAAAAAAAB9E=", reason = "Solicitud duplicada." }, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        Assert.Null(store.LastCancel);

        using var cancelled = await SendAsync(client, "cancellation", key,
            new { expectedVersion = "AAAAAAAAB9E=", reason = "Solicitud duplicada." });
        Assert.Equal(HttpStatusCode.OK, cancelled.StatusCode);
        Assert.Equal((RequestId, key, new CancelCommercialRequestInput("AAAAAAAAB9E=", "Solicitud duplicada.")),
            store.LastCancel);

        using var confirmed = await SendAsync(client, "representative-confirmation", key,
            new { expectedVersion = "AAAAAAAAB9E=", note = "Llamada a la central." });
        Assert.Equal(HttpStatusCode.OK, confirmed.StatusCode);
        Assert.Equal("Llamada a la central.", store.LastConfirmation?.Note);

        using var verified = await SendAsync(client, "airline-verification", key,
            new { expectedVersion = "AAAAAAAAB9E=", legalName = "Caribe Cargo S.R.L.", countryCode = "DO",
                icaoCode = "CCX", verificationSourceUrl = "https://aoc.example.test/ccx" });
        Assert.Equal(HttpStatusCode.OK, verified.StatusCode);
        Assert.Equal(new VerifyRequestAirlineInput("AAAAAAAAB9E=", null, "Caribe Cargo S.R.L.", "DO", null, "CCX",
            "https://aoc.example.test/ccx"), store.LastVerification);

        // The decision stays usable without the key (expand) and forwards it when present.
        using var legacy = await client.PostAsJsonAsync($"/api/v1/contracts/commercial-requests/{RequestId}/decision",
            new { approve = false, reason = "No procede.", stationIds = Array.Empty<Guid>() },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, legacy.StatusCode);
        Assert.Null(store.LastDecision?.Key);
        using var keyed = await SendAsync(client, "decision", key,
            new { approve = false, reason = "No procede.", stationIds = Array.Empty<Guid>(), expectedVersion = "AAAAAAAAB9E=" });
        Assert.Equal(HttpStatusCode.OK, keyed.StatusCode);
        Assert.Equal((key, "AAAAAAAAB9E="), (store.LastDecision?.Key, store.LastDecision?.Input.ExpectedVersion));
    }

    [Fact]
    public async Task EveryFailureIsProblemDetailsWithItsStableCode()
    {
        var store = new StubStore();
        await using var application = Application(store);
        using var client = Authorized(application);
        foreach (var (result, status, code) in new[]
        {
            (CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Conflict, "airline_already_contracted"),
                HttpStatusCode.Conflict, "airline_already_contracted"),
            (CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Conflict), HttpStatusCode.Conflict, "version_conflict"),
            (CommercialWorkflowResult.Failed(CommercialWorkflowFailure.NotFound), HttpStatusCode.NotFound, "not_found"),
            (CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Invalid, "reason_required"),
                HttpStatusCode.BadRequest, "reason_required"),
            (CommercialWorkflowResult.Failed(CommercialWorkflowFailure.AirlineUnverified),
                HttpStatusCode.Conflict, "airline_unverified"),
        })
        {
            store.Result = result;
            using var response = await SendAsync(client, "cancellation", Guid.NewGuid(),
                new { expectedVersion = "AAAAAAAAB9E=", reason = "Solicitud duplicada." });
            Assert.Equal(status, response.StatusCode);
            Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
            Assert.Equal(code, await CodeAsync(response));
        }
        store.Result = CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Forbidden);
        using var forbidden = await SendAsync(client, "decision", Guid.NewGuid(),
            new { approve = true, stationIds = new[] { Guid.NewGuid() }, expectedVersion = "AAAAAAAAB9E=" });
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);
    }

    [Fact]
    public async Task PublishesTheReviewOperations()
    {
        using var client = factory.CreateClient();
        using var response = await client.GetAsync("/swagger/v1/swagger.json", TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        var paths = document.RootElement.GetProperty("paths");
        foreach (var (path, method, operation) in new[]
        {
            ("/api/v1/contracts/commercial-requests/inbox", "get", "ListCommercialRequestInbox"),
            ("/api/v1/contracts/commercial-requests/{id}/airline-verification", "post", "VerifyCommercialRequestAirline"),
            ("/api/v1/contracts/commercial-requests/{id}/representative-confirmation", "post", "ConfirmCommercialRepresentative"),
            ("/api/v1/contracts/commercial-requests/{id}/cancellation", "post", "CancelCommercialRequest"),
            ("/api/v1/contracts/commercial-requests/{id}/decision", "post", "DecideCommercialRequest"),
        })
            Assert.Equal(operation, paths.GetProperty(path).GetProperty(method).GetProperty("operationId").GetString());
        // The profile-level verification without Idempotency-Key or version is retired (contract step).
        Assert.False(paths.TryGetProperty("/api/v1/contracts/commercial-requests/airlines/{profileId}/verification", out _));
    }

    [Fact]
    public async Task TheRetiredProfileVerificationNoLongerWritesAnything()
    {
        var store = new StubStore();
        await using var application = Application(store);
        using var client = Authorized(application);
        using var retired = await client.PutAsJsonAsync(
            $"/api/v1/contracts/commercial-requests/airlines/{Guid.NewGuid()}/verification",
            new { legalName = "Caribe Cargo S.R.L.", countryCode = "DO", icaoCode = "CCX",
                verificationSourceUrl = "https://aoc.example.test/ccx" }, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NotFound, retired.StatusCode);
        Assert.Null(store.LastVerification);
    }

    private static async Task<HttpResponseMessage> SendAsync(HttpClient client, string command, Guid key, object body)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post,
            $"/api/v1/contracts/commercial-requests/{RequestId}/{command}") { Content = JsonContent.Create(body) };
        request.Headers.Add("Idempotency-Key", key.ToString("D"));
        return await client.SendAsync(request, TestContext.Current.CancellationToken);
    }

    private static async Task<string?> CodeAsync(HttpResponseMessage response)
    {
        using var problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        return problem.RootElement.TryGetProperty("code", out var code) ? code.GetString() : null;
    }

    private WebApplicationFactory<Program> Application(StubStore store) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<ICommercialWorkflowStore>();
            services.AddSingleton<ICommercialWorkflowStore>(store);
        }));

    private static HttpClient Authorized(WebApplicationFactory<Program> application)
    {
        var client = application.CreateClient();
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

    private sealed record Decision(Guid? Key, ReviewCommercialInput Input);

    private sealed class StubStore : ICommercialWorkflowStore
    {
        public bool DenyRead { get; set; }
        public CommercialWorkflowResult Result { get; set; } = CommercialWorkflowResult.Success(RequestId);
        public CommercialInboxQuery? LastQuery { get; private set; }
        public (Guid, Guid, CancelCommercialRequestInput)? LastCancel { get; private set; }
        public ConfirmCommercialRepresentativeInput? LastConfirmation { get; private set; }
        public VerifyRequestAirlineInput? LastVerification { get; private set; }
        public Decision? LastDecision { get; private set; }

        public Task<IReadOnlyList<CommercialRequestData>?> ListRequestsAsync(Guid actorId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<CommercialRequestData>?>([]);

        public Task<CommercialInboxData?> ListInboxAsync(Guid actorId, CommercialInboxQuery query,
            CancellationToken cancellationToken = default)
        {
            LastQuery = query;
            return Task.FromResult(DenyRead ? null : new CommercialInboxData(query.Page, query.Limit, 0, false,
                new CommercialInboxCountsData(0, 0, 0, 0, 0), []));
        }

        public Task<IReadOnlyList<CommercialStationData>?> ListStationsAsync(Guid actorId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<CommercialStationData>?>([]);

        public Task<CommercialWorkflowResult> VerifyRequestAirlineAsync(Guid actorId, Guid requestId, Guid idempotencyKey,
            VerifyRequestAirlineInput input, CancellationToken cancellationToken = default)
        {
            LastVerification = input;
            return Task.FromResult(Result);
        }

        public Task<CommercialWorkflowResult> ConfirmRepresentativeAsync(Guid actorId, Guid requestId,
            Guid idempotencyKey, ConfirmCommercialRepresentativeInput input, CancellationToken cancellationToken = default)
        {
            LastConfirmation = input;
            return Task.FromResult(Result);
        }

        public Task<CommercialWorkflowResult> CancelAsync(Guid actorId, Guid requestId, Guid idempotencyKey,
            CancelCommercialRequestInput input, CancellationToken cancellationToken = default)
        {
            LastCancel = (requestId, idempotencyKey, input);
            return Task.FromResult(Result);
        }

        public Task<CommercialWorkflowResult> DecideAsync(Guid actorId, Guid requestId, ReviewCommercialInput input,
            Guid? idempotencyKey, CancellationToken cancellationToken = default)
        {
            LastDecision = new Decision(idempotencyKey, input);
            return Task.FromResult(Result);
        }
    }
}
