using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Elevant.Application.Abstractions.Operations;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

/// <summary>2-N25: the planning board's marks on assigned agents who cannot do their operation.</summary>
public sealed class OccAssignmentReadinessEndpointsTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000001");
    private static readonly Guid StationId = Guid.Parse("20000000-0000-7000-8000-000000000003");
    private const string Route = "/api/v1/occ/planning/assignment-readiness";

    [Fact]
    public async Task TheReadIsAuthenticatedValidatedAndReturnsOnlyTheStoreMarks()
    {
        var assignmentId = Guid.NewGuid();
        var stub = new Stub
        {
            Result = new OccAssignmentReadinessResult(new OccAssignmentReadinessData(StationId, new DateOnly(2026, 11, 7),
                [new OccUnfitAssignmentData(assignmentId, Guid.NewGuid(), Guid.NewGuid(), ["airport_id_not_current"])]), null),
        };
        await using var application = factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IOccAssignmentReadinessStore>();
            services.AddSingleton<IOccAssignmentReadinessStore>(stub);
        }));
        using var client = application.CreateClient();
        using (var anonymous = await client.GetAsync($"{Route}?stationId={StationId}&date=2026-11-07",
                   TestContext.Current.CancellationToken))
            Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());
        using (var missing = await client.GetAsync($"{Route}?stationId={StationId}", TestContext.Current.CancellationToken))
            Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        Assert.Null(stub.Request);

        using var response = await client.GetAsync($"{Route}?stationId={StationId}&date=2026-11-07",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString());
        Assert.Equal((AccountId, StationId, new DateOnly(2026, 11, 7)), stub.Request);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        var mark = Assert.Single(json.RootElement.GetProperty("assignments").EnumerateArray());
        Assert.Equal(assignmentId, mark.GetProperty("assignmentId").GetGuid());
        Assert.Equal("airport_id_not_current", Assert.Single(mark.GetProperty("reasons").EnumerateArray()).GetString());

        stub.Result = new OccAssignmentReadinessResult(null, OccAssignmentReadinessFailure.Forbidden);
        using (var denied = await client.GetAsync($"{Route}?stationId={StationId}&date=2026-11-07",
                   TestContext.Current.CancellationToken))
            Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
        stub.Result = new OccAssignmentReadinessResult(null, OccAssignmentReadinessFailure.NotFound);
        using (var outside = await client.GetAsync($"{Route}?stationId={StationId}&date=2026-11-07",
                   TestContext.Current.CancellationToken))
        {
            Assert.Equal(HttpStatusCode.NotFound, outside.StatusCode);
            using var problem = JsonDocument.Parse(await outside.Content.ReadAsStringAsync(
                TestContext.Current.CancellationToken));
            Assert.Equal("not_found", problem.RootElement.GetProperty("code").GetString());
        }
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
                new SymmetricSecurityKey(Convert.FromBase64String(ElevantApiFactory.AuthenticationSigningKeyBase64)),
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

    private sealed class Stub : IOccAssignmentReadinessStore
    {
        public OccAssignmentReadinessResult Result { get; set; } = new(null, OccAssignmentReadinessFailure.Forbidden);
        public (Guid ActorId, Guid StationId, DateOnly Date)? Request { get; private set; }

        public Task<OccAssignmentReadinessResult> ReadAsync(Guid actorId, Guid stationId, DateOnly operationDate,
            CancellationToken cancellationToken = default)
        {
            Request = (actorId, stationId, operationDate);
            return Task.FromResult(Result);
        }
    }
}
