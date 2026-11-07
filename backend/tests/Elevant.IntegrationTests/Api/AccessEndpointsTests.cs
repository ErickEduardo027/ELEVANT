using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Reflection;
using System.Text.Json;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Identity;
using Elevant.Application.Integration;
using Elevant.Domain.Enumerations;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

/// <summary>
/// Phase 2, block E over HTTP: shared tablets (2-N02), the airline's portal users (2-N20), the retired legacy
/// governance writes (2-N38) and the governance commands that always answer a code and take an optional
/// Idempotency-Key (2-N39).
/// </summary>
public sealed class AccessEndpointsTests(ElevantApiFactory factory) : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000007");
    private static readonly Guid TargetId = Guid.Parse("70000000-0000-7000-8000-0000000000f1");
    private static readonly Guid StationId = Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly Guid InstallationId = Guid.Parse("81000000-0000-7000-8000-0000000000f1");

    [Theory]
    [InlineData(MobileDeviceRegistrationWriteFailure.Forbidden, "device_revoked", HttpStatusCode.Forbidden, "device_revoked")]
    [InlineData(MobileDeviceRegistrationWriteFailure.Forbidden, null, HttpStatusCode.Forbidden, "forbidden")]
    [InlineData(MobileDeviceRegistrationWriteFailure.Conflict, "device_in_use_by_active_agent", HttpStatusCode.Conflict,
        "device_in_use_by_active_agent")]
    [InlineData(MobileDeviceRegistrationWriteFailure.Conflict, null, HttpStatusCode.Conflict, "device_conflict")]
    public async Task TabletRegistrationRefusalsCarryTheirCode(MobileDeviceRegistrationWriteFailure failure, string? code,
        HttpStatusCode status, string expected)
    {
        var devices = new DeviceStub { Registration = MobileDeviceRegistrationWriteResult.Failed(failure, code) };
        await using var application = WithServices(services =>
        {
            services.RemoveAll<IActorContextResolver>();
            services.RemoveAll<IMobileDeviceCommandStore>();
            services.AddScoped<IActorContextResolver>(_ => new RampActor());
            services.AddSingleton<IMobileDeviceCommandStore>(devices);
        });
        using var client = Authorized(application);
        using var response = await client.PutAsJsonAsync("/api/v1/mobile/device",
            new { installationId = InstallationId, platform = "Android", appVersion = "1.2.3" },
            TestContext.Current.CancellationToken);
        Assert.Equal(status, response.StatusCode);
        Assert.Equal(expected, await CodeAsync(response));
    }

    [Fact]
    public async Task TheTabletReleasesItsBindingWithAnIdempotencyKey()
    {
        var devices = new DeviceStub();
        await using var application = WithServices(services =>
        {
            services.RemoveAll<IMobileDeviceCommandStore>();
            services.AddSingleton<IMobileDeviceCommandStore>(devices);
        });
        using var client = Authorized(application);
        var ct = TestContext.Current.CancellationToken;

        // A new command: without its key it never reaches the store.
        using var keyless = await client.PostAsJsonAsync("/api/v1/mobile/device/release",
            new { installationId = InstallationId }, ct);
        Assert.Equal(HttpStatusCode.BadRequest, keyless.StatusCode);
        Assert.Null(devices.Release);

        var key = Guid.NewGuid();
        using var released = await client.SendAsync(Keyed(HttpMethod.Post, "/api/v1/mobile/device/release",
            new { installationId = InstallationId }, key), ct);
        Assert.Equal(HttpStatusCode.NoContent, released.StatusCode);
        Assert.Equal(new MobileDeviceReleaseWriteRequest(AccountId, InstallationId, key), devices.Release);

        devices.ReleaseResult = MobileDeviceReleaseWriteResult.Failed(MobileDeviceReleaseWriteFailure.Conflict,
            MobileDeviceCodes.NotBound);
        using var notBound = await client.SendAsync(Keyed(HttpMethod.Post, "/api/v1/mobile/device/release",
            new { installationId = InstallationId }, Guid.NewGuid()), ct);
        Assert.Equal(HttpStatusCode.Conflict, notBound.StatusCode);
        Assert.Equal("device_not_bound", await CodeAsync(notBound));
    }

    [Fact]
    public async Task OccTabletCommandsNeedTheirKeyAndAnswerCodes()
    {
        var store = new OccDevicesStub();
        await using var application = WithServices(services =>
        {
            services.RemoveAll<IMobileDeviceAdministrationStore>();
            services.AddSingleton<IMobileDeviceAdministrationStore>(store);
        });
        using var client = Authorized(application);
        var ct = TestContext.Current.CancellationToken;

        using var forbidden = await client.GetAsync($"/api/v1/occ/devices?stationId={StationId}", ct);
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);
        Assert.Equal("forbidden", await CodeAsync(forbidden));
        Assert.Equal((AccountId, StationId), store.Listed);

        using var keyless = await client.PostAsJsonAsync($"/api/v1/occ/devices/{TargetId}/unbinding",
            new { expectedVersion = "YjEuMS4w" }, ct);
        Assert.Equal(HttpStatusCode.BadRequest, keyless.StatusCode);
        Assert.Null(store.Command);

        var key = Guid.NewGuid();
        using var unbound = await client.SendAsync(Keyed(HttpMethod.Post, $"/api/v1/occ/devices/{TargetId}/unbinding",
            new { expectedVersion = "YjEuMS4w", reason = "Turno terminado" }, key), ct);
        Assert.Equal(HttpStatusCode.OK, unbound.StatusCode);
        Assert.Equal(("unbind", TargetId, key, (object)new UnbindMobileDeviceInput("YjEuMS4w", "Turno terminado")),
            store.Command);

        store.Failure = (MobileDeviceAdministrationFailure.Conflict, "device_revoked");
        using var revoked = await client.SendAsync(Keyed(HttpMethod.Post, $"/api/v1/occ/devices/{TargetId}/revocation",
            new { expectedVersion = "YjEuMC4x", reason = "Tablet extraviada" }, Guid.NewGuid()), ct);
        Assert.Equal(HttpStatusCode.Conflict, revoked.StatusCode);
        Assert.Equal("device_revoked", await CodeAsync(revoked));
        Assert.Equal("revoke", store.Command!.Value.Command);
    }

    [Theory]
    [InlineData("POST", "/api/v1/governance/roles")]
    [InlineData("PUT", "/api/v1/governance/roles/70000000-0000-7000-8000-0000000000f1")]
    [InlineData("POST", "/api/v1/governance/users")]
    [InlineData("PUT", "/api/v1/governance/users/70000000-0000-7000-8000-0000000000f1")]
    public async Task TheLegacyGovernanceWritesAreGone(string method, string path)
    {
        var legacy = DispatchProxy.Create<IGovernanceStore, StoreProxy>();
        ((StoreProxy)(object)legacy).Handler = (called, _) => throw new InvalidOperationException(called.Name);
        await using var application = WithServices(services =>
        {
            services.RemoveAll<IGovernanceStore>();
            services.AddSingleton(legacy);
        });
        using var client = Authorized(application);
        using var request = new HttpRequestMessage(new HttpMethod(method), path)
        {
            Content = JsonContent.Create(new { name = "Rol", firstName = "Ana", lastName = "Ruiz", email = "ana@x.test" }),
        };
        using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Gone, response.StatusCode);
        Assert.Equal("legacy_governance_retired", await CodeAsync(response));
    }

    [Theory]
    [InlineData(GovernanceFailure.Forbidden, HttpStatusCode.Forbidden, "forbidden")]
    [InlineData(GovernanceFailure.Protected, HttpStatusCode.Conflict, "protected_user")]
    [InlineData(GovernanceFailure.NotFound, HttpStatusCode.NotFound, "not_found")]
    public async Task TheLegacyGovernanceCommandsLeftAnswerACode(GovernanceFailure failure, HttpStatusCode status,
        string expected)
    {
        var legacy = DispatchProxy.Create<IGovernanceStore, StoreProxy>();
        ((StoreProxy)(object)legacy).Handler = (called, _) => called.Name == nameof(IGovernanceStore.DeleteUserAsync)
            ? Task.FromResult(GovernanceResult.Failed(failure))
            : throw new NotSupportedException(called.Name);
        await using var application = WithServices(services =>
        {
            services.RemoveAll<IGovernanceStore>();
            services.AddSingleton(legacy);
        });
        using var client = Authorized(application);
        using var response = await client.DeleteAsync($"/api/v1/governance/users/{TargetId}",
            TestContext.Current.CancellationToken);
        Assert.Equal(status, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal(expected, await CodeAsync(response));
        Assert.DoesNotContain("Governance record", await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken), StringComparison.Ordinal);
    }

    public static TheoryData<GovernanceFailure, string?, HttpStatusCode, string> GovernanceFailures => new()
    {
        { GovernanceFailure.Forbidden, null, HttpStatusCode.Forbidden, "forbidden" },
        { GovernanceFailure.NotFound, null, HttpStatusCode.NotFound, "not_found" },
        { GovernanceFailure.Invalid, null, HttpStatusCode.BadRequest, "invalid_governance_data" },
        { GovernanceFailure.Conflict, null, HttpStatusCode.Conflict, "governance_conflict" },
        { GovernanceFailure.Protected, null, HttpStatusCode.Conflict, "protected_user" },
        { GovernanceFailure.Conflict, "employee_transferred", HttpStatusCode.Conflict, "employee_transferred" },
        { GovernanceFailure.Invalid, "stations_outside_employee", HttpStatusCode.BadRequest, "stations_outside_employee" },
    };

    [Theory]
    [MemberData(nameof(GovernanceFailures))]
    public async Task GovernanceCommandsAlwaysAnswerACodeAndPassTheirKey(GovernanceFailure failure, string? code,
        HttpStatusCode status, string expected)
    {
        var calls = new List<object?[]>();
        var store = DispatchProxy.Create<IDepartmentGovernanceStore, StoreProxy>();
        ((StoreProxy)(object)store).Handler = (method, arguments) =>
        {
            if (method.Name != nameof(IDepartmentGovernanceStore.SetUserStatusAsync))
                throw new NotSupportedException(method.Name);
            calls.Add(arguments!);
            return Task.FromResult(GovernanceResult.Failed(failure, code));
        };
        await using var application = WithServices(services =>
        {
            services.RemoveAll<IDepartmentGovernanceStore>();
            services.AddSingleton(store);
        });
        using var client = Authorized(application);
        var key = Guid.NewGuid();
        using var response = await client.SendAsync(Keyed(HttpMethod.Post,
            $"/api/v1/governance/departments/finance/users/{TargetId}/status",
            new { isActive = true, expectedVersion = "AAAAAAAAB9E=" }, key), TestContext.Current.CancellationToken);
        Assert.Equal(status, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal(expected, await CodeAsync(response));
        Assert.Equal(key, calls[^1][4]);
    }

    [Fact]
    public async Task ThePortalRoleOfAClientUserNeedsItsKey()
    {
        var calls = new List<object?[]>();
        var store = DispatchProxy.Create<IDepartmentGovernanceStore, StoreProxy>();
        ((StoreProxy)(object)store).Handler = (method, arguments) =>
        {
            if (method.Name != nameof(IDepartmentGovernanceStore.SetClientUserPortalRoleAsync))
                throw new NotSupportedException(method.Name);
            calls.Add(arguments!);
            return Task.FromResult(GovernanceResult.Failed(GovernanceFailure.Conflict, "last_representative"));
        };
        await using var application = WithServices(services =>
        {
            services.RemoveAll<IDepartmentGovernanceStore>();
            services.AddSingleton(store);
        });
        using var client = Authorized(application);
        var ct = TestContext.Current.CancellationToken;
        var path = $"/api/v1/governance/clients/{StationId}/users/{TargetId}/portal-role";
        var body = new { representative = false, signer = true, expectedVersion = "AAAAAAAAB9E=" };
        using var keyless = await client.PostAsJsonAsync(path, body, ct);
        Assert.Equal(HttpStatusCode.BadRequest, keyless.StatusCode);
        Assert.Empty(calls);
        using var refused = await client.SendAsync(Keyed(HttpMethod.Post, path, body, Guid.NewGuid()), ct);
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Equal("last_representative", await CodeAsync(refused));
        Assert.Equal(new SetClientUserPortalRoleInput(false, true, "AAAAAAAAB9E="), calls[^1][3]);
    }

    [Fact]
    public async Task ThePortalUsersAnswerTheirCodesAndAReplayIsNotACreation()
    {
        var store = new PortalUsersStub();
        await using var application = WithServices(services =>
        {
            services.RemoveAll<IAirlinePortalUserStore>();
            services.AddSingleton<IAirlinePortalUserStore>(store);
        });
        using var client = Authorized(application);
        var ct = TestContext.Current.CancellationToken;

        using var unknown = await client.GetAsync("/api/v1/airline/portal/users", ct);
        Assert.Equal(HttpStatusCode.Forbidden, unknown.StatusCode);
        Assert.Equal("forbidden", await CodeAsync(unknown));

        var invite = new { firstName = "Luis", lastName = "Linares", email = "luis@demo-air.test", signer = true };
        using var keyless = await client.PostAsJsonAsync("/api/v1/airline/portal/users", invite, ct);
        Assert.Equal(HttpStatusCode.BadRequest, keyless.StatusCode);

        store.Result = AirlinePortalUserResult.Failed(AirlinePortalUserFailure.Forbidden, "representative_required");
        using var notRepresentative = await client.SendAsync(Keyed(HttpMethod.Post, "/api/v1/airline/portal/users",
            invite, Guid.NewGuid()), ct);
        Assert.Equal(HttpStatusCode.Forbidden, notRepresentative.StatusCode);
        Assert.Equal("representative_required", await CodeAsync(notRepresentative));

        var user = new AirlinePortalUserData(TargetId, "Luis", "Linares", "luis@demo-air.test", "Active", true, false, true,
            null, "AAAAAAAAB9E=");
        store.Result = AirlinePortalUserResult.Success(user);
        using var created = await client.SendAsync(Keyed(HttpMethod.Post, "/api/v1/airline/portal/users", invite,
            Guid.NewGuid()), ct);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal(new InviteAirlinePortalUserInput("Luis", "Linares", "luis@demo-air.test", true), store.Invite);
        store.Result = AirlinePortalUserResult.Success(user, replayed: true);
        using var replayed = await client.SendAsync(Keyed(HttpMethod.Post, "/api/v1/airline/portal/users", invite,
            Guid.NewGuid()), ct);
        Assert.Equal(HttpStatusCode.OK, replayed.StatusCode);

        store.Result = AirlinePortalUserResult.Failed(AirlinePortalUserFailure.Conflict, "portal_user_protected");
        using var protectedUser = await client.SendAsync(Keyed(HttpMethod.Post, $"/api/v1/airline/portal/users/{TargetId}/signer",
            new { signer = false, expectedVersion = "AAAAAAAAB9E=" }, Guid.NewGuid()), ct);
        Assert.Equal(HttpStatusCode.Conflict, protectedUser.StatusCode);
        Assert.Equal("portal_user_protected", await CodeAsync(protectedUser));
    }

    private static HttpRequestMessage Keyed(HttpMethod method, string path, object body, Guid key)
    {
        var request = new HttpRequestMessage(method, path) { Content = JsonContent.Create(body) };
        request.Headers.Add("Idempotency-Key", key.ToString());
        return request;
    }

    /// <summary>Stands in for a large store: only the method under test answers.</summary>
    public class StoreProxy : DispatchProxy
    {
        public Func<MethodInfo, object?[]?, object?> Handler { get; set; } = (_, _) => throw new NotSupportedException();

        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args) => Handler(targetMethod!, args);
    }

    private sealed class RampActor : IActorContextResolver
    {
        public Task<ActorContext?> ResolveAsync(Guid accountId, CancellationToken cancellationToken = default) =>
            Task.FromResult<ActorContext?>(new ActorContext(accountId, "ramp.agent@dev.elevant.test", "Riley Ramp",
                [new ActorRole(Guid.Parse("41000000-0000-7000-8000-000000000002"), "RAMP_AGENT", "Ramp Agent",
                    PortalKind.RampMobileApp, "ramp_agent")],
                [new ActorMembership(Guid.Parse("42000000-0000-7000-8000-000000000002"),
                    Guid.Parse("10000000-0000-7000-8000-000000000001"), "AVIAM", "AVIAM Development",
                    OrganizationType.AviamOperator, MembershipKind.InternalStaff)],
                [new ActorStationScope(StationId, "PUJ")]));
    }

    private sealed class DeviceStub : IMobileDeviceCommandStore
    {
        public MobileDeviceRegistrationWriteResult Registration { get; init; } =
            MobileDeviceRegistrationWriteResult.Failed(MobileDeviceRegistrationWriteFailure.Conflict);

        public MobileDeviceReleaseWriteResult ReleaseResult { get; set; } = MobileDeviceReleaseWriteResult.Released();

        public MobileDeviceReleaseWriteRequest? Release { get; private set; }

        public Task<MobileDeviceRegistrationWriteResult> RegisterAsync(MobileDeviceRegistrationWriteRequest request,
            CancellationToken cancellationToken = default) => Task.FromResult(Registration);

        public Task<MobileDeviceReleaseWriteResult> ReleaseAsync(MobileDeviceReleaseWriteRequest request,
            CancellationToken cancellationToken = default)
        {
            Release = request;
            return Task.FromResult(ReleaseResult);
        }
    }

    private sealed class OccDevicesStub : IMobileDeviceAdministrationStore
    {
        public (Guid ActorId, Guid StationId)? Listed { get; private set; }

        public (string Command, Guid DeviceId, Guid Key, object Input)? Command { get; private set; }

        public (MobileDeviceAdministrationFailure Failure, string Code)? Failure { get; set; }

        private static readonly OccMobileDeviceData Device = new(TargetId, "Android", "Tablet T-07", "1.2.3", "Android 16",
            DateTimeOffset.UnixEpoch, "Unbound", null, null, null, null, false, "YjEuMC4w");

        public Task<MobileDeviceAdministrationResult<OccMobileDevicesData>> ListAsync(Guid actorId, Guid stationId,
            CancellationToken cancellationToken = default)
        {
            Listed = (actorId, stationId);
            return Task.FromResult(MobileDeviceAdministrationResult.Failed<OccMobileDevicesData>(
                MobileDeviceAdministrationFailure.Forbidden, "forbidden"));
        }

        public Task<MobileDeviceAdministrationResult<OccMobileDeviceData>> UnbindAsync(Guid actorId, Guid deviceId,
            UnbindMobileDeviceInput input, Guid idempotencyKey, CancellationToken cancellationToken = default) =>
            Answer("unbind", deviceId, idempotencyKey, input);

        public Task<MobileDeviceAdministrationResult<OccMobileDeviceData>> RevokeAsync(Guid actorId, Guid deviceId,
            RevokeMobileDeviceInput input, Guid idempotencyKey, CancellationToken cancellationToken = default) =>
            Answer("revoke", deviceId, idempotencyKey, input);

        private Task<MobileDeviceAdministrationResult<OccMobileDeviceData>> Answer(string command, Guid deviceId, Guid key,
            object input)
        {
            Command = (command, deviceId, key, input);
            return Task.FromResult(Failure is { } refused
                ? MobileDeviceAdministrationResult.Failed<OccMobileDeviceData>(refused.Failure, refused.Code)
                : MobileDeviceAdministrationResult.Success<OccMobileDeviceData>(Device));
        }
    }

    private sealed class PortalUsersStub : IAirlinePortalUserStore
    {
        public AirlinePortalUserResult Result { get; set; } =
            AirlinePortalUserResult.Failed(AirlinePortalUserFailure.Forbidden, "forbidden");

        public InviteAirlinePortalUserInput? Invite { get; private set; }

        public Task<AirlinePortalUsersData?> ListAsync(Guid actorId, CancellationToken cancellationToken = default) =>
            Task.FromResult<AirlinePortalUsersData?>(null);

        public Task<AirlinePortalUserResult> InviteAsync(Guid actorId, InviteAirlinePortalUserInput input,
            Guid idempotencyKey, CancellationToken cancellationToken = default)
        {
            Invite = input;
            return Task.FromResult(Result);
        }

        public Task<AirlinePortalUserResult> SetStatusAsync(Guid actorId, Guid userId, SetAirlinePortalUserStatusInput input,
            Guid idempotencyKey, CancellationToken cancellationToken = default) => Task.FromResult(Result);

        public Task<AirlinePortalUserResult> SetSignerAsync(Guid actorId, Guid userId, SetAirlinePortalUserSignerInput input,
            Guid idempotencyKey, CancellationToken cancellationToken = default) => Task.FromResult(Result);
    }

    private WebApplicationFactory<Program> WithServices(Action<IServiceCollection> configure) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(configure));

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
}
