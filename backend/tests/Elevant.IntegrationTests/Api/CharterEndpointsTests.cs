using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Net.Http.Json;
using System.Text.Json;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;
using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

/// <summary>ADR-0033 through the real HTTP pipeline: binding, validation and permissions of the charter.</summary>
public sealed class CharterEndpointsTests(ElevantApiFactory factory) : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000002");
    private static readonly Guid StationId = Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly Guid OperationId = Guid.Parse("70000000-0000-7000-8000-000000000012");

    [Fact]
    public async Task TheAgentAddsServicesAndCarrierDataWithValidatedBodies()
    {
        var state = new State();
        await using var application = Create(state);
        using var client = Authenticated(application);
        using var added = await client.SendAsync(Json(HttpMethod.Post, $"/api/v1/ramp/operations/{OperationId:D}/charter/services",
            $$"""{"serviceDefinitionId":"{{Guid.NewGuid():D}}","quantity":2}"""), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, added.StatusCode);
        Assert.Equal(2m, state.Service!.Quantity);
        using var zero = await client.SendAsync(Json(HttpMethod.Post, $"/api/v1/ramp/operations/{OperationId:D}/charter/services",
            $$"""{"serviceDefinitionId":"{{Guid.NewGuid():D}}","quantity":0}"""), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, zero.StatusCode);
        using var details = await client.SendAsync(Json(HttpMethod.Put, $"/api/v1/ramp/operations/{OperationId:D}/charter/details",
            """{"carrierAddress":"  1200 NW 72nd Ave ","chargesPayableBy":null}"""), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, details.StatusCode);
        Assert.Equal("1200 NW 72nd Ave", state.Details!.CarrierAddress);
    }

    [Fact]
    public async Task FinanceNeedsItsPermissionToConfirmAPrepayment()
    {
        var state = new State();
        await using var application = Create(state);
        using var client = Authenticated(application);
        using var forbidden = await client.SendAsync(Json(HttpMethod.Put, $"/api/v1/finance/charters/{Guid.NewGuid():D}/prepayment",
            """{"amount":260,"reference":"TRF-0001"}"""), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);
        state.Permissions = [CharterHandler.FinanceReadPermission, CharterHandler.FinanceConfirmPermission];
        using var invalid = await client.SendAsync(Json(HttpMethod.Put, $"/api/v1/finance/charters/{Guid.NewGuid():D}/prepayment",
            """{"amount":260,"reference":"<x>"}"""), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        using var confirmed = await client.SendAsync(Json(HttpMethod.Put, $"/api/v1/finance/charters/{Guid.NewGuid():D}/prepayment",
            """{"amount":260,"reference":"TRF-0001"}"""), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, confirmed.StatusCode);
        Assert.Equal((260m, "TRF-0001"), (state.Amount, state.Reference));
    }

    /// <summary>
    /// 3-N24: a service added with the prepayment confirmed is a coded 409 the deployed tablet still explains by its
    /// status; Finance reopens the quotation with an Idempotency-Key, its reason and the version it saw.
    /// </summary>
    [Fact]
    public async Task TheConfirmedPrepaymentIsCodedAndFinanceReopensItWithKeyReasonAndVersion()
    {
        var state = new State { AddCode = "charter_prepayment_confirmed" };
        await using var application = Create(state);
        using var client = Authenticated(application);
        var ct = TestContext.Current.CancellationToken;
        using var refused = await client.SendAsync(Json(HttpMethod.Post, $"/api/v1/ramp/operations/{OperationId:D}/charter/services",
            $$"""{"serviceDefinitionId":"{{Guid.NewGuid():D}}","quantity":1}"""), ct);
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Equal("charter_prepayment_confirmed", (await refused.Content.ReadFromJsonAsync<JsonElement>(ct))
            .GetProperty("code").GetString());

        var charterId = Guid.NewGuid();
        HttpRequestMessage Reopen(string body, string? key)
        {
            var request = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/finance/charters/{charterId:D}/prepayment/reopening")
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json"),
            };
            if (key is not null) request.Headers.TryAddWithoutValidation("Idempotency-Key", key);
            return request;
        }
        using var forbidden = await client.SendAsync(Reopen("""{"reason":"Nueva cotización","version":"AAAA"}""",
            Guid.NewGuid().ToString("D")), ct);
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);
        state.Permissions = [CharterHandler.FinanceReadPermission, CharterHandler.FinanceConfirmPermission];
        async Task<string?> CodeOf(HttpResponseMessage response) =>
            (await response.Content.ReadFromJsonAsync<JsonElement>(ct)).TryGetProperty("code", out var code)
                ? code.GetString() : null;
        using var keyless = await client.SendAsync(Reopen("""{"reason":"Nueva cotización","version":"AAAA"}""", null), ct);
        Assert.Equal((HttpStatusCode.BadRequest, "idempotency_key_required"), (keyless.StatusCode, await CodeOf(keyless)));
        using var versionless = await client.SendAsync(Reopen("""{"reason":"Nueva cotización"}""",
            Guid.NewGuid().ToString("D")), ct);
        Assert.Equal((HttpStatusCode.BadRequest, "expected_version_required"),
            (versionless.StatusCode, await CodeOf(versionless)));
        using var brief = await client.SendAsync(Reopen("""{"reason":"corta","version":"AAAA"}""",
            Guid.NewGuid().ToString("D")), ct);
        Assert.Equal((HttpStatusCode.BadRequest, "reason_required"), (brief.StatusCode, await CodeOf(brief)));
        state.ReopenFailure = (MasterDataFailure.Conflict, "version_conflict");
        using var stale = await client.SendAsync(Reopen("""{"reason":"Nueva cotización","version":"AAAA"}""",
            Guid.NewGuid().ToString("D")), ct);
        Assert.Equal((HttpStatusCode.Conflict, "version_conflict"), (stale.StatusCode, await CodeOf(stale)));
        state.ReopenFailure = null;
        using var reopened = await client.SendAsync(Reopen("""{"reason":"  Nueva cotización  ","version":"AAAA"}""",
            Guid.NewGuid().ToString("D")), ct);
        Assert.Equal(HttpStatusCode.OK, reopened.StatusCode);
        var body = await reopened.Content.ReadFromJsonAsync<JsonElement>(ct);
        Assert.Equal(("Pending", "BBBB"), (body.GetProperty("prepaymentStatus").GetString(), body.GetProperty("version").GetString()));
        Assert.Equal(("Nueva cotización", "AAAA"), (state.ReopenReason, state.ReopenVersion));
    }

    private WebApplicationFactory<Program> Create(State state) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<IActorContextResolver>();
            services.RemoveAll<ICharterStore>();
            services.AddSingleton(state);
            services.AddScoped<IActorContextResolver>(_ => state);
            services.AddScoped<ICharterStore>(_ => state);
        }));

    private static HttpRequestMessage Json(HttpMethod method, string path, string json)
    {
        var request = new HttpRequestMessage(method, path) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
        request.Headers.TryAddWithoutValidation("X-Elevant-Installation-Id", "81000000-0000-7000-8000-000000000001");
        request.Headers.TryAddWithoutValidation("Idempotency-Key", Guid.NewGuid().ToString("D"));
        return request;
    }

    private static HttpClient Authenticated(WebApplicationFactory<Program> application)
    {
        var client = application.CreateClient();
        var now = DateTimeOffset.UtcNow;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer",
            new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
            {
                Audience = ElevantApiFactory.AuthenticationAudience, Issuer = ElevantApiFactory.AuthenticationIssuer,
                Expires = now.AddMinutes(15).UtcDateTime, IssuedAt = now.UtcDateTime, NotBefore = now.AddSeconds(-5).UtcDateTime,
                SigningCredentials = new SigningCredentials(
                    new SymmetricSecurityKey(Convert.FromBase64String(ElevantApiFactory.AuthenticationSigningKeyBase64)),
                    SecurityAlgorithms.HmacSha256),
                Subject = new System.Security.Claims.ClaimsIdentity(
                [
                    new System.Security.Claims.Claim(JwtRegisteredClaimNames.Sub, AccountId.ToString("D")),
                    new System.Security.Claims.Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("D")),
                    new System.Security.Claims.Claim(Elevant.Infrastructure.Authentication.SessionSecurityVersion.ClaimType,
                        Elevant.Infrastructure.Authentication.SessionSecurityVersion.Fingerprint(ElevantApiFactory.TestSecurityStamp)),
                ]),
                TokenType = "at+jwt",
            }));
        return client;
    }

    private sealed class State : IActorContextResolver, ICharterStore
    {
        public CharterServiceWriteRequest? Service { get; private set; }
        public CharterDetailsWriteRequest? Details { get; private set; }
        public decimal? Amount { get; private set; }
        public string? Reference { get; private set; }
        public string[] Permissions { get; set; } = [];
        public string? AddCode { get; init; }
        public (MasterDataFailure Failure, string Code)? ReopenFailure { get; set; }
        public string? ReopenReason { get; private set; }
        public string? ReopenVersion { get; private set; }

        private static CharterView View => new(OperationId, Guid.NewGuid(), "USD", null, null, "Pending", null, []);

        private static CharterPrepaymentItem Item(decimal amount, string reference) => new(Guid.NewGuid(), OperationId,
            "DEV-TAT-0012", new DateOnly(2026, 8, 18), "PUJ", "Charter Air", "USD", 260m, true, "Confirmed", amount, reference,
            DateTimeOffset.UtcNow);

        public Task<ActorContext?> ResolveAsync(Guid accountId, CancellationToken cancellationToken = default) =>
            Task.FromResult<ActorContext?>(new ActorContext(AccountId, "ramp.agent@dev.elevant.test", "Riley Ramp",
                [new ActorRole(Guid.Parse("41000000-0000-7000-8000-000000000002"), "RAMP_AGENT", "Ramp Agent",
                    PortalKind.RampMobileApp, "ramp_agent")],
                [new ActorMembership(Guid.Parse("42000000-0000-7000-8000-000000000002"),
                    Guid.Parse("10000000-0000-7000-8000-000000000001"), "AVIAM", "AVIAM Development",
                    OrganizationType.AviamOperator, MembershipKind.InternalStaff)],
                [new ActorStationScope(StationId, "PUJ")],
                Permissions.Length == 0 ? null
                    : new DepartmentAccess(DepartmentAssignmentKind.Member, Department.Finance, Permissions.ToHashSet())));

        public Task<CharterView?> ReadForAgentAsync(Guid accountId, IReadOnlyCollection<Guid> stations, Guid operationId,
            CancellationToken cancellationToken = default) => Task.FromResult<CharterView?>(View);

        public Task<CharterWriteResult> AddServiceAsync(CharterServiceWriteRequest request,
            CancellationToken cancellationToken = default)
        {
            Service = request;
            return Task.FromResult(AddCode is null
                ? new CharterWriteResult(View, null, Guid.NewGuid())
                : new CharterWriteResult(null, RampExecutionWriteFailure.Conflict, Guid.NewGuid(), AddCode));
        }

        public Task<CharterWriteResult> UpdateDetailsAsync(CharterDetailsWriteRequest request,
            CancellationToken cancellationToken = default)
        {
            Details = request;
            return Task.FromResult(new CharterWriteResult(View, null, Guid.NewGuid()));
        }

        public Task<IReadOnlyList<CharterPrepaymentItem>> ListForFinanceAsync(IReadOnlyCollection<Guid> stations,
            CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<CharterPrepaymentItem>>([]);

        public Task<(CharterPrepaymentItem? Item, CharterPrepaymentFailure? Failure)> ConfirmPrepaymentAsync(Guid accountId,
            IReadOnlyCollection<Guid> stations, Guid charterId, decimal amount, string reference, string? requestId,
            CancellationToken cancellationToken = default)
        {
            (Amount, Reference) = (amount, reference);
            return Task.FromResult<(CharterPrepaymentItem?, CharterPrepaymentFailure?)>((Item(amount, reference), null));
        }

        public Task<MasterDataResult<CharterPrepaymentItem>> ReopenPrepaymentAsync(Guid accountId,
            IReadOnlyCollection<Guid> stations, Guid charterId, string reason, string expectedVersion, Guid idempotencyKey,
            string? requestId, CancellationToken cancellationToken = default)
        {
            (ReopenReason, ReopenVersion) = (reason, expectedVersion);
            return Task.FromResult(ReopenFailure is { } failure
                ? MasterDataResult<CharterPrepaymentItem>.Failed(failure.Failure, failure.Code)
                : MasterDataResult<CharterPrepaymentItem>.Success(Item(260m, "TRF-0001") with
                {
                    PrepaymentStatus = "Pending", PrepaymentConfirmedAt = null, Version = "BBBB",
                }));
        }
    }
}
