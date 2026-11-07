using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Elevant.Application.Abstractions.Identity;
using Elevant.Infrastructure.Authentication;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

public sealed class CommercialAirlineManagementEndpointsTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    [Fact]
    public async Task ManagementIsPrivateAndPublishedInTheApiContract()
    {
        using var client = factory.CreateClient();
        using var anonymous = await client.GetAsync("/api/v1/governance/airlines",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);

        using var swagger = await client.GetAsync("/swagger/v1/swagger.json",
            TestContext.Current.CancellationToken);
        swagger.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await swagger.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        var routes = json.RootElement.GetProperty("paths");
        Assert.True(routes.GetProperty("/api/v1/governance/airlines").TryGetProperty("get", out _));
        Assert.True(routes.GetProperty("/api/v1/governance/airlines").TryGetProperty("post", out _));
        Assert.True(routes.GetProperty("/api/v1/governance/airlines/{id}").TryGetProperty("put", out _));
        Assert.True(routes.GetProperty("/api/v1/governance/airlines/{id}").TryGetProperty("delete", out _));
        Assert.True(routes.GetProperty("/api/v1/governance/airlines/enrichment")
            .TryGetProperty("post", out _));
    }

    [Fact]
    public async Task RampProfileManagementRequiresInternalAuthenticationAndHasAContract()
    {
        using var client = factory.CreateClient();
        using var anonymous = await client.GetAsync("/api/v1/human-resources/ramp-profiles",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);

        using var swagger = await client.GetAsync("/swagger/v1/swagger.json",
            TestContext.Current.CancellationToken);
        swagger.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await swagger.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        var routes = json.RootElement.GetProperty("paths");
        Assert.True(routes.GetProperty("/api/v1/human-resources/ramp-profiles")
            .TryGetProperty("get", out _));
        Assert.True(routes.GetProperty("/api/v1/human-resources/ramp-profiles")
            .TryGetProperty("post", out _));
        Assert.True(routes.GetProperty("/api/v1/human-resources/ramp-profiles/{id}")
            .TryGetProperty("put", out _));
        var schemas = json.RootElement.GetProperty("components").GetProperty("schemas");
        var input = schemas.GetProperty("SaveRampProfileInput").GetProperty("properties");
        Assert.True(input.TryGetProperty("terminalIds", out _));
        Assert.True(input.TryGetProperty("supervisor", out _));
        var profile = schemas.GetProperty("RampProfileData").GetProperty("properties");
        Assert.True(profile.TryGetProperty("terminals", out _));
        Assert.True(profile.TryGetProperty("supervisorProfileId", out _));
        Assert.True(profile.TryGetProperty("accountStatus", out _));
        Assert.True(schemas.GetProperty("RampProfileCatalog").GetProperty("properties")
            .TryGetProperty("availableTerminals", out _));
    }

    [Fact]
    public async Task MobileAccessRequestContractIsPrivateAndExposesDecisionRoutes()
    {
        using var client = factory.CreateClient();
        using var anonymous = await client.PostAsync(
            "/api/v1/human-resources/ramp-profiles/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/access-requests",
            JsonContent.Create(new { requestId = Guid.NewGuid() }),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);

        using var swagger = await client.GetAsync("/swagger/v1/swagger.json",
            TestContext.Current.CancellationToken);
        swagger.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await swagger.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        var routes = json.RootElement.GetProperty("paths");
        var requestPost = routes.GetProperty("/api/v1/human-resources/ramp-profiles/{id}/access-requests")
            .GetProperty("post");
        foreach (var status in new[] { "201", "400", "403", "404", "409" })
            Assert.True(requestPost.GetProperty("responses").TryGetProperty(status, out _));
        Assert.True(routes.GetProperty("/api/v1/governance/ramp-mobile-access-requests")
            .TryGetProperty("get", out _));
        var rejectPost = routes.GetProperty("/api/v1/governance/ramp-mobile-access-requests/{id}/reject")
            .GetProperty("post");
        foreach (var status in new[] { "200", "400", "403", "404", "409" })
            Assert.True(rejectPost.GetProperty("responses").TryGetProperty(status, out _));
        // 2-N38: the legacy account creation that also fulfilled these requests is retired; ramp access is
        // requested for an employee and validated by Gestión Humana, and a pending legacy request is rejected.
        var retiredPost = routes.GetProperty("/api/v1/governance/users").GetProperty("post");
        Assert.True(retiredPost.GetProperty("responses").TryGetProperty("410", out _));
        Assert.False(retiredPost.GetProperty("responses").TryGetProperty("201", out _));
    }

    [Theory]
    [InlineData(MobileAccessRequestFailure.Invalid, HttpStatusCode.BadRequest)]
    [InlineData(MobileAccessRequestFailure.Forbidden, HttpStatusCode.Forbidden)]
    [InlineData(MobileAccessRequestFailure.NotFound, HttpStatusCode.NotFound)]
    [InlineData(MobileAccessRequestFailure.Conflict, HttpStatusCode.Conflict)]
    public async Task MobileAccessRequestMapsStoreFailuresToHttp(
        MobileAccessRequestFailure failure, HttpStatusCode expected)
    {
        var stub = new MobileAccessRequestStub { Failure = failure };
        await using var app = WithMobileAccessStore(stub);
        using var client = Authorized(app);
        var requestId = Guid.NewGuid();
        using var response = await client.PostAsJsonAsync(
            $"/api/v1/human-resources/ramp-profiles/{Guid.NewGuid():D}/access-requests",
            new { requestId }, TestContext.Current.CancellationToken);
        Assert.Equal(expected, response.StatusCode);
        Assert.Equal(requestId, stub.SubmittedRequestId);
    }

    [Theory]
    [InlineData(MobileAccessRequestFailure.Invalid, HttpStatusCode.BadRequest)]
    [InlineData(MobileAccessRequestFailure.Forbidden, HttpStatusCode.Forbidden)]
    [InlineData(MobileAccessRequestFailure.NotFound, HttpStatusCode.NotFound)]
    [InlineData(MobileAccessRequestFailure.Conflict, HttpStatusCode.Conflict)]
    public async Task MobileAccessRejectionMapsStoreFailuresAndPassesExpectedVersion(
        MobileAccessRequestFailure failure, HttpStatusCode expected)
    {
        var stub = new MobileAccessRequestStub { Failure = failure };
        await using var app = WithMobileAccessStore(stub);
        using var client = Authorized(app);
        var requestId = Guid.NewGuid();
        using var response = await client.PostAsJsonAsync(
            $"/api/v1/governance/ramp-mobile-access-requests/{requestId:D}/reject",
            new { reason = "Synthetic review", expectedVersion = "version-1" },
            TestContext.Current.CancellationToken);
        Assert.Equal(expected, response.StatusCode);
        Assert.Equal((requestId, "Synthetic review", "version-1"), stub.Rejection);
    }

    private WebApplicationFactory<Program> WithMobileAccessStore(MobileAccessRequestStub stub) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IRampMobileAccessRequestStore>();
            services.AddSingleton<IRampMobileAccessRequestStore>(stub);
        }));

    private static HttpClient Authorized(WebApplicationFactory<Program> app)
    {
        var client = app.CreateClient();
        var now = DateTimeOffset.UtcNow;
        var token = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Audience = ElevantApiFactory.AuthenticationAudience,
            Issuer = ElevantApiFactory.AuthenticationIssuer,
            IssuedAt = now.UtcDateTime,
            NotBefore = now.AddSeconds(-5).UtcDateTime,
            Expires = now.AddMinutes(15).UtcDateTime,
            SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(
                Convert.FromBase64String(ElevantApiFactory.AuthenticationSigningKeyBase64)),
                SecurityAlgorithms.HmacSha256),
            Subject = new System.Security.Claims.ClaimsIdentity([
                new System.Security.Claims.Claim(JwtRegisteredClaimNames.Sub, Guid.NewGuid().ToString("D")),
                new System.Security.Claims.Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("D")),
                new System.Security.Claims.Claim(SessionSecurityVersion.ClaimType,
                    SessionSecurityVersion.Fingerprint(ElevantApiFactory.TestSecurityStamp)),
            ]),
            TokenType = "at+jwt",
        });
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private sealed class MobileAccessRequestStub : IRampMobileAccessRequestStore
    {
        public MobileAccessRequestFailure Failure { get; init; }
        public Guid SubmittedRequestId { get; private set; }
        public (Guid, string, string) Rejection { get; private set; }
        public Task<IReadOnlyList<RampMobileAccessRequestData>?> ListForHumanResourcesAsync(
            Guid actorId, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<RampMobileAccessRequestData>?>([]);
        public Task<IReadOnlyList<RampMobileAccessRequestData>?> ListForGovernanceAsync(
            Guid actorId, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<RampMobileAccessRequestData>?>([]);
        public Task<MobileAccessRequestResult> RequestAsync(Guid actorId, Guid profileId,
            Guid requestId, CancellationToken cancellationToken = default)
        {
            SubmittedRequestId = requestId;
            return Task.FromResult(MobileAccessRequestResult.Failed(Failure));
        }
        public Task<MobileAccessRequestResult> RejectAsync(Guid actorId, Guid requestId,
            string reason, string expectedVersion, CancellationToken cancellationToken = default)
        {
            Rejection = (requestId, reason, expectedVersion);
            return Task.FromResult(MobileAccessRequestResult.Failed(Failure));
        }
    }
}
