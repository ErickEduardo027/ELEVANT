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

/// <summary>1-N16: the provisioning and airline catalog screens of Superadministración get a code on every failure.</summary>
public sealed class CommercialGovernanceProblemCodesTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000007");
    private static readonly Guid TargetId = Guid.Parse("70000000-0000-7000-8000-0000000000b1");

    public static TheoryData<ProvisioningFailure, string?, HttpStatusCode, string> ProvisioningFailures => new()
    {
        { ProvisioningFailure.Conflict, null, HttpStatusCode.Conflict, "request_unavailable" },
        { ProvisioningFailure.Conflict, "email_in_use", HttpStatusCode.Conflict, "email_in_use" },
        { ProvisioningFailure.Invalid, null, HttpStatusCode.BadRequest, "invalid_provisioning" },
        { ProvisioningFailure.Invalid, "invitations_unavailable", HttpStatusCode.BadRequest, "invitations_unavailable" },
        { ProvisioningFailure.NotFound, null, HttpStatusCode.NotFound, "not_found" },
        // 1-N13: an email that already has an account says whether it can be linked and, if not, why.
        { ProvisioningFailure.Conflict, "email_has_account", HttpStatusCode.Conflict, "email_has_account" },
        { ProvisioningFailure.Conflict, "email_in_use_other_airline", HttpStatusCode.Conflict, "email_in_use_other_airline" },
        { ProvisioningFailure.Conflict, "email_in_use_internal", HttpStatusCode.Conflict, "email_in_use_internal" },
        { ProvisioningFailure.Conflict, "account_disabled", HttpStatusCode.Conflict, "account_disabled" },
        { ProvisioningFailure.Invalid, "expected_version_required", HttpStatusCode.BadRequest, "expected_version_required" },
    };

    [Theory]
    [MemberData(nameof(ProvisioningFailures))]
    public async Task ProvisioningFailuresCarryTheirCode(ProvisioningFailure failure, string? code,
        HttpStatusCode status, string expected)
    {
        var store = new ProvisioningStub { Result = ProvisioningResult.Failed(failure, code) };
        await using var application = factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<ICommercialProvisioningStore>();
            services.AddSingleton<ICommercialProvisioningStore>(store);
        }));
        using var client = Authorized(application);
        using var response = await client.PostAsJsonAsync($"/api/v1/governance/provisioning/{TargetId}",
            new { email = "ana@carrier.example.com" }, TestContext.Current.CancellationToken);
        Assert.Equal(status, response.StatusCode);
        Assert.Equal(expected, await CodeAsync(response));
    }

    [Fact]
    public async Task ResendingAnAcceptedInvitationExplainsItself()
    {
        var store = new ProvisioningStub { Result = ProvisioningResult.Failed(ProvisioningFailure.Conflict) };
        await using var application = factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<ICommercialProvisioningStore>();
            services.AddSingleton<ICommercialProvisioningStore>(store);
        }));
        using var client = Authorized(application);
        using var accepted = await client.PostAsync($"/api/v1/governance/provisioning/accounts/{TargetId}/resend-invitation",
            null, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Conflict, accepted.StatusCode);
        Assert.Equal("invitation_already_accepted", await CodeAsync(accepted));
        store.Result = ProvisioningResult.Failed(ProvisioningFailure.Invalid);
        using var unavailable = await client.PostAsync(
            $"/api/v1/governance/provisioning/accounts/{TargetId}/resend-invitation", null,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, unavailable.StatusCode);
        Assert.Equal("invitations_unavailable", await CodeAsync(unavailable));
    }

    public static TheoryData<CatalogMutationFailure, string?, HttpStatusCode, string> AirlineFailures => new()
    {
        { CatalogMutationFailure.Invalid, null, HttpStatusCode.BadRequest, "invalid_airline" },
        { CatalogMutationFailure.Invalid, "registry_check_required", HttpStatusCode.BadRequest, "registry_check_required" },
        { CatalogMutationFailure.Conflict, null, HttpStatusCode.Conflict, "version_conflict" },
        { CatalogMutationFailure.Conflict, "airline_profile_conflict", HttpStatusCode.Conflict, "airline_profile_conflict" },
        { CatalogMutationFailure.NotFound, null, HttpStatusCode.NotFound, "not_found" },
        { CatalogMutationFailure.Conflict, "airline_identity_locked", HttpStatusCode.Conflict, "airline_identity_locked" },
    };

    [Theory]
    [MemberData(nameof(AirlineFailures))]
    public async Task AirlineCatalogFailuresCarryTheirCode(CatalogMutationFailure failure, string? code,
        HttpStatusCode status, string expected)
    {
        var store = new AirlineStub { Result = AirlineMutationResult.Failed(failure, code) };
        await using var application = factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<ICommercialAirlineManagementStore>();
            services.AddSingleton<ICommercialAirlineManagementStore>(store);
        }));
        using var client = Authorized(application);
        using var response = await client.PutAsJsonAsync($"/api/v1/governance/airlines/{TargetId}", new
        {
            sourceName = "CARRIER", displayName = "Carrier", region = "Caribe", sourceUrl = "https://carrier.example.com",
            isVerified = false, isPublished = false, version = "AAAAAAAAB9E=",
        }, TestContext.Current.CancellationToken);
        Assert.Equal(status, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal(expected, await CodeAsync(response));
    }

    [Fact]
    public async Task ProvisioningPassesItsIdempotencyKeyAndLinkingRequiresOne()
    {
        var store = new ProvisioningStub();
        await using var application = factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<ICommercialProvisioningStore>();
            services.AddSingleton<ICommercialProvisioningStore>(store);
        }));
        using var client = Authorized(application);
        var ct = TestContext.Current.CancellationToken;
        var key = Guid.NewGuid();
        using (var provision = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/governance/provisioning/{TargetId}")
               { Content = JsonContent.Create(new { email = "ana@carrier.example.com", expectedVersion = "AAAAAAAAB9E=" }) })
        {
            provision.Headers.Add("Idempotency-Key", key.ToString());
            using var created = await client.SendAsync(provision, ct);
            Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        }
        Assert.Equal(("provision", (Guid?)key), (store.Calls[^1].Command, store.Calls[^1].Key));
        Assert.Equal("AAAAAAAAB9E=", ((ProvisionAirlineInput)store.Calls[^1].Input!).ExpectedVersion);

        // The link is a new command: without its Idempotency-Key it never reaches the store.
        using var keyless = await client.PostAsJsonAsync($"/api/v1/governance/provisioning/{TargetId}/account-link",
            new { email = "ana@carrier.example.com", expectedVersion = "AAAAAAAAB9E=" }, ct);
        Assert.Equal(HttpStatusCode.BadRequest, keyless.StatusCode);
        Assert.DoesNotContain(store.Calls, call => call.Command == "link");
        using var link = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/governance/provisioning/{TargetId}/account-link")
            { Content = JsonContent.Create(new { email = "ana@carrier.example.com", expectedVersion = "AAAAAAAAB9E=" }) };
        link.Headers.Add("Idempotency-Key", key.ToString());
        using var linked = await client.SendAsync(link, ct);
        Assert.Equal(HttpStatusCode.OK, linked.StatusCode);
        using (var body = JsonDocument.Parse(await linked.Content.ReadAsStringAsync(ct)))
            Assert.Equal(TargetId, body.RootElement.GetProperty("accountId").GetGuid());
        Assert.Equal(new LinkProvisioningAccountInput("ana@carrier.example.com", "AAAAAAAAB9E="), store.Calls[^1].Input);

        store.Result = ProvisioningResult.Failed(ProvisioningFailure.Conflict, "email_in_use_other_airline");
        using var other = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/governance/provisioning/{TargetId}/account-link")
            { Content = JsonContent.Create(new { email = "gsa@carrier.example.com", expectedVersion = "AAAAAAAAB9E=" }) };
        other.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
        using var refused = await client.SendAsync(other, ct);
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Equal("email_in_use_other_airline", await CodeAsync(refused));
    }

    [Fact]
    public async Task ResendingTakesTheAccountVersionWithItsKeyAndStillAcceptsAnEmptyBody()
    {
        var store = new ProvisioningStub();
        await using var application = factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<ICommercialProvisioningStore>();
            services.AddSingleton<ICommercialProvisioningStore>(store);
        }));
        using var client = Authorized(application);
        var ct = TestContext.Current.CancellationToken;
        var key = Guid.NewGuid();
        using var resend = new HttpRequestMessage(HttpMethod.Post,
            $"/api/v1/governance/provisioning/accounts/{TargetId}/resend-invitation")
            { Content = JsonContent.Create(new { expectedVersion = "AAAAAAAAB9E=" }) };
        resend.Headers.Add("Idempotency-Key", key.ToString());
        using var accepted = await client.SendAsync(resend, ct);
        Assert.Equal(HttpStatusCode.Accepted, accepted.StatusCode);
        Assert.Equal(("resend", (Guid?)key, (object?)new ResendInvitationInput("AAAAAAAAB9E=")), store.Calls[^1]);

        // Older clients post nothing (expand phase).
        using var legacy = await client.PostAsync($"/api/v1/governance/provisioning/accounts/{TargetId}/resend-invitation",
            null, ct);
        Assert.Equal(HttpStatusCode.Accepted, legacy.StatusCode);
        Assert.Equal(("resend", (Guid?)null, (object?)null), store.Calls[^1]);
    }

    [Fact]
    public async Task UpdatingAnAirlinePassesItsOptionalIdempotencyKey()
    {
        var profile = new ManagedAirlineData(TargetId, "CARRIER", "Carrier", null, "Caribe", null, null, "CRR", null,
            "https://carrier.example.com", null, false, false, "AAAAAAAAB9E=");
        var store = new AirlineStub { Result = AirlineMutationResult.Success(profile) };
        await using var application = factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<ICommercialAirlineManagementStore>();
            services.AddSingleton<ICommercialAirlineManagementStore>(store);
        }));
        using var client = Authorized(application);
        var key = Guid.NewGuid();
        using var update = new HttpRequestMessage(HttpMethod.Put, $"/api/v1/governance/airlines/{TargetId}")
        {
            Content = JsonContent.Create(new
            {
                sourceName = "CARRIER", displayName = "Carrier", region = "Caribe", sourceUrl = "https://carrier.example.com",
                icaoCode = "CRR", isVerified = false, isPublished = false, version = "AAAAAAAAB9E=",
            }),
        };
        update.Headers.Add("Idempotency-Key", key.ToString());
        using var response = await client.SendAsync(update, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(key, store.LastKey);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.False(body.RootElement.GetProperty("identityLocked").GetBoolean());
    }

    private static async Task<string?> CodeAsync(HttpResponseMessage response)
    {
        using var problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        return problem.RootElement.TryGetProperty("code", out var code) ? code.GetString() : null;
    }

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

    private sealed class ProvisioningStub : ICommercialProvisioningStore
    {
        public ProvisioningResult Result { get; set; } = ProvisioningResult.Success(TargetId);

        public List<(string Command, Guid? Key, object? Input)> Calls { get; } = [];

        public Task<IReadOnlyList<ProvisioningTaskData>?> ListPendingAsync(Guid actorId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<ProvisioningTaskData>?>([]);

        public Task<ProvisioningResult> ProvisionAsync(Guid actorId, Guid requestId, ProvisionAirlineInput input,
            Guid? idempotencyKey, CancellationToken cancellationToken = default)
        {
            Calls.Add(("provision", idempotencyKey, input));
            return Task.FromResult(Result);
        }

        public Task<ProvisioningResult> LinkAccountAsync(Guid actorId, Guid requestId, Guid idempotencyKey,
            LinkProvisioningAccountInput input, CancellationToken cancellationToken = default)
        {
            Calls.Add(("link", idempotencyKey, input));
            return Task.FromResult(Result);
        }

        public Task<ProvisioningResult> ResendInvitationAsync(Guid actorId, Guid accountId, ResendInvitationInput? input,
            Guid? idempotencyKey, CancellationToken cancellationToken = default)
        {
            Calls.Add(("resend", idempotencyKey, input));
            return Task.FromResult(Result);
        }
    }

    private sealed class AirlineStub : ICommercialAirlineManagementStore
    {
        public AirlineMutationResult Result { get; set; } = AirlineMutationResult.Failed(CatalogMutationFailure.Invalid);

        public Task<IReadOnlyList<ManagedAirlineData>?> ListAsync(Guid actorId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<ManagedAirlineData>?>([]);

        public Guid? LastKey { get; private set; }

        public Task<AirlineMutationResult> SaveAsync(Guid actorId, Guid? profileId, ManagedAirlineInput input,
            Guid? idempotencyKey, CancellationToken cancellationToken = default)
        {
            LastKey = idempotencyKey;
            return Task.FromResult(Result);
        }

        public Task<AirlineMutationResult> ArchiveAsync(Guid actorId, Guid profileId, string version,
            CancellationToken cancellationToken = default) => Task.FromResult(Result);

        public Task<AirlineEnrichmentResult> EnrichHistoricalCatalogAsync(Guid actorId,
            CancellationToken cancellationToken = default) => Task.FromResult(new AirlineEnrichmentResult(0, null));

        public Task<(AirlineRegistryKey? Key, CatalogMutationFailure? Failure)> RegistryKeyAsync(Guid actorId,
            Guid profileId, CancellationToken cancellationToken = default) =>
            Task.FromResult<(AirlineRegistryKey?, CatalogMutationFailure?)>((null, CatalogMutationFailure.NotFound));

        public Task<AirlineMutationResult> RecordRegistryCheckAsync(Guid actorId, AirlineRegistryKey key,
            AirlineRegistryCheck check, CancellationToken cancellationToken = default) => Task.FromResult(Result);
    }
}
