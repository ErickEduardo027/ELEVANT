using System.Net;
using System.Net.Http.Headers;
using System.Text;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

/// <summary>ADR-0032 through the real HTTP pipeline: binding, validation, device headers and errors.</summary>
public sealed class OperationDocumentEndpointsTests(ElevantApiFactory factory) : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000002");
    private static readonly Guid StationId = Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly Guid OperationId = Guid.Parse("70000000-0000-7000-8000-000000000005");
    private static readonly Guid MarkId = Guid.Parse("84000000-0000-7000-8000-000000000001");
    private static readonly string Sha = new('a', 64);

    [Fact]
    public async Task ASignatureIsBoundValidatedAndPassedWithItsDeviceHeaders()
    {
        var state = new State();
        await using var application = Create(state);
        using var anonymous = application.CreateClient();
        using var unauthorized = await anonymous.GetAsync($"/api/v1/ramp/operations/{OperationId:D}/documents",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, unauthorized.StatusCode);

        using var client = Authenticated(application);
        using var signed = await client.SendAsync(Json(HttpMethod.Put,
            $"/api/v1/ramp/operations/{OperationId:D}/documents/ServiceOrder/signatures/AirlineRepresentative",
            $$"""{"signerName":"  Ana   Pérez ","documentSha256":"{{Sha}}","strokes":[[0.12345,0.5,0.9,0.25]]}"""),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, signed.StatusCode);
        var request = Assert.IsType<OperationDocumentSignRequest>(state.Signature);
        Assert.Equal(("Ana Pérez", OperationDocumentKind.ServiceOrder, OperationSignatureRole.AirlineRepresentative),
            (request.SignerName, request.Kind, request.Role));
        Assert.Equal([0.123m, 0.5m, 0.9m, 0.25m], request.Strokes.Single());

        // Bad shapes are a 400, never a 500, and never reach the store.
        state.Signature = null;
        foreach (var (path, body) in new[]
        {
            ("ServiceOrder/signatures/AirlineRepresentative", """{"signerName":"Ana","documentSha256":"nope","strokes":[[0.1,0.1,0.2,0.2]]}"""),
            ("ServiceOrder/signatures/AirlineRepresentative", $$"""{"signerName":"Ana","documentSha256":"{{Sha}}","strokes":[[0.1,1.5,0.2,0.2]]}"""),
            ("ServiceOrder/signatures/Coordinator", $$"""{"signerName":"Ana","documentSha256":"{{Sha}}","strokes":[[0.1,0.1,0.2,0.2]]}"""),
            ("Invoice/signatures/AviamAgent", $$"""{"signerName":"Ana","documentSha256":"{{Sha}}","strokes":[[0.1,0.1,0.2,0.2]]}"""),
        })
        {
            using var rejected = await client.SendAsync(Json(HttpMethod.Put,
                $"/api/v1/ramp/operations/{OperationId:D}/documents/{path}", body), TestContext.Current.CancellationToken);
            Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
        }
        Assert.Null(state.Signature);
    }

    [Fact]
    public async Task DamageMarksAndPhotosAreValidatedBeforeTheStore()
    {
        var state = new State();
        await using var application = Create(state);
        using var client = Authenticated(application);
        using var mark = await client.SendAsync(Json(HttpMethod.Put,
            $"/api/v1/ramp/operations/{OperationId:D}/damage-marks/{MarkId:D}",
            """{"x":0.45,"y":0.3,"note":"Abolladura","reportedAt":"2026-11-04T16:00:00Z"}"""),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, mark.StatusCode);
        Assert.Equal((0.45m, 0.3m), (state.Mark!.X, state.Mark.Y));
        using var outside = await client.SendAsync(Json(HttpMethod.Put,
            $"/api/v1/ramp/operations/{OperationId:D}/damage-marks/{MarkId:D}",
            """{"x":1.5,"y":0.3,"note":"Abolladura","reportedAt":"2026-11-04T16:00:00Z"}"""),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, outside.StatusCode);

        HttpRequestMessage Photo(byte[] bytes, string type)
        {
            var request = new HttpRequestMessage(HttpMethod.Put,
                $"/api/v1/ramp/operations/{OperationId:D}/damage-marks/{MarkId:D}/photo")
            { Content = new ByteArrayContent(bytes) };
            request.Content.Headers.ContentType = new MediaTypeHeaderValue(type);
            request.Headers.TryAddWithoutValidation("X-Elevant-Installation-Id", "81000000-0000-7000-8000-000000000001");
            return request;
        }
        using var photo = await client.SendAsync(Photo([0xFF, 0xD8, 0xFF, 0xE0, 1], "image/jpeg"),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, photo.StatusCode);
        Assert.Equal("image/jpeg", state.Photo!.ContentType);
        using var notAnImage = await client.SendAsync(Photo("%PDF-1.7"u8.ToArray(), "image/jpeg"),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, notAnImage.StatusCode);
        state.Unavailable = true;
        using var unavailable = await client.SendAsync(Photo([0xFF, 0xD8, 0xFF, 0xE1], "image/jpeg"),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, unavailable.StatusCode);
    }

    private WebApplicationFactory<Program> Create(State state) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<IActorContextResolver>();
            services.RemoveAll<IOperationDocumentStore>();
            services.AddSingleton(state);
            services.AddScoped<IActorContextResolver>(_ => state);
            services.AddScoped<IOperationDocumentStore>(_ => state);
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
        var token = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
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
        });
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private sealed class State : IActorContextResolver, IOperationDocumentStore
    {
        public OperationDocumentSignRequest? Signature { get; set; }
        public DamageMarkWriteRequest? Mark { get; private set; }
        public DamagePhotoWriteRequest? Photo { get; private set; }
        public bool Unavailable { get; set; }

        private static OperationDocumentsView View => new(OperationId, [], []);

        public Task<ActorContext?> ResolveAsync(Guid accountId, CancellationToken cancellationToken = default) =>
            Task.FromResult<ActorContext?>(new ActorContext(AccountId, "ramp.agent@dev.elevant.test", "Riley Ramp",
                [new ActorRole(Guid.Parse("41000000-0000-7000-8000-000000000002"), "RAMP_AGENT", "Ramp Agent",
                    PortalKind.RampMobileApp, "ramp_agent")],
                [new ActorMembership(Guid.Parse("42000000-0000-7000-8000-000000000002"),
                    Guid.Parse("10000000-0000-7000-8000-000000000001"), "AVIAM", "AVIAM Development",
                    OrganizationType.AviamOperator, MembershipKind.InternalStaff)],
                [new ActorStationScope(StationId, "PUJ")]));

        public Task<OperationDocumentsView?> ReadForAgentAsync(Guid accountId, IReadOnlyCollection<Guid> stations,
            Guid operationId, CancellationToken cancellationToken = default) => Task.FromResult<OperationDocumentsView?>(View);

        public Task<OperationDocumentWriteResult> SignAsync(OperationDocumentSignRequest request,
            CancellationToken cancellationToken = default)
        {
            Signature = request;
            return Task.FromResult(OperationDocumentWriteResult.Success(View, Guid.NewGuid()));
        }

        public Task<OperationDocumentWriteResult> RecordDamageMarkAsync(DamageMarkWriteRequest request,
            CancellationToken cancellationToken = default)
        {
            Mark = request;
            return Task.FromResult(OperationDocumentWriteResult.Success(View, Guid.NewGuid()));
        }

        public Task<OperationDocumentWriteResult> AttachDamagePhotoAsync(DamagePhotoWriteRequest request,
            CancellationToken cancellationToken = default)
        {
            if (Unavailable) throw new OperationalEvidenceUnavailableException();
            Photo = request;
            return Task.FromResult(OperationDocumentWriteResult.Success(View, null));
        }

        public Task<OperationDocumentsView?> ReadForOccAsync(IReadOnlyCollection<Guid> stations, Guid operationId,
            CancellationToken cancellationToken = default) => Task.FromResult<OperationDocumentsView?>(View);

        public Task<DamagePhoto?> ReadDamagePhotoForOccAsync(IReadOnlyCollection<Guid> stations, Guid operationId, Guid markId,
            CancellationToken cancellationToken = default) => Task.FromResult<DamagePhoto?>(null);

        public Task<SignedOperationDocument?> ReadSignedServiceOrderForAirlineAsync(Guid organizationId, Guid operationId,
            CancellationToken cancellationToken = default) => Task.FromResult<SignedOperationDocument?>(null);
    }
}
