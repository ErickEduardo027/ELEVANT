using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Identity;
using Elevant.Application.Integration;
using Elevant.Contracts.Integration;
using Elevant.Domain.Enumerations;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

public sealed class MobileDevicesEndpointsTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId =
        Guid.Parse("40000000-0000-7000-8000-000000000002");
    private static readonly Guid InstallationId =
        Guid.Parse("81000000-0000-7000-8000-000000000001");
    private static readonly Guid DeviceId =
        Guid.Parse("81000000-0000-7000-8000-000000000002");
    private static readonly DateTimeOffset LastSeenAt =
        new(2026, 9, 17, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task RegistrationRequiresBearerAuthenticationAndIsNeverCached()
    {
        await using var application = CreateApplication(new MobileState());
        using var client = application.CreateClient();

        using var response = await client.PutAsJsonAsync(
            "/api/v1/mobile/device",
            CreateRequest(),
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        AssertPrivateResponse(response);
        Assert.Equal("Bearer", response.Headers.WwwAuthenticate.Single().Scheme);
    }

    [Fact]
    public async Task RegistrationUsesAuthenticatedAccountAndReturnsCanonicalProjection()
    {
        var state = new MobileState
        {
            Actor = CreateActor(),
            WriteResult = MobileDeviceRegistrationWriteResult.Success(
                new MobileDeviceRegistrationData(
                    InstallationId,
                    "Android",
                    "1.2.3",
                    LastSeenAt),
                DeviceId),
        };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);

        using var response = await client.PutAsJsonAsync(
            "/api/v1/mobile/device",
            CreateRequest(),
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        AssertPrivateResponse(response);
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>(
            TestContext.Current.CancellationToken);
        Assert.Equal(InstallationId, payload.GetProperty("installationId").GetGuid());
        Assert.Equal("Android", payload.GetProperty("platform").GetString());
        Assert.Equal("1.2.3", payload.GetProperty("appVersion").GetString());
        Assert.Equal(LastSeenAt, payload.GetProperty("lastSeenAt").GetDateTimeOffset());
        Assert.Equal(4, payload.EnumerateObject().Count());
        Assert.NotNull(state.Request);
        Assert.Equal(AccountId, state.Request.ActorAccountId);
        Assert.Equal(InstallationId, state.Request.InstallationId);
    }

    [Theory]
    [InlineData(MobileDeviceRegistrationWriteFailure.Forbidden, HttpStatusCode.Forbidden)]
    [InlineData(MobileDeviceRegistrationWriteFailure.Conflict, HttpStatusCode.Conflict)]
    public async Task RegistrationMapsStoreFailuresToStableProblemDetails(
        MobileDeviceRegistrationWriteFailure failure,
        HttpStatusCode expectedStatus)
    {
        var state = new MobileState
        {
            Actor = CreateActor(),
            WriteResult = MobileDeviceRegistrationWriteResult.Failed(failure),
        };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);

        using var response = await client.PutAsJsonAsync(
            "/api/v1/mobile/device",
            CreateRequest(),
            TestContext.Current.CancellationToken);

        Assert.Equal(expectedStatus, response.StatusCode);
        AssertPrivateResponse(response);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>(
            TestContext.Current.CancellationToken);
        Assert.Equal((int)expectedStatus, problem.GetProperty("status").GetInt32());
        Assert.Equal("/api/v1/mobile/device", problem.GetProperty("instance").GetString());
    }

    [Fact]
    public async Task RegistrationRejectsUnknownMembersBeforeCallingStore()
    {
        var state = new MobileState
        {
            Actor = CreateActor(),
            WriteResult = MobileDeviceRegistrationWriteResult.Success(
                new MobileDeviceRegistrationData(
                    InstallationId,
                    "Android",
                    "1.2.3",
                    LastSeenAt),
                DeviceId),
        };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);

        using var response = await client.PutAsJsonAsync(
            "/api/v1/mobile/device",
            new
            {
                installationId = InstallationId,
                platform = "Android",
                appVersion = "1.2.3",
                accountId = Guid.NewGuid(),
            },
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Null(state.Request);
    }

    [Fact]
    public async Task OpenApiPublishesAuthenticatedIdempotentDeviceRegistration()
    {
        using var client = factory.CreateClient();

        using var response = await client.GetAsync(
            "/swagger/v1/swagger.json",
            TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        var document = await response.Content.ReadFromJsonAsync<JsonElement>(
            TestContext.Current.CancellationToken);

        var put = document
            .GetProperty("paths")
            .GetProperty("/api/v1/mobile/device")
            .GetProperty("put");
        Assert.Equal("RegisterMobileDevice", put.GetProperty("operationId").GetString());
        Assert.True(put.TryGetProperty("requestBody", out _));
        var responses = put.GetProperty("responses");
        foreach (var responseCode in new[]
                 {
                     "200", "400", "401", "403", "409", "413", "415", "429", "500",
                 })
        {
            Assert.True(responses.TryGetProperty(responseCode, out _), responseCode);
        }

        var security = Assert.Single(put.GetProperty("security").EnumerateArray());
        Assert.True(security.TryGetProperty("Bearer", out _));

        var requestSchema = document
            .GetProperty("components")
            .GetProperty("schemas")
            .GetProperty(nameof(RegisterMobileDeviceRequest))
            .GetProperty("properties");
        Assert.Equal(
            "^(Android|Ios)$",
            requestSchema.GetProperty("platform").GetProperty("pattern").GetString());
        Assert.Equal(32, requestSchema.GetProperty("appVersion").GetProperty("maxLength").GetInt32());
        Assert.Equal(120, requestSchema.GetProperty("deviceName").GetProperty("maxLength").GetInt32());
        Assert.Equal(
            64,
            requestSchema.GetProperty("operatingSystemVersion").GetProperty("maxLength").GetInt32());
    }

    private WebApplicationFactory<Program> CreateApplication(MobileState state) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<IActorContextResolver>();
            services.RemoveAll<IMobileDeviceCommandStore>();
            services.AddSingleton(state);
            services.AddScoped<IActorContextResolver>(_ => state);
            services.AddScoped<IMobileDeviceCommandStore>(_ => state);
        }));

    private static HttpClient CreateAuthenticatedClient(
        WebApplicationFactory<Program> application)
    {
        var client = application.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Bearer",
            CreateAccessToken());
        return client;
    }

    private static string CreateAccessToken()
    {
        var now = DateTimeOffset.UtcNow;
        var signingKey = new SymmetricSecurityKey(
            Convert.FromBase64String(ElevantApiFactory.AuthenticationSigningKeyBase64));
        return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Audience = ElevantApiFactory.AuthenticationAudience,
            Expires = now.AddMinutes(15).UtcDateTime,
            IssuedAt = now.UtcDateTime,
            Issuer = ElevantApiFactory.AuthenticationIssuer,
            NotBefore = now.AddSeconds(-5).UtcDateTime,
            SigningCredentials = new SigningCredentials(
                signingKey,
                SecurityAlgorithms.HmacSha256),
            Subject = new System.Security.Claims.ClaimsIdentity(
            [
                new System.Security.Claims.Claim(
                    JwtRegisteredClaimNames.Sub,
                    AccountId.ToString("D")),
                new System.Security.Claims.Claim(
                    JwtRegisteredClaimNames.Jti,
                    Guid.NewGuid().ToString("D")),
                new System.Security.Claims.Claim(
                    Elevant.Infrastructure.Authentication.SessionSecurityVersion.ClaimType,
                    Elevant.Infrastructure.Authentication.SessionSecurityVersion.Fingerprint(ElevantApiFactory.TestSecurityStamp)),
            ]),
            TokenType = "at+jwt",
        });
    }

    private static object CreateRequest() => new
    {
        installationId = InstallationId,
        platform = "Android",
        appVersion = "1.2.3",
        deviceName = "Ramp tablet",
        operatingSystemVersion = "Android 16",
    };

    private static ActorContext CreateActor() => new(
        AccountId,
        "ramp.agent@dev.elevant.test",
        "Riley Ramp",
        [
            new ActorRole(
                Guid.Parse("41000000-0000-7000-8000-000000000002"),
                "RAMP_AGENT",
                "Ramp Agent",
                PortalKind.RampMobileApp,
                "ramp_agent"),
        ],
        [
            new ActorMembership(
                Guid.Parse("42000000-0000-7000-8000-000000000002"),
                Guid.Parse("10000000-0000-7000-8000-000000000001"),
                "AVIAM",
                "AVIAM Development",
                OrganizationType.AviamOperator,
                MembershipKind.InternalStaff),
        ],
        [new ActorStationScope(
            Guid.Parse("20000000-0000-7000-8000-000000000003"),
            "PUJ")]);

    private static void AssertPrivateResponse(HttpResponseMessage response)
    {
        Assert.Contains(
            "no-store",
            response.Headers.CacheControl?.ToString(),
            StringComparison.Ordinal);
        Assert.Contains("no-cache", response.Headers.Pragma.Select(value => value.Name));
    }

    private sealed class MobileState : IActorContextResolver, IMobileDeviceCommandStore
    {
        public ActorContext? Actor { get; init; }

        public MobileDeviceRegistrationWriteResult WriteResult { get; init; } =
            MobileDeviceRegistrationWriteResult.Failed(
                MobileDeviceRegistrationWriteFailure.Conflict);

        public MobileDeviceRegistrationWriteRequest? Request { get; private set; }

        public Task<ActorContext?> ResolveAsync(
            Guid accountId,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(Actor);
        }

        public Task<MobileDeviceRegistrationWriteResult> RegisterAsync(
            MobileDeviceRegistrationWriteRequest request,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Request = request;
            return Task.FromResult(WriteResult);
        }
    }
}
