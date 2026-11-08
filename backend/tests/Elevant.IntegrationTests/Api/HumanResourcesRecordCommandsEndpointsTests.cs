using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Reflection;
using System.Text.Json;
using Elevant.Application.Abstractions.Identity;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

/// <summary>
/// Phase 2, block D: the ramp profile save and the employee update reach the release path (2-N06), so they take the
/// intent's Idempotency-Key with the version on screen, and every refusal of either command names its rule.
/// </summary>
public sealed class HumanResourcesRecordCommandsEndpointsTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000004");

    [Fact]
    public async Task ARampProfileSavePassesItsKeyAndVersionAndEveryRefusalCarriesItsCode()
    {
        var stub = new ProfileStub();
        await using var application = factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IRampProfileStore>();
                services.AddSingleton<IRampProfileStore>(stub);
            }));
        using var client = application.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());
        var id = Guid.NewGuid();
        var input = new SaveRampProfileInput("Lucia", "Ramos", "RA-2", "Agente", new DateOnly(2025, 4, 1), false,
            [Guid.NewGuid()], ExpectedVersion: "AAAAAAAAB9E=");
        var key = Guid.NewGuid();
        async Task<HttpResponseMessage> SaveAsync()
        {
            using var request = new HttpRequestMessage(HttpMethod.Put, $"/api/v1/human-resources/ramp-profiles/{id:D}")
            {
                Content = JsonContent.Create(input),
            };
            request.Headers.Add("Idempotency-Key", key.ToString("D"));
            return await client.SendAsync(request, TestContext.Current.CancellationToken);
        }

        using (var saved = await SaveAsync())
        {
            Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
            var (actorId, profileId, received, receivedKey) = stub.Request!.Value;
            Assert.Equal((AccountId, id, key), (actorId, profileId!.Value, receivedKey!.Value));
            Assert.Equal("AAAAAAAAB9E=", received.ExpectedVersion);
            using var json = JsonDocument.Parse(await saved.Content.ReadAsStringAsync(
                TestContext.Current.CancellationToken));
            Assert.Equal("AAAAAAAAB9I=", json.RootElement.GetProperty("version").GetString());
        }
        foreach (var (failure, code, expected, status) in new (RampProfileFailure, string?, string, HttpStatusCode)[]
                 {
                     (RampProfileFailure.Conflict, "version_conflict", "version_conflict", HttpStatusCode.Conflict),
                     (RampProfileFailure.Conflict, "agent_has_operation_in_progress", "agent_has_operation_in_progress",
                         HttpStatusCode.Conflict),
                     (RampProfileFailure.Invalid, "supervisor_cycle", "supervisor_cycle", HttpStatusCode.BadRequest),
                     // A refusal the store did not name still carries the default code of its kind.
                     (RampProfileFailure.Invalid, null, "invalid_ramp_profile", HttpStatusCode.BadRequest),
                     (RampProfileFailure.NotFound, null, "not_found", HttpStatusCode.NotFound),
                     (RampProfileFailure.Conflict, null, "ramp_profile_conflict", HttpStatusCode.Conflict),
                 })
        {
            stub.Next = RampProfileResult.Failed(failure, code);
            using var refused = await SaveAsync();
            Assert.Equal(status, refused.StatusCode);
            using var problem = JsonDocument.Parse(await refused.Content.ReadAsStringAsync(
                TestContext.Current.CancellationToken));
            Assert.Equal(expected, problem.RootElement.GetProperty("code").GetString());
            // The title is Spanish and generic; the clients explain the code.
            Assert.DoesNotContain("ramp profile", problem.RootElement.GetProperty("title").GetString(),
                StringComparison.OrdinalIgnoreCase);
        }
        stub.Next = RampProfileResult.Failed(RampProfileFailure.Forbidden);
        using (var denied = await SaveAsync())
            Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);

        // An older screen without the header still saves, without a key (expand).
        stub.Next = null;
        using var keyless = await client.PutAsJsonAsync($"/api/v1/human-resources/ramp-profiles/{id:D}",
            input with { ExpectedVersion = null }, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, keyless.StatusCode);
        Assert.Null(stub.Request!.Value.Key);
        Assert.Null(stub.Request.Value.Input.ExpectedVersion);
    }

    [Fact]
    public async Task AnEmployeeUpdatePassesItsKeyAndEveryRefusalCarriesItsCode()
    {
        var calls = new List<object?[]>();
        var next = GovernanceResult.Success(Guid.NewGuid());
        var store = DispatchProxy.Create<IEmployeeGovernanceStore, AccessEndpointsTests.StoreProxy>();
        ((AccessEndpointsTests.StoreProxy)(object)store).Handler = (method, arguments) =>
        {
            if (method.Name != nameof(IEmployeeGovernanceStore.UpdateEmployeeAsync))
                throw new NotSupportedException(method.Name);
            calls.Add(arguments!);
            return Task.FromResult(next);
        };
        await using var application = factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IEmployeeGovernanceStore>();
                services.AddSingleton(store);
            }));
        using var client = application.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());
        var id = Guid.NewGuid();
        var input = new SaveEmployeeInput("Lucia", "Ramos", "CEDULA", "00100000011", "QA-RA-081", "operations",
            Guid.NewGuid(), [Guid.NewGuid()], new DateOnly(2025, 4, 1), ExpectedVersion: "AAAAAAAAB9E=");
        var key = Guid.NewGuid();
        async Task<HttpResponseMessage> UpdateAsync()
        {
            using var request = new HttpRequestMessage(HttpMethod.Put, $"/api/v1/human-resources/employees/{id:D}")
            {
                Content = JsonContent.Create(input),
            };
            request.Headers.Add("Idempotency-Key", key.ToString("D"));
            return await client.SendAsync(request, TestContext.Current.CancellationToken);
        }

        using (var updated = await UpdateAsync())
            Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        var arguments = Assert.Single(calls);
        Assert.Equal((AccountId, id, key), ((Guid)arguments[0]!, (Guid)arguments[1]!, (Guid)arguments[3]!));
        Assert.Equal("AAAAAAAAB9E=", ((SaveEmployeeInput)arguments[2]!).ExpectedVersion);
        // Moving to an office position can release the agent's work (2-N06): every refusal names its rule.
        foreach (var (failure, code, status) in new (GovernanceFailure, string, HttpStatusCode)[]
                 {
                     (GovernanceFailure.Invalid, "expected_version_required", HttpStatusCode.BadRequest),
                     (GovernanceFailure.NotFound, "not_found", HttpStatusCode.NotFound),
                     (GovernanceFailure.Conflict, "version_conflict", HttpStatusCode.Conflict),
                     (GovernanceFailure.Conflict, "idempotency_conflict", HttpStatusCode.Conflict),
                     (GovernanceFailure.Conflict, "agent_has_operation_in_progress", HttpStatusCode.Conflict),
                 })
        {
            next = GovernanceResult.Failed(failure, code);
            using var refused = await UpdateAsync();
            Assert.Equal(status, refused.StatusCode);
            using var problem = JsonDocument.Parse(await refused.Content.ReadAsStringAsync(
                TestContext.Current.CancellationToken));
            Assert.Equal(code, problem.RootElement.GetProperty("code").GetString());
            Assert.DoesNotContain("Governance record", problem.RootElement.GetProperty("title").GetString(),
                StringComparison.Ordinal);
        }

        // An older client without the header still saves, without a key (expand).
        next = GovernanceResult.Success(id);
        using var keyless = await client.PutAsJsonAsync($"/api/v1/human-resources/employees/{id:D}", input,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, keyless.StatusCode);
        Assert.Null(calls[^1][3]);
    }

    [Fact]
    public async Task TheProfileSaveAndTheEmployeeUpdatePublishTheKeyTheVersionAndTheirProblems()
    {
        using var client = factory.CreateClient();
        using var anonymous = await client.PutAsJsonAsync($"/api/v1/human-resources/employees/{Guid.NewGuid():D}",
            new { firstName = "Ana" }, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);

        using var swagger = await client.GetAsync("/swagger/v1/swagger.json", TestContext.Current.CancellationToken);
        swagger.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await swagger.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        var paths = json.RootElement.GetProperty("paths");
        foreach (var route in new[] { "/api/v1/human-resources/ramp-profiles/{id}", "/api/v1/human-resources/employees/{id}" })
        {
            var put = paths.GetProperty(route).GetProperty("put");
            Assert.Contains(put.GetProperty("parameters").EnumerateArray(), parameter =>
                parameter.GetProperty("name").GetString() == "Idempotency-Key" &&
                parameter.GetProperty("in").GetString() == "header");
            foreach (var status in new[] { "200", "400", "403", "404", "409" })
                Assert.True(put.GetProperty("responses").TryGetProperty(status, out _), $"{route} {status}");
        }
        var schemas = json.RootElement.GetProperty("components").GetProperty("schemas");
        Assert.True(schemas.GetProperty("SaveRampProfileInput").GetProperty("properties")
            .TryGetProperty("expectedVersion", out _));
        Assert.True(schemas.GetProperty("RampProfileData").GetProperty("properties").TryGetProperty("version", out _));
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

    private sealed class ProfileStub : IRampProfileStore
    {
        public RampProfileResult? Next { get; set; }
        public (Guid ActorId, Guid? ProfileId, SaveRampProfileInput Input, Guid? Key)? Request { get; private set; }

        public Task<RampProfileCatalog?> ListAsync(Guid actorId, CancellationToken cancellationToken = default) =>
            Task.FromResult<RampProfileCatalog?>(null);

        public Task<RampProfileResult> SaveAsync(Guid actorId, Guid? profileId, SaveRampProfileInput input,
            CancellationToken cancellationToken = default) =>
            SaveAsync(actorId, profileId, input, null, cancellationToken);

        public Task<RampProfileResult> SaveAsync(Guid actorId, Guid? profileId, SaveRampProfileInput input,
            Guid? idempotencyKey, CancellationToken cancellationToken = default)
        {
            Request = (actorId, profileId, input, idempotencyKey);
            return Task.FromResult(Next ?? RampProfileResult.Success(new RampProfileData(profileId ?? Guid.NewGuid(),
                input.FirstName, input.LastName, input.EmployeeNumber, input.Category, input.HireDate, input.IsActive,
                [], false, Version: "AAAAAAAAB9I=")));
        }
    }
}
