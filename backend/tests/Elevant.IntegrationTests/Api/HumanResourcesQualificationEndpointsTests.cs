using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Elevant.Application.Abstractions.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

public sealed class HumanResourcesQualificationEndpointsTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000004");

    [Fact]
    public async Task QualificationReadRequiresAuthenticationAndIsPublishedInOpenApi()
    {
        using var client = factory.CreateClient();
        using var anonymous = await client.GetAsync(
            "/api/v1/human-resources/qualifications",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);

        using var response = await client.GetAsync("/swagger/v1/swagger.json",
            TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        var endpoint = json.RootElement.GetProperty("paths")
            .GetProperty("/api/v1/human-resources/qualifications").GetProperty("get");
        Assert.True(endpoint.GetProperty("responses").TryGetProperty("200", out _));
        Assert.True(endpoint.GetProperty("responses").TryGetProperty("403", out _));
    }

    [Fact]
    public async Task QualificationRecordingHasAnAuthenticatedVersionedRoute()
    {
        using var client = factory.CreateClient();
        using var anonymous = await client.PutAsync(
            $"/api/v1/human-resources/qualifications/{Guid.NewGuid():D}",
            new StringContent("{}"), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);

        using var response = await client.GetAsync("/swagger/v1/swagger.json",
            TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        var endpoint = json.RootElement.GetProperty("paths")
            .GetProperty("/api/v1/human-resources/qualifications/{id}")
            .GetProperty("put");
        Assert.True(endpoint.GetProperty("responses").TryGetProperty("200", out _));
        Assert.True(endpoint.GetProperty("responses").TryGetProperty("409", out _));
    }

    [Fact]
    public async Task QualificationEquipmentOptionsHaveAnAuthenticatedVersionedRoute()
    {
        using var client = factory.CreateClient();
        using var anonymous = await client.GetAsync(
            "/api/v1/human-resources/qualifications/equipment-types",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        using var response = await client.GetAsync("/swagger/v1/swagger.json",
            TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        var endpoint = json.RootElement.GetProperty("paths")
            .GetProperty("/api/v1/human-resources/qualifications/equipment-types")
            .GetProperty("get");
        Assert.True(endpoint.GetProperty("responses").TryGetProperty("200", out _));
        Assert.True(endpoint.GetProperty("responses").TryGetProperty("403", out _));
    }

    [Fact]
    public async Task ReturnsBoundedCurrentQualificationsAndRejectsInvalidPaging()
    {
        var qualificationId = Guid.NewGuid();
        var stub = new Stub
        {
            Data = new HumanResourcesQualificationPage(2, 1, false,
            [new HumanResourcesQualificationData(qualificationId, Guid.NewGuid(),
                "Riley Ramp", "DEV-RA-001", Guid.NewGuid(), "GPU", "Ground power unit",
                1, new DateOnly(2026, 1, 2), new DateOnly(2026, 1, 3),
                new DateOnly(2099, 12, 31), "Synthetic Training Center", "Development Instructor")]),
        };
        await using var application = CreateApplication(stub);
        using var client = application.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());

        using var bad = await client.GetAsync(
            "/api/v1/human-resources/qualifications?page=0",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        using var tooLarge = await client.GetAsync(
            "/api/v1/human-resources/qualifications?limit=101",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, tooLarge.StatusCode);
        using var incompleteFilter = await client.GetAsync(
            $"/api/v1/human-resources/qualifications?rampProfileId={Guid.NewGuid():D}",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, incompleteFilter.StatusCode);
        using var response = await client.GetAsync(
            "/api/v1/human-resources/qualifications?page=2&limit=1",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString());
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        Assert.Equal(qualificationId,
            json.RootElement.GetProperty("qualifications")[0].GetProperty("id").GetGuid());
        Assert.Equal("GPU", json.RootElement.GetProperty("qualifications")[0]
            .GetProperty("equipmentCode").GetString());
        Assert.Equal((AccountId, 2, 1), stub.Request);
        var filteredAgentId = Guid.NewGuid();
        var filteredEquipmentId = Guid.NewGuid();
        using var filtered = await client.GetAsync(
            $"/api/v1/human-resources/qualifications?page=1&limit=1&rampProfileId={filteredAgentId:D}&equipmentTypeId={filteredEquipmentId:D}",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, filtered.StatusCode);
        Assert.Equal((AccountId, 1, 1, filteredAgentId, filteredEquipmentId), stub.FilterRequest);
    }

    [Fact]
    public async Task DeniedActorDoesNotReceiveQualificationRows()
    {
        await using var application = CreateApplication(new Stub());
        using var client = application.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());
        using var response = await client.GetAsync(
            "/api/v1/human-resources/qualifications",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    private WebApplicationFactory<Program> CreateApplication(Stub stub) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IHumanResourcesQualificationReadStore>();
            services.AddSingleton<IHumanResourcesQualificationReadStore>(stub);
        }));

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

    private sealed class Stub : IHumanResourcesQualificationReadStore
    {
        public HumanResourcesQualificationPage? Data { get; init; }
        public (Guid AccountId, int Page, int Limit)? Request { get; private set; }
        public (Guid AccountId, int Page, int Limit, Guid AgentId, Guid EquipmentId)?
            FilterRequest { get; private set; }

        public Task<HumanResourcesQualificationPage?> ListCurrentAsync(Guid actorId, int page,
            int limit, CancellationToken cancellationToken = default)
        {
            Request = (actorId, page, limit);
            return Task.FromResult(Data);
        }

        public Task<HumanResourcesQualificationPage?> ListCurrentAsync(Guid actorId, int page,
            int limit, Guid rampProfileId, Guid equipmentTypeId,
            CancellationToken cancellationToken = default)
        {
            Request = (actorId, page, limit);
            FilterRequest = (actorId, page, limit, rampProfileId, equipmentTypeId);
            return Task.FromResult(Data);
        }

        public Task<IReadOnlyList<HumanResourcesQualificationEquipmentType>?>
            ListEquipmentTypesAsync(Guid actorId, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<HumanResourcesQualificationEquipmentType>?>([]);
    }
}
