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

        public Task<IReadOnlyList<ProvisioningTaskData>?> ListPendingAsync(Guid actorId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<ProvisioningTaskData>?>([]);

        public Task<ProvisioningResult> ProvisionAsync(Guid actorId, Guid requestId, ProvisionAirlineInput input,
            CancellationToken cancellationToken = default) => Task.FromResult(Result);

        public Task<ProvisioningResult> ResendInvitationAsync(Guid actorId, Guid accountId,
            CancellationToken cancellationToken = default) => Task.FromResult(Result);
    }

    private sealed class AirlineStub : ICommercialAirlineManagementStore
    {
        public AirlineMutationResult Result { get; set; } = AirlineMutationResult.Failed(CatalogMutationFailure.Invalid);

        public Task<IReadOnlyList<ManagedAirlineData>?> ListAsync(Guid actorId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<ManagedAirlineData>?>([]);

        public Task<AirlineMutationResult> SaveAsync(Guid actorId, Guid? profileId, ManagedAirlineInput input,
            CancellationToken cancellationToken = default) => Task.FromResult(Result);

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
