using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Finance;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

public sealed class FinanceApprovedServicesEndpointsTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000006");
    private static readonly Guid StationId = Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly DateOnly Date = new(2026, 8, 19);

    [Fact]
    public async Task RequiresAuthenticationAndRequiredScopeParameters()
    {
        await using var application = CreateApplication(new Stub());
        using var client = application.CreateClient();
        using var anonymous = await client.GetAsync(Path(), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());
        using var missing = await client.GetAsync("/api/v1/finance/approved-services",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        Assert.Contains("no-store", missing.Headers.CacheControl?.ToString());
    }

    [Fact]
    public async Task FinanceReceivesOnlyCanonicalEvidenceInCamelCase()
    {
        var serviceId = Guid.NewGuid();
        var stub = new Stub
        {
            Actor = Actor(),
            Data = new FinanceApprovedServicesData(StationId, Date, Date,
                [new FinanceApprovedServiceData(serviceId, Guid.NewGuid(), Guid.NewGuid(),
                    Guid.NewGuid(), "DEV-TAT-0002", Date, Guid.NewGuid(), "Demo Airlines", "ZZ102",
                    "DEV-CTR", "GPU", "Ground power", "Completed", 1, 2,
                    "hour", 40, "USD", true, null, 80, null)], false),
        };
        await using var application = CreateApplication(stub);
        using var client = application.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());

        using var response = await client.GetAsync(Path(), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString());
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        Assert.Equal(serviceId, json.RootElement.GetProperty("services")[0].GetProperty("id").GetGuid());
        Assert.Equal(80m, json.RootElement.GetProperty("services")[0].GetProperty("amount").GetDecimal());
        Assert.Equal((AccountId, StationId, Date, Date), stub.Request);
    }

    [Fact]
    public async Task WrongRoleAndStationDoNotReadStore()
    {
        var stub = new Stub { Actor = Actor() with { Roles = [Actor().Roles[0] with { Code = "ADMIN_OCC" }] } };
        await using var application = CreateApplication(stub);
        using var client = application.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());
        using var response = await client.GetAsync(Path(), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Null(stub.Request);
    }

    [Fact]
    public async Task OpenApiPublishesFinanceEvidenceContract()
    {
        using var client = factory.CreateClient();
        using var response = await client.GetAsync("/swagger/v1/swagger.json",
            TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        var endpoint = json.RootElement.GetProperty("paths")
            .GetProperty("/api/v1/finance/approved-services").GetProperty("get");
        Assert.True(endpoint.GetProperty("responses").TryGetProperty("200", out _));
        Assert.True(endpoint.GetProperty("responses").TryGetProperty("403", out _));
        Assert.Contains(endpoint.GetProperty("parameters").EnumerateArray(), item =>
            item.GetProperty("name").GetString() == "stationId");
    }

    private static string Path() =>
        $"/api/v1/finance/approved-services?stationId={StationId:D}&from=2026-08-19&to=2026-08-19";

    private WebApplicationFactory<Program> CreateApplication(Stub stub) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IActorContextResolver>();
            services.RemoveAll<IFinanceApprovedServicesReadStore>();
            services.AddSingleton<IActorContextResolver>(stub);
            services.AddSingleton<IFinanceApprovedServicesReadStore>(stub);
        }));

    private static ActorContext Actor() => new(AccountId, "finance@dev.elevant.test", "Finance",
        [new ActorRole(Guid.NewGuid(), "FINANZAS", "Finanzas", PortalKind.BackOffice, "finance")],
        [new ActorMembership(Guid.NewGuid(), Guid.NewGuid(), "AVIAM", "AVIAM",
            OrganizationType.AviamOperator, MembershipKind.InternalStaff)],
        [new ActorStationScope(StationId, "PUJ")]);

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

    private sealed class Stub : IActorContextResolver, IFinanceApprovedServicesReadStore
    {
        public ActorContext? Actor { get; init; }
        public FinanceApprovedServicesData? Data { get; init; }
        public (Guid AccountId, Guid StationId, DateOnly From, DateOnly To)? Request { get; private set; }

        public Task<ActorContext?> ResolveAsync(Guid accountId, CancellationToken cancellationToken = default) =>
            Task.FromResult(Actor);

        public Task<FinanceApprovedServicesData?> GetAsync(Guid accountId, Guid stationId,
            DateOnly startDate, DateOnly endDate, CancellationToken cancellationToken = default)
        {
            Request = (accountId, stationId, startDate, endDate);
            return Task.FromResult(Data);
        }
    }
}
