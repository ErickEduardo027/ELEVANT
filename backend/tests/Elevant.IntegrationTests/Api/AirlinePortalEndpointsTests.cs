using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Commercial;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

public sealed class AirlinePortalEndpointsTests(ElevantApiFactory factory) : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000003");
    private static readonly Guid OrganizationId = Guid.Parse("10000000-0000-7000-8000-000000000002");
    private static readonly Guid AirlineId = Guid.Parse("20000000-0000-7000-8000-000000000001");
    private static readonly Guid StationId = Guid.Parse("20000000-0000-7000-8000-000000000003");

    [Fact]
    public async Task BootstrapRequiresBearerAndCannotBeCached()
    {
        await using var application = CreateApplication(CreateActor());
        using var client = application.CreateClient();

        using var response = await client.GetAsync(
            "/api/v1/airline/portal/bootstrap", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString(), StringComparison.Ordinal);
        Assert.Equal("Bearer", response.Headers.WwwAuthenticate.Single().Scheme);
    }

    [Fact]
    public async Task BootstrapUsesServerTenantAndReturnsContractStationOnly()
    {
        var state = new StubState(CreateActor())
        {
            Bootstrap = new AirlinePortalBootstrapData(
                AirlineId, OrganizationId, "ZZ", "DVA", "Demo Airlines",
                [new AirlinePortalStationData(StationId, "PUJ", "Punta Cana", "America/Santo_Domingo")],
                [new AirlinePortalOperationData(
                    Guid.NewGuid(), "DEV-TAT-0003", StationId, "PUJ", new DateOnly(2026, 9, 25),
                    "Assigned", "ZZ104", "ZZ105", null, null)]),
        };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);

        using var response = await client.GetAsync(
            "/api/v1/airline/portal/bootstrap", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString(), StringComparison.Ordinal);
        Assert.Equal(OrganizationId, state.QueriedOrganizationId);
        await using var stream = await response.Content.ReadAsStreamAsync(TestContext.Current.CancellationToken);
        using var json = await JsonDocument.ParseAsync(stream, cancellationToken: TestContext.Current.CancellationToken);
        var root = json.RootElement;
        Assert.Equal(AirlineId, root.GetProperty("airlineId").GetGuid());
        Assert.Equal("PUJ", root.GetProperty("stations")[0].GetProperty("code").GetString());
        Assert.Equal(1, root.GetProperty("stations").GetArrayLength());
        Assert.Equal("DEV-TAT-0003", root.GetProperty("currentOperations")[0].GetProperty("code").GetString());
        Assert.Equal("PUJ", root.GetProperty("currentOperations")[0].GetProperty("stationCode").GetString());
        Assert.False(root.TryGetProperty("password", out _));
    }

    [Fact]
    public async Task OccRoleCannotQueryAirlineStore()
    {
        var actor = CreateActor() with
        {
            Roles = [new ActorRole(Guid.NewGuid(), "ADMIN_OCC", "OCC", PortalKind.BackOffice, "admin_occ")],
        };
        var state = new StubState(actor);
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);

        using var response = await client.GetAsync(
            "/api/v1/airline/portal/bootstrap", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Null(state.QueriedOrganizationId);
    }

    private WebApplicationFactory<Program> CreateApplication(ActorContext actor) =>
        CreateApplication(new StubState(actor));

    private WebApplicationFactory<Program> CreateApplication(StubState state) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<IActorContextResolver>();
            services.RemoveAll<IAirlinePortalReadStore>();
            services.AddScoped<IActorContextResolver>(_ => state);
            services.AddScoped<IAirlinePortalReadStore>(_ => state);
        }));

    private static HttpClient CreateAuthenticatedClient(WebApplicationFactory<Program> application)
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
            SigningCredentials = new SigningCredentials(
                new SymmetricSecurityKey(Convert.FromBase64String(ElevantApiFactory.AuthenticationSigningKeyBase64)),
                SecurityAlgorithms.HmacSha256),
            Subject = new System.Security.Claims.ClaimsIdentity(
            [
                new System.Security.Claims.Claim(JwtRegisteredClaimNames.Sub, AccountId.ToString("D")),
                new System.Security.Claims.Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("D")),
            ]),
            TokenType = "at+jwt",
        });
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static ActorContext CreateActor() => new(
        AccountId, "airline.client@dev.elevant.test", "Airline Client",
        [new ActorRole(Guid.NewGuid(), "AIRLINE_CLIENT", "Airline Client", PortalKind.AirlinePortal, "airline_client")],
        [new ActorMembership(Guid.NewGuid(), OrganizationId, "DEMO-AIR", "Demo Airlines",
            OrganizationType.AirlineCustomer, MembershipKind.AirlineClient)],
        []);

    private sealed class StubState(ActorContext actor) : IActorContextResolver, IAirlinePortalReadStore
    {
        public AirlinePortalBootstrapData? Bootstrap { get; init; }

        public Guid? QueriedOrganizationId { get; private set; }

        public Task<ActorContext?> ResolveAsync(Guid accountId, CancellationToken cancellationToken = default) =>
            Task.FromResult<ActorContext?>(actor);

        public Task<AirlinePortalBootstrapData?> GetBootstrapAsync(
            Guid organizationId, DateOnly onDate, CancellationToken cancellationToken = default)
        {
            QueriedOrganizationId = organizationId;
            return Task.FromResult(Bootstrap);
        }
    }
}
