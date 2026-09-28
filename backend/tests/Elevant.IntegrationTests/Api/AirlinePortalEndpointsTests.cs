using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Commercial;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Authentication;
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
    public async Task ContractsRequireBearerAndRejectInvalidPaging()
    {
        await using var application = CreateApplication(CreateActor());
        using var anonymous = application.CreateClient();
        using var unauthorized = await anonymous.GetAsync(
            "/api/v1/airline/portal/contracts", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, unauthorized.StatusCode);
        Assert.Contains("no-store", unauthorized.Headers.CacheControl?.ToString(), StringComparison.Ordinal);

        using var client = CreateAuthenticatedClient(application);
        using var badPage = await client.GetAsync(
            "/api/v1/airline/portal/contracts?page=0", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, badPage.StatusCode);
        using var badLimit = await client.GetAsync(
            "/api/v1/airline/portal/contracts?limit=51", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, badLimit.StatusCode);
    }

    [Fact]
    public async Task OperationsRejectInvalidPagingInsteadOfReturningAnUnknownRoute()
    {
        await using var application = CreateApplication(CreateActor());
        using var client = CreateAuthenticatedClient(application);

        using var response = await client.GetAsync(
            "/api/v1/airline/portal/operations?page=0",
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task OperationalRequestsRequireAuthenticationAndBoundedPaging()
    {
        await using var application = CreateApplication(CreateActor());
        using var anonymous = application.CreateClient();
        using var unauthorized = await anonymous.GetAsync(
            "/api/v1/airline/portal/requests", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, unauthorized.StatusCode);

        using var client = CreateAuthenticatedClient(application);
        using var badPage = await client.GetAsync(
            "/api/v1/airline/portal/requests?page=0", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, badPage.StatusCode);
        using var badLimit = await client.GetAsync(
            "/api/v1/airline/portal/requests?limit=51", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, badLimit.StatusCode);
    }

    [Fact]
    public async Task ContractsUseLiveAirlineTenantAndOnlyApprovedVersions()
    {
        var state = new StubState(CreateActor())
        {
            Contracts = new AirlineContractPageData(
                [new AirlineContractData(Guid.NewGuid(), "DEV-CONTRACT-0001", "Expired",
                    new DateOnly(2026, 1, 1), null,
                    [new AirlineContractVersionData(Guid.NewGuid(), 1,
                        new DateOnly(2026, 1, 1), new DateOnly(2026, 8, 31), "USD",
                        [new AirlineContractStationData(StationId, "PUJ", "Punta Cana")],
                        [new AirlineContractRateData(Guid.NewGuid(), "BAG", "Baggage", "operation", 125.50m, 1m)])])],
                false),
        };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);

        using var response = await client.GetAsync(
            "/api/v1/airline/portal/contracts?page=1&limit=10", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString(), StringComparison.Ordinal);
        Assert.Equal(OrganizationId, state.QueriedOrganizationId);
        Assert.Equal(1, state.QueriedPage);
        Assert.Equal(10, state.QueriedLimit);
        await using var stream = await response.Content.ReadAsStreamAsync(TestContext.Current.CancellationToken);
        using var json = await JsonDocument.ParseAsync(stream, cancellationToken: TestContext.Current.CancellationToken);
        Assert.Equal("DEV-CONTRACT-0001", json.RootElement.GetProperty("contracts")[0].GetProperty("code").GetString());
        Assert.Equal(1, json.RootElement.GetProperty("contracts")[0].GetProperty("approvedVersions").GetArrayLength());
        Assert.Equal(125.50m, json.RootElement.GetProperty("contracts")[0]
            .GetProperty("approvedVersions")[0].GetProperty("rates")[0].GetProperty("unitPrice").GetDecimal());
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
    public async Task OperationsUseServerTenantAndReturnTheRequestedPage()
    {
        var operationId = Guid.NewGuid();
        var state = new StubState(CreateActor())
        {
            Operations = new AirlineOperationPageData(
                [new AirlinePortalOperationData(operationId, "DEV-TAT-0002", StationId,
                    "PUJ", new DateOnly(2026, 8, 19), "Approved", "ZZ102", "ZZ103",
                    null, null)], false),
        };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);

        using var response = await client.GetAsync(
            "/api/v1/airline/portal/operations?page=2&limit=1",
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString(), StringComparison.Ordinal);
        Assert.Equal(OrganizationId, state.QueriedOrganizationId);
        Assert.Equal(2, state.QueriedPage);
        Assert.Equal(1, state.QueriedLimit);
        await using var stream = await response.Content.ReadAsStreamAsync(TestContext.Current.CancellationToken);
        using var json = await JsonDocument.ParseAsync(stream, cancellationToken: TestContext.Current.CancellationToken);
        Assert.Equal(2, json.RootElement.GetProperty("page").GetInt32());
        Assert.Equal(operationId, json.RootElement.GetProperty("operations")[0].GetProperty("id").GetGuid());
        Assert.Equal("ZZ102", json.RootElement.GetProperty("operations")[0]
            .GetProperty("arrivalFlightNumber").GetString());
    }

    [Fact]
    public async Task HistoricalOperationDetailUsesServerTenantAndExactOperationId()
    {
        var operationId = Guid.NewGuid();
        var state = new StubState(CreateActor())
        {
            DetailOperation = new AirlinePortalOperationData(operationId, "DEV-TAT-0001",
                StationId, "PUJ", new DateOnly(2026, 8, 18), "Approved", "ZZ100",
                "ZZ101", null, null),
        };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);

        using var response = await client.GetAsync(
            $"/api/v1/airline/portal/operations/{operationId:D}",
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString(), StringComparison.Ordinal);
        Assert.Equal(OrganizationId, state.QueriedOrganizationId);
        Assert.Equal(operationId, state.QueriedOperationId);
        await using var stream = await response.Content.ReadAsStreamAsync(TestContext.Current.CancellationToken);
        using var json = await JsonDocument.ParseAsync(stream,
            cancellationToken: TestContext.Current.CancellationToken);
        Assert.Equal("DEV-TAT-0001", json.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task OperationalRequestsUseServerTenantAndReturnOnlyItsPage()
    {
        var requestId = Guid.NewGuid();
        var state = new StubState(CreateActor())
        {
            Requests = new AirlineOperationalRequestPageData(
                [new AirlineOperationalRequestData(requestId, StationId, "PUJ",
                    "Escalera adicional", "Solicitud para desembarque posterior.",
                    "Submitted", new DateTimeOffset(2026, 8, 19, 12, 0, 0, TimeSpan.Zero),
                    null, null, null, null)], false),
        };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);

        using var response = await client.GetAsync(
            "/api/v1/airline/portal/requests?page=1&limit=1",
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(OrganizationId, state.QueriedOrganizationId);
        Assert.Equal(requestId, JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken)).RootElement
            .GetProperty("requests")[0].GetProperty("id").GetGuid());
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

        using var contractResponse = await client.GetAsync(
            "/api/v1/airline/portal/contracts", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, contractResponse.StatusCode);
        Assert.Null(state.QueriedOrganizationId);

        using var operationsResponse = await client.GetAsync(
            "/api/v1/airline/portal/operations", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, operationsResponse.StatusCode);
        Assert.Null(state.QueriedOrganizationId);

        using var detailResponse = await client.GetAsync(
            $"/api/v1/airline/portal/operations/{Guid.NewGuid():D}",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, detailResponse.StatusCode);
        Assert.Null(state.QueriedOrganizationId);

        using var requestResponse = await client.GetAsync(
            "/api/v1/airline/portal/requests", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, requestResponse.StatusCode);
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
                new System.Security.Claims.Claim(
                    SessionSecurityVersion.ClaimType,
                    SessionSecurityVersion.Fingerprint(ElevantApiFactory.TestSecurityStamp)),
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

        public AirlineContractPageData? Contracts { get; init; }

        public AirlineOperationPageData? Operations { get; init; }

        public AirlinePortalOperationData? DetailOperation { get; init; }

        public AirlineOperationalRequestPageData? Requests { get; init; }

        public Guid? QueriedOperationId { get; private set; }

        public Guid? QueriedOrganizationId { get; private set; }

        public int? QueriedPage { get; private set; }

        public int? QueriedLimit { get; private set; }

        public Task<ActorContext?> ResolveAsync(Guid accountId, CancellationToken cancellationToken = default) =>
            Task.FromResult<ActorContext?>(actor);

        public Task<AirlinePortalBootstrapData?> GetBootstrapAsync(
            Guid organizationId, DateOnly onDate, CancellationToken cancellationToken = default)
        {
            QueriedOrganizationId = organizationId;
            return Task.FromResult(Bootstrap);
        }

        public Task<AirlineContractPageData?> GetContractsAsync(
            Guid organizationId, int page, int limit, CancellationToken cancellationToken = default)
        {
            QueriedOrganizationId = organizationId;
            QueriedPage = page;
            QueriedLimit = limit;
            return Task.FromResult(Contracts);
        }

        public Task<AirlineOperationPageData?> GetOperationsAsync(
            Guid organizationId, int page, int limit, CancellationToken cancellationToken = default)
        {
            QueriedOrganizationId = organizationId;
            QueriedPage = page;
            QueriedLimit = limit;
            return Task.FromResult(Operations);
        }

        public Task<AirlinePortalOperationData?> GetOperationAsync(
            Guid organizationId, Guid operationId, CancellationToken cancellationToken = default)
        {
            QueriedOrganizationId = organizationId;
            QueriedOperationId = operationId;
            return Task.FromResult(DetailOperation);
        }

        public Task<AirlineOperationalRequestPageData?> GetRequestsAsync(
            Guid organizationId, int page, int limit,
            CancellationToken cancellationToken = default)
        {
            QueriedOrganizationId = organizationId;
            QueriedPage = page;
            QueriedLimit = limit;
            return Task.FromResult(Requests);
        }
    }
}
