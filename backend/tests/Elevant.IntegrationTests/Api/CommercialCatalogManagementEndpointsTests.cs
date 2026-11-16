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

/// <summary>
/// The catalog of Contratos (phase 1, block D): «Dar de baja» is its own command with a key, a version and a
/// reason, the deprecated DELETE keeps working, and every failure is Problem Details with its code.
/// </summary>
public sealed class CommercialCatalogManagementEndpointsTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000005");
    private static readonly Guid ServiceId = Guid.Parse("80000000-0000-7000-8000-0000000000d1");
    private const string Version = "AAAAAAAAB9E=";

    [Fact]
    public async Task RetirementNeedsTheIdempotencyKeyAndPassesTheReasonAndTheVersion()
    {
        var store = new StubStore();
        await using var application = Application(store);
        using var anonymous = application.CreateClient();
        using var denied = await anonymous.PostAsJsonAsync($"/api/v1/contracts/catalog/services/{ServiceId}/retirement",
            new { expectedVersion = Version, reason = "El servicio deja de prestarse en AVIAM." },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, denied.StatusCode);

        using var client = Authorized(application);
        using var missing = await client.PostAsJsonAsync($"/api/v1/contracts/catalog/services/{ServiceId}/retirement",
            new { expectedVersion = Version, reason = "El servicio deja de prestarse en AVIAM." },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        Assert.Null(store.LastRetire);

        var key = Guid.NewGuid();
        using var retired = await SendAsync(client, HttpMethod.Post, $"{ServiceId}/retirement", key,
            new { expectedVersion = Version, reason = "El servicio deja de prestarse en AVIAM." });
        Assert.Equal(HttpStatusCode.OK, retired.StatusCode);
        Assert.Equal((ServiceId, key, new RetireServiceInput(Version, "El servicio deja de prestarse en AVIAM.")),
            store.LastRetire);
        using var body = JsonDocument.Parse(await retired.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.False(body.RootElement.GetProperty("isActive").GetBoolean());
    }

    [Fact]
    public async Task TheFormAndTheDeprecatedDeleteForwardTheOptionalKey()
    {
        var store = new StubStore();
        await using var application = Application(store);
        using var client = Authorized(application);
        var input = new
        {
            code = "RAMP-GPU", name = "Unidad generadora de energía", description = "Energía en tierra para la aeronave.",
            billingUnit = "hour", imageUrl = (string?)null, videoUrl = (string?)null, displayOrder = 3,
            isPublic = false, isActive = true, version = Version,
        };
        using var legacy = await client.PutAsJsonAsync($"/api/v1/contracts/catalog/services/{ServiceId}", input,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, legacy.StatusCode);
        Assert.Null(store.LastSave?.Key);
        var key = Guid.NewGuid();
        using var keyed = await SendAsync(client, HttpMethod.Put, ServiceId.ToString("D"), key, input);
        Assert.Equal(HttpStatusCode.OK, keyed.StatusCode);
        Assert.Equal((ServiceId, key, false), (store.LastSave?.Id, store.LastSave?.Key, store.LastSave?.Input.IsPublic));

        using var deleted = await client.DeleteAsync(
            $"/api/v1/contracts/catalog/services/{ServiceId}?version={Uri.EscapeDataString(Version)}",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, deleted.StatusCode);
        Assert.Equal((ServiceId, Version, (Guid?)null), store.LastDelete);
    }

    public static TheoryData<CatalogMutationFailure, string?, HttpStatusCode, string> Failures => new()
    {
        { CatalogMutationFailure.Conflict, "service_in_active_contract", HttpStatusCode.Conflict, "service_in_active_contract" },
        { CatalogMutationFailure.Conflict, "service_retired", HttpStatusCode.Conflict, "service_retired" },
        { CatalogMutationFailure.Conflict, null, HttpStatusCode.Conflict, "version_conflict" },
        { CatalogMutationFailure.Invalid, "reason_required", HttpStatusCode.BadRequest, "reason_required" },
        { CatalogMutationFailure.Invalid, null, HttpStatusCode.BadRequest, "invalid_service" },
        { CatalogMutationFailure.NotFound, null, HttpStatusCode.NotFound, "not_found" },
    };

    [Theory]
    [MemberData(nameof(Failures))]
    public async Task EveryFailureCarriesItsCode(CatalogMutationFailure failure, string? code, HttpStatusCode status,
        string expected)
    {
        var store = new StubStore { Result = CatalogMutationResult.Failed(failure, code) };
        await using var application = Application(store);
        using var client = Authorized(application);
        using var response = await SendAsync(client, HttpMethod.Post, $"{ServiceId}/retirement", Guid.NewGuid(),
            new { expectedVersion = Version, reason = "El servicio deja de prestarse en AVIAM." });
        Assert.Equal(status, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        Assert.Equal(expected, problem.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task PublishesTheRetirementAndDeprecatesTheDelete()
    {
        using var client = factory.CreateClient();
        using var response = await client.GetAsync("/swagger/v1/swagger.json", TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        var paths = document.RootElement.GetProperty("paths");
        Assert.Equal("RetireCommercialService", paths.GetProperty("/api/v1/contracts/catalog/services/{id}/retirement")
            .GetProperty("post").GetProperty("operationId").GetString());
        var delete = paths.GetProperty("/api/v1/contracts/catalog/services/{id}").GetProperty("delete");
        Assert.True(delete.GetProperty("deprecated").GetBoolean());
    }

    private static async Task<HttpResponseMessage> SendAsync(HttpClient client, HttpMethod method, string route, Guid key,
        object body)
    {
        using var request = new HttpRequestMessage(method, $"/api/v1/contracts/catalog/services/{route}")
        {
            Content = JsonContent.Create(body),
        };
        request.Headers.Add("Idempotency-Key", key.ToString("D"));
        return await client.SendAsync(request, TestContext.Current.CancellationToken);
    }

    private WebApplicationFactory<Program> Application(StubStore store) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<ICommercialCatalogManagementStore>();
            services.AddSingleton<ICommercialCatalogManagementStore>(store);
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

    private sealed class StubStore : ICommercialCatalogManagementStore
    {
        private static readonly ManagedServiceData Retired = new(ServiceId, "RAMP-GPU", "Unidad generadora de energía",
            "Energía en tierra para la aeronave.", "hour", null, null, 3, false, false, Version);

        public CatalogMutationResult? Result { get; init; }
        public (Guid Id, Guid? Key, ManagedServiceInput Input)? LastSave { get; private set; }
        public (Guid, Guid, RetireServiceInput)? LastRetire { get; private set; }
        public (Guid, string?, Guid?)? LastDelete { get; private set; }

        public Task<IReadOnlyList<ManagedServiceData>?> ListAsync(Guid actorId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<ManagedServiceData>?>([Retired]);

        public Task<CatalogMutationResult> SaveAsync(Guid actorId, Guid? serviceId, ManagedServiceInput input,
            Guid? idempotencyKey, CancellationToken cancellationToken = default)
        {
            if (serviceId is { } id) LastSave = (id, idempotencyKey, input);
            return Task.FromResult(Result ?? CatalogMutationResult.Success(Retired with { IsActive = true }));
        }

        public Task<CatalogMutationResult> RetireAsync(Guid actorId, Guid serviceId, Guid idempotencyKey,
            RetireServiceInput input, CancellationToken cancellationToken = default)
        {
            LastRetire = (serviceId, idempotencyKey, input);
            return Task.FromResult(Result ?? CatalogMutationResult.Success(Retired));
        }

        public Task<CatalogMutationResult> DeleteAsync(Guid actorId, Guid serviceId, string? version,
            Guid? idempotencyKey, CancellationToken cancellationToken = default)
        {
            LastDelete = (serviceId, version, idempotencyKey);
            return Task.FromResult(Result ?? CatalogMutationResult.Success(Retired));
        }
    }
}
