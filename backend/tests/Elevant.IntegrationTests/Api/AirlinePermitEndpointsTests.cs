using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Commercial;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

/// <summary>
/// Phase 2, block B: the permit commands pass their Idempotency-Key (required to revoke, optional to submit
/// and review), answer the contracts they changed and fail with Spanish, coded Problem Details (2-N09, 2-N30);
/// the portal standing is resolved for the session's airline (2-N32).
/// </summary>
public sealed class AirlinePermitEndpointsTests(ElevantApiFactory factory) : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000005");
    private static readonly Guid PermitId = Guid.Parse("70000000-0000-7000-8000-0000000000b9");
    private static readonly Guid ContractId = Guid.Parse("70000000-0000-7000-8000-0000000000c9");
    private static readonly Guid OrganizationId = Guid.Parse("10000000-0000-7000-8000-000000000002");

    private static readonly string[] PermitKeys =
    [
        "id", "airlineId", "airline", "kind", "number", "issuer", "issuedOn", "expiresOn", "validity", "review",
        "reviewNote", "documentUrl", "submittedAt", "reviewedAt", "version", "revokedAt", "revocationReason",
    ];

    [Fact]
    public async Task RevocationNeedsItsKeyAndAnswersThePermitWithTheContractsItSuspended()
    {
        var store = new PermitStub();
        await using var application = Application(services => Replace<IAirlinePermitStore>(services, store));
        using var client = Authorized(application);
        var body = new { reason = "Se verificó por error.", expectedVersion = "AAAAAAAAB9E=" };

        using var missing = await client.PostAsJsonAsync($"/api/v1/contracts/permits/{PermitId}/revocation", body,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        Assert.Null(store.LastRevocation);

        var key = Guid.NewGuid();
        using var revoked = await SendAsync(client, $"contracts/permits/{PermitId}/revocation", key, body);
        Assert.Equal(HttpStatusCode.OK, revoked.StatusCode);
        Assert.Equal((key, new RevokeAirlinePermitInput(body.reason, body.expectedVersion)), store.LastRevocation);
        using var answer = JsonDocument.Parse(await revoked.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        // The permit keys of the list plus the contracts the command changed (2-N30).
        Assert.Equal(PermitKeys.Append("contracts").Order(StringComparer.Ordinal),
            answer.RootElement.EnumerateObject().Select(item => item.Name).Order(StringComparer.Ordinal));
        var change = answer.RootElement.GetProperty("contracts")[0];
        Assert.Equal(("CTR-2026-0001", "Suspended"), (change.GetProperty("contractCode").GetString(),
            change.GetProperty("status").GetString()));

        foreach (var (failure, code, status) in new[]
        {
            (AirlinePermitFailure.Conflict, "permit_not_verified", HttpStatusCode.Conflict),
            (AirlinePermitFailure.Conflict, "version_conflict", HttpStatusCode.Conflict),
            (AirlinePermitFailure.Conflict, "idempotency_conflict", HttpStatusCode.Conflict),
            (AirlinePermitFailure.Invalid, "reason_required", HttpStatusCode.BadRequest),
            (AirlinePermitFailure.NotFound, "not_found", HttpStatusCode.NotFound),
        })
        {
            store.Result = AirlinePermitResult.Failed(failure, code);
            using var refused = await SendAsync(client, $"contracts/permits/{PermitId}/revocation", Guid.NewGuid(), body);
            Assert.Equal(status, refused.StatusCode);
            var problem = await ProblemAsync(refused);
            Assert.Equal(code, problem.Code);
            Assert.DoesNotContain("The ", problem.Title, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task SubmissionAndReviewPassTheirOptionalKeyAndAClosedReviewIsCoded()
    {
        var store = new PermitStub();
        await using var application = Application(services => Replace<IAirlinePermitStore>(services, store));
        using var client = Authorized(application);
        var submission = new { kind = "OperatingPermit", number = "JAC-1", issuer = "JAC", issuedOn = "2026-10-01",
            expiresOn = "2027-10-01", documentUrl = (string?)null };

        using var withoutKey = await client.PostAsJsonAsync("/api/v1/airline/permits", submission,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Created, withoutKey.StatusCode);
        Assert.Null(store.LastSubmissionKey);
        var key = Guid.NewGuid();
        using var withKey = await SendAsync(client, "airline/permits", key, submission);
        Assert.Equal(HttpStatusCode.Created, withKey.StatusCode);
        Assert.Equal(key, store.LastSubmissionKey);

        var review = new { verified = true, note = (string?)null, expectedVersion = "AAAAAAAAB9E=" };
        using var reviewed = await SendAsync(client, $"contracts/permits/{PermitId}/review", key, review);
        Assert.Equal(HttpStatusCode.OK, reviewed.StatusCode);
        Assert.Equal(key, store.LastReviewKey);
        using var answer = JsonDocument.Parse(await reviewed.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.True(answer.RootElement.TryGetProperty("contracts", out _));

        foreach (var (failure, code, status) in new[]
        {
            (AirlinePermitFailure.Conflict, "review_closed", HttpStatusCode.Conflict),
            (AirlinePermitFailure.Invalid, "permit_expired", HttpStatusCode.BadRequest),
            (AirlinePermitFailure.Invalid, (string?)null, HttpStatusCode.BadRequest),
        })
        {
            store.Result = AirlinePermitResult.Failed(failure, code);
            using var refused = await SendAsync(client, $"contracts/permits/{PermitId}/review", Guid.NewGuid(), review);
            Assert.Equal(status, refused.StatusCode);
            var problem = await ProblemAsync(refused);
            Assert.Equal(code ?? "invalid_permit", problem.Code);
            Assert.DoesNotContain("The ", problem.Title, StringComparison.Ordinal);
        }
        store.SubmissionResult = AirlinePermitResult.Failed(AirlinePermitFailure.Invalid, "document_expired");
        using var expired = await SendAsync(client, "airline/permits", Guid.NewGuid(), submission);
        Assert.Equal((HttpStatusCode.BadRequest, "document_expired"), (expired.StatusCode, (await ProblemAsync(expired)).Code));
    }

    [Fact]
    public async Task TheStandingIsTheSessionAirlineWithItsHistoricalStations()
    {
        var standing = new StandingStub(new AirlinePortalStandingData(OrganizationId, AirlinePortalStandings.Suspended, true,
            [new AirlinePortalStandingStationData(Guid.NewGuid(), "PUJ", "Punta Cana", "America/Santo_Domingo", false)],
            [new AirlinePortalStandingContractData(ContractId, "CTR-2026-0001", "Suspended", null, [])]));
        await using var application = Application(services =>
        {
            Replace<IAirlinePortalStandingStore>(services, standing);
            Replace<IActorContextResolver>(services, new Airline());
        });
        using var client = Authorized(application);

        using var response = await client.GetAsync("/api/v1/airline/portal/standing", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(OrganizationId, standing.Organization);
        using var answer = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.Equal(["organizationId", "status", "readOnly", "stations", "contracts"],
            answer.RootElement.EnumerateObject().Select(item => item.Name).ToArray());
        Assert.True(answer.RootElement.GetProperty("readOnly").GetBoolean());
        Assert.Equal(["id", "code", "name", "ianaTimeZone", "current"],
            answer.RootElement.GetProperty("stations")[0].EnumerateObject().Select(item => item.Name).ToArray());
        Assert.Equal(["id", "code", "status", "pendingReason", "versionsAwaitingSignatures"],
            answer.RootElement.GetProperty("contracts")[0].EnumerateObject().Select(item => item.Name).ToArray());

        standing.Standing = null;
        using var missing = await client.GetAsync("/api/v1/airline/portal/standing", TestContext.Current.CancellationToken);
        Assert.Equal((HttpStatusCode.NotFound, "not_found"), (missing.StatusCode, (await ProblemAsync(missing)).Code));
    }

    private static async Task<HttpResponseMessage> SendAsync(HttpClient client, string path, Guid key, object body)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/{path}") { Content = JsonContent.Create(body) };
        request.Headers.Add("Idempotency-Key", key.ToString("D"));
        return await client.SendAsync(request, TestContext.Current.CancellationToken);
    }

    private static async Task<(string? Code, string Title)> ProblemAsync(HttpResponseMessage response)
    {
        using var problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        return (problem.RootElement.TryGetProperty("code", out var code) ? code.GetString() : null,
            problem.RootElement.GetProperty("title").GetString() ?? string.Empty);
    }

    private static void Replace<T>(IServiceCollection services, T implementation) where T : class
    {
        services.RemoveAll<T>();
        services.AddSingleton(implementation);
    }

    private WebApplicationFactory<Program> Application(Action<IServiceCollection> configure) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(configure));

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

    private static AirlinePermitData Permit() => new(PermitId, Guid.NewGuid(), "Demo Air", "OperatingPermit", "JAC-1", "JAC",
        new DateOnly(2026, 10, 1), new DateOnly(2027, 10, 1), "Current", "Revoked", null, null,
        new DateTimeOffset(2026, 10, 2, 12, 0, 0, TimeSpan.Zero), new DateTimeOffset(2026, 10, 3, 12, 0, 0, TimeSpan.Zero),
        "AAAAAAAAB9E=", new DateTimeOffset(2026, 11, 6, 12, 0, 0, TimeSpan.Zero), "Se verificó por error.");

    private sealed class PermitStub : IAirlinePermitStore
    {
        public AirlinePermitResult Result { get; set; } = AirlinePermitResult.Success(new AirlinePermitDecisionData(Permit(),
            [new AirlinePermitContractChange(ContractId, "CTR-2026-0001", "Suspended")]));
        public AirlinePermitResult SubmissionResult { get; set; } = AirlinePermitResult.Success(Permit());
        public (Guid Key, RevokeAirlinePermitInput Input)? LastRevocation { get; private set; }
        public Guid? LastSubmissionKey { get; private set; }
        public Guid? LastReviewKey { get; private set; }

        public Task<IReadOnlyList<AirlinePermitData>?> ListForAirlineAsync(Guid actorId,
            CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<AirlinePermitData>?>([Permit()]);

        public Task<AirlinePermitResult> SubmitAsync(Guid actorId, SubmitAirlinePermitInput input, Guid? idempotencyKey,
            CancellationToken cancellationToken = default)
        {
            LastSubmissionKey = idempotencyKey;
            return Task.FromResult(SubmissionResult);
        }

        public Task<IReadOnlyList<AirlinePermitData>?> ListForContractsAsync(Guid actorId, string? review,
            CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<AirlinePermitData>?>([Permit()]);

        public Task<AirlinePermitResult> ReviewAsync(Guid actorId, Guid permitId, ReviewAirlinePermitInput input,
            Guid? idempotencyKey, CancellationToken cancellationToken = default)
        {
            LastReviewKey = idempotencyKey;
            return Task.FromResult(Result);
        }

        public Task<AirlinePermitResult> RevokeAsync(Guid actorId, Guid permitId, RevokeAirlinePermitInput input,
            Guid idempotencyKey, CancellationToken cancellationToken = default)
        {
            LastRevocation = (idempotencyKey, input);
            return Task.FromResult(Result);
        }
    }

    private sealed class StandingStub(AirlinePortalStandingData? standing) : IAirlinePortalStandingStore
    {
        public AirlinePortalStandingData? Standing { get; set; } = standing;
        public Guid? Organization { get; private set; }

        public Task<AirlinePortalStandingData?> GetStandingAsync(Guid organizationId, DateOnly onDate,
            CancellationToken cancellationToken = default)
        {
            Organization = organizationId;
            return Task.FromResult(Standing);
        }
    }

    private sealed class Airline : IActorContextResolver
    {
        public Task<ActorContext?> ResolveAsync(Guid accountId, CancellationToken cancellationToken = default) =>
            Task.FromResult<ActorContext?>(new ActorContext(accountId, "airline.client@dev.elevant.test", "Airline Client",
                [new ActorRole(Guid.NewGuid(), "AIRLINE_CLIENT", "Airline Client", PortalKind.AirlinePortal, "airline_client")],
                [new ActorMembership(Guid.NewGuid(), OrganizationId, "DEMO-AIR", "Demo Airlines",
                    OrganizationType.AirlineCustomer, MembershipKind.AirlineClient)], []));
    }
}
