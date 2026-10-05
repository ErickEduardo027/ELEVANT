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

public sealed class ServiceClosuresEndpointsTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000001");
    private static readonly Guid RequestId = Guid.Parse("70000000-0000-7000-8000-000000000001");
    private static readonly Guid ServiceId = Guid.Parse("80000000-0000-7000-8000-000000000001");

    [Fact]
    public async Task ProtectsAndVersionsTheClosureWorkflow()
    {
        var store = new StubStore();
        await using var application = Application(store);
        using var anonymous = application.CreateClient();
        using var denied = await anonymous.GetAsync("/api/v1/service-closures",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, denied.StatusCode);
        using var client = Authorized(application);

        using var list = await client.GetAsync("/api/v1/service-closures?status=Pending&page=1&limit=25",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, list.StatusCode);
        Assert.Equal((AccountId, "Pending", 1, 25), store.LastList);
        Assert.Contains("no-store", list.Headers.CacheControl?.ToString());
        using var invalid = await client.GetAsync("/api/v1/service-closures?page=0",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        using var overflow = await client.GetAsync(
            "/api/v1/service-closures?page=2147483647&limit=100",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, overflow.StatusCode);

        using var created = await client.PostAsJsonAsync("/api/v1/service-closures",
            new { requestId = RequestId, serviceId = ServiceId,
                reason = "El equipo no está disponible." },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal((AccountId, RequestId, ServiceId, "El equipo no está disponible."),
            store.LastRequest);
        var longReason = new string('界', 1000);
        using var longRequest = await client.PostAsJsonAsync("/api/v1/service-closures",
            new { requestId = RequestId, serviceId = ServiceId, reason = longReason },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Created, longRequest.StatusCode);
        Assert.Equal(longReason, store.LastRequest.Item4);
        using var decision = await client.PostAsJsonAsync(
            $"/api/v1/service-closures/{RequestId}/decision",
            new { approve = false, reason = "Se reparará hoy.", version = "version-1" },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, decision.StatusCode);
        Assert.Equal((AccountId, RequestId, false, "Se reparará hoy.", "version-1"),
            store.LastDecision);
        using var reopen = await client.PostAsJsonAsync(
            $"/api/v1/service-closures/services/{ServiceId}/reopen",
            new { reason = "Equipo reparado.", serviceVersion = "service-version" },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, reopen.StatusCode);
        Assert.Equal((AccountId, ServiceId, "Equipo reparado.", "service-version"),
            store.LastReopen);
    }

    [Fact]
    public async Task MapsStoreFailuresWithoutExposingHistory()
    {
        var store = new StubStore { DenyList = true,
            CommandFailure = ServiceClosureFailure.Forbidden };
        await using var application = Application(store);
        using var client = Authorized(application);
        using var list = await client.GetAsync("/api/v1/service-closures",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, list.StatusCode);
        foreach (var (failure, expected) in new[]
        {
            (ServiceClosureFailure.Forbidden, HttpStatusCode.Forbidden),
            (ServiceClosureFailure.Invalid, HttpStatusCode.BadRequest),
            (ServiceClosureFailure.NotFound, HttpStatusCode.NotFound),
            (ServiceClosureFailure.Conflict, HttpStatusCode.Conflict),
        })
        {
            store.CommandFailure = failure;
            using var response = await client.PostAsJsonAsync("/api/v1/service-closures",
                new { requestId = RequestId, serviceId = ServiceId,
                    reason = "El equipo no está disponible." },
                TestContext.Current.CancellationToken);
            Assert.Equal(expected, response.StatusCode);
        }
    }

    [Fact]
    public async Task PublishesTheVersionedPrivateContract()
    {
        using var client = factory.CreateClient();
        using var response = await client.GetAsync("/swagger/v1/swagger.json",
            TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        var paths = document.RootElement.GetProperty("paths");
        Assert.Equal("ListServiceClosures", paths.GetProperty("/api/v1/service-closures")
            .GetProperty("get").GetProperty("operationId").GetString());
        Assert.Equal("DecideServiceClosure", paths.GetProperty(
            "/api/v1/service-closures/{id}/decision").GetProperty("post")
            .GetProperty("operationId").GetString());
        Assert.Equal("ReopenService", paths.GetProperty(
            "/api/v1/service-closures/services/{id}/reopen").GetProperty("post")
            .GetProperty("operationId").GetString());
    }

    private WebApplicationFactory<Program> Application(StubStore store) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IServiceClosureStore>();
            services.AddSingleton<IServiceClosureStore>(store);
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

    private sealed class StubStore : IServiceClosureStore
    {
        private readonly ServiceClosureData data = new(RequestId, ServiceId, "Aire acondicionado",
            "El equipo no está disponible.", "Pending", AccountId,
            new DateTimeOffset(2026, 10, 5, 10, 0, 0, TimeSpan.Zero), null, null, null,
            null, null, true, "service-version", "version-1");
        public bool DenyList { get; init; }
        public ServiceClosureFailure? CommandFailure { get; set; }
        public (Guid, string?, int, int) LastList { get; private set; }
        public (Guid, Guid, Guid, string) LastRequest { get; private set; }
        public (Guid, Guid, bool, string?, string) LastDecision { get; private set; }
        public (Guid, Guid, string, string) LastReopen { get; private set; }

        public Task<ServiceClosurePage?> ListAsync(Guid actorId, string? status,
            int page, int limit, CancellationToken cancellationToken = default)
        {
            LastList = (actorId, status, page, limit);
            return Task.FromResult<ServiceClosurePage?>(DenyList ? null :
                new ServiceClosurePage([data], false, 1, [ServiceId]));
        }

        public Task<ServiceClosureResult> RequestAsync(Guid actorId, Guid requestId,
            Guid serviceId, string reason, CancellationToken cancellationToken = default)
        {
            LastRequest = (actorId, requestId, serviceId, reason);
            return Task.FromResult(Result());
        }

        public Task<ServiceClosureResult> DecideAsync(Guid actorId, Guid requestId,
            bool approve, string? reason, string expectedVersion,
            CancellationToken cancellationToken = default)
        {
            LastDecision = (actorId, requestId, approve, reason, expectedVersion);
            return Task.FromResult(Result());
        }

        public Task<ServiceClosureResult> ReopenAsync(Guid actorId, Guid serviceId,
            string reason, string expectedServiceVersion,
            CancellationToken cancellationToken = default)
        {
            LastReopen = (actorId, serviceId, reason, expectedServiceVersion);
            return Task.FromResult(Result());
        }

        private ServiceClosureResult Result() => CommandFailure is { } failure
            ? ServiceClosureResult.Failed(failure) : ServiceClosureResult.Success(data);
    }
}
