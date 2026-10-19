using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Finance;
using Elevant.Application.Identity;
using Elevant.Contracts.Finance;
using Elevant.Domain.Enumerations;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
namespace Elevant.IntegrationTests.Api;

public sealed class FinanceFiscalEndpointsTests(ElevantApiFactory factory) : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid Account = Guid.Parse("40000000-0000-7000-8000-000000000006");
    [Fact]
    public async Task FiscalRoutesRequireJwtMapIndependentDtosAndPreserveExactArtifactBytes()
    {
        var stub = new FiscalStub(); await using var app = App(stub); using var client = app.CreateClient();
        var ct = TestContext.Current.CancellationToken;
        using var anonymous = await client.GetAsync("/api/v1/finance/fiscal-documents", ct);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token());
        var request = new FinanceFiscalCreateRequest(Guid.NewGuid(), Guid.NewGuid(), "Timeout");
        using var created = await client.PostAsJsonAsync("/api/v1/finance/fiscal-documents", request, ct);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal(Account, stub.Actor); Assert.Equal(FiscalSimulationOutcome.Timeout, stub.Input!.Outcome);
        Assert.Equal(request.RequestId, stub.Input.RequestId); Assert.Equal(request.InvoiceId, stub.Input.InvoiceId);
        Assert.Contains("no-store", created.Headers.CacheControl?.ToString());
        var simulation = new FinanceFiscalSimulateRequest(Guid.NewGuid(), "AAAAAAAAAAE=");
        using var simulated = await client.PostAsJsonAsync($"/api/v1/finance/fiscal-documents/{stub.Id}/simulate", simulation, ct);
        Assert.Equal(HttpStatusCode.OK, simulated.StatusCode);
        Assert.Equal(simulation.ExpectedVersion, stub.Simulation!.ExpectedVersion);
        using var download = await client.GetAsync($"/api/v1/finance/fiscal-documents/{stub.Id}/artifacts/{Guid.NewGuid()}", ct);
        Assert.Equal(HttpStatusCode.OK, download.StatusCode);
        Assert.Equal(stub.Bytes, await download.Content.ReadAsByteArrayAsync(ct));
        Assert.Equal("application/xml", download.Content.Headers.ContentType?.MediaType);
        Assert.Equal("\"synthetic-hash\"", download.Headers.ETag?.ToString());
        stub.Failure = FinanceFiscalFailure.ArchiveUnavailable;
        using var blocked = await client.PostAsJsonAsync($"/api/v1/finance/fiscal-documents/{stub.Id}/simulate", simulation, ct);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, blocked.StatusCode);
        using var problem = JsonDocument.Parse(await blocked.Content.ReadAsStringAsync(ct));
        Assert.Equal("ArchiveUnavailable", problem.RootElement.GetProperty("code").GetString());
    }
    [Fact]
    public async Task FiscalStatusDeniesAirlineMembershipAndDefaultsOffForInternalReader()
    {
        var stub = new FiscalStub(); await using var app = App(stub); using var client = app.CreateClient();
        var ct = TestContext.Current.CancellationToken;
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token());
        using var status = await client.GetAsync("/api/v1/finance/fiscal-documents/status", ct);
        Assert.Equal(HttpStatusCode.OK, status.StatusCode);
        var config = await status.Content.ReadFromJsonAsync<FinanceFiscalStatusResponse>(ct);
        Assert.Equal("Off", config!.Mode); Assert.False(config.CanSimulate);
        Assert.Equal("NotPerformed", config.OfficialXsdValidation);
        stub.Internal = false;
        using var forbidden = await client.GetAsync("/api/v1/finance/fiscal-documents/status", ct);
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);
    }
    [Fact]
    public async Task FiscalOpenApiExposesPublicContractsAndNoUnauthenticatedCallbackRoute()
    {
        await using var app = App(new FiscalStub()); using var client = app.CreateClient();
        using var response = await client.GetAsync("/swagger/v1/swagger.json", TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        var paths = json.RootElement.GetProperty("paths");
        Assert.True(paths.TryGetProperty("/api/v1/finance/fiscal-documents/{documentId}/simulate", out _));
        Assert.True(json.RootElement.GetProperty("components").GetProperty("schemas").TryGetProperty("FinanceFiscalCreateRequest", out _));
        Assert.False(paths.TryGetProperty("/api/v1/finance/fiscal-documents/callback", out _));
    }
    private WebApplicationFactory<Program> App(FiscalStub stub) => factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
    {
        s.RemoveAll<IFinanceFiscalStore>(); s.RemoveAll<IActorContextResolver>(); s.RemoveAll<FinanceFiscalOptions>();
        s.AddSingleton<IFinanceFiscalStore>(stub); s.AddSingleton<IActorContextResolver>(stub); s.AddSingleton(new FinanceFiscalOptions());
    }));
    private static string Token()
    {
        var now = DateTimeOffset.UtcNow;
        return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor {
            Audience = ElevantApiFactory.AuthenticationAudience, Expires = now.AddMinutes(15).UtcDateTime,
            IssuedAt = now.UtcDateTime, Issuer = ElevantApiFactory.AuthenticationIssuer, NotBefore = now.AddSeconds(-5).UtcDateTime,
            SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(Convert.FromBase64String(ElevantApiFactory.AuthenticationSigningKeyBase64)), SecurityAlgorithms.HmacSha256),
            Subject = new ClaimsIdentity([new Claim(JwtRegisteredClaimNames.Sub, Account.ToString("D")), new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("D")),
                new Claim(Elevant.Infrastructure.Authentication.SessionSecurityVersion.ClaimType,
                    Elevant.Infrastructure.Authentication.SessionSecurityVersion.Fingerprint(ElevantApiFactory.TestSecurityStamp))]), TokenType = "at+jwt" });
    }
    private sealed class FiscalStub : IFinanceFiscalStore, IActorContextResolver
    {
        public Guid Id { get; } = Guid.NewGuid(); public Guid Actor { get; private set; }
        public FiscalCreateInput? Input { get; private set; } public FiscalSimulateInput? Simulation { get; private set; }
        public byte[] Bytes { get; } = Encoding.UTF8.GetBytes("  <FiscalSimulation/>\r\n");
        public bool Internal { get; set; } = true; public FinanceFiscalFailure? Failure { get; set; }
        private Task<FiscalResult> Result() => Task.FromResult(new FiscalResult(Id, "AAAAAAAAAAE=", false, Failure));
        public Task<FiscalResult> CreateAsync(Guid accountId, FiscalCreateInput input, CancellationToken cancellationToken = default)
        { Actor = accountId; Input = input; return Result(); }
        public Task<FiscalResult> SimulateAsync(Guid accountId, Guid documentId, FiscalSimulateInput input, CancellationToken cancellationToken = default)
        { Simulation = input; return Result(); }
        public Task<IReadOnlyList<FiscalDocumentData>?> ListAsync(Guid accountId, Guid? stationId, int take, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<FiscalDocumentData>?>([]);
        public Task<FiscalDocumentData?> GetAsync(Guid accountId, Guid documentId, CancellationToken cancellationToken = default) => Task.FromResult<FiscalDocumentData?>(null);
        public Task<FiscalDownload?> DownloadAsync(Guid accountId, Guid documentId, Guid artifactId, CancellationToken cancellationToken = default) => Task.FromResult<FiscalDownload?>(new(Bytes, "original.xml", "application/xml", "synthetic-hash"));
        public Task<FiscalResult> ApplyCallbackAsync(Guid accountId, FiscalCallbackInput input, CancellationToken cancellationToken = default) => Result();
        public Task<ActorContext?> ResolveAsync(Guid accountId, CancellationToken cancellationToken = default) => Task.FromResult<ActorContext?>(new(accountId,
            "synthetic@test.invalid", "Synthetic Finance", [], [new(Guid.NewGuid(), Guid.NewGuid(), "QA", "QA", OrganizationType.AviamOperator,
                Internal ? MembershipKind.InternalStaff : MembershipKind.AirlineClient)], [], new DepartmentAccess(DepartmentAssignmentKind.Member,
                Department.Finance, new HashSet<string>(["finance.fiscal.read", "finance.fiscal.manage", "finance.fiscal.simulate"]))));
    }
}
