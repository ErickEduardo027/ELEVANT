using System.Net;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text.Json;
using Elevant.Application.Abstractions.Finance;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
namespace Elevant.IntegrationTests.Api;
public sealed class AirlineTreasuryEndpointsTests(ElevantApiFactory factory) : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid Account = Guid.Parse("40000000-0000-7000-8000-000000000003");
    [Fact]
    public async Task AirlineTreasuryRequiresJwtAndPublishesGetOnlyRoutes()
    {
        await using var app = App(new Stub()); using var client = app.CreateClient(); var ct = TestContext.Current.CancellationToken;
        using var anonymous = await client.GetAsync("/api/v1/airline/portal/treasury/statements?asOf=2026-10-18", ct);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());
        using var mutation = await client.PostAsync("/api/v1/airline/portal/treasury/receipts/" + Guid.NewGuid(), new StringContent("{}"), ct);
        Assert.Equal(HttpStatusCode.MethodNotAllowed, mutation.StatusCode);
        using var swagger = await client.GetAsync("/swagger/v1/swagger.json", ct); swagger.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await swagger.Content.ReadAsStringAsync(ct));
        foreach (var route in new[] { "/api/v1/airline/portal/treasury/statements", "/api/v1/airline/portal/treasury/invoices/{invoiceId}",
            "/api/v1/airline/portal/treasury/invoices/{invoiceId}/adjustment-notes", "/api/v1/airline/portal/treasury/receipts/{receiptId}" })
        {
            var endpoint = json.RootElement.GetProperty("paths").GetProperty(route);
            Assert.True(endpoint.TryGetProperty("get", out _)); Assert.False(endpoint.TryGetProperty("post", out _));
        }
    }
    [Fact]
    public async Task ControllerUsesJwtAccountAndDoesNotAcceptTenantSelection()
    {
        var stub = new Stub(); await using var app = App(stub); using var client = app.CreateClient(); var ct = TestContext.Current.CancellationToken;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());
        using var response = await client.GetAsync("/api/v1/airline/portal/treasury/statements?asOf=2026-10-18&organizationId=" + Guid.NewGuid() + "&airlineId=" + Guid.NewGuid(), ct);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode); Assert.Equal(Account, stub.Actor);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString());
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        Assert.Equal(stub.AirlineId, json.RootElement.GetProperty("airlineId").GetGuid());
        Assert.False(json.RootElement.TryGetProperty("actorId", out _)); Assert.False(json.RootElement.TryGetProperty("version", out _));
        using var missing = await client.GetAsync("/api/v1/airline/portal/treasury/invoices/" + Guid.NewGuid(), ct);
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        // Phase 4, block A: the refusal carries its code.
        using var problem = JsonDocument.Parse(await missing.Content.ReadAsStringAsync(ct));
        Assert.Equal("not_found", problem.RootElement.GetProperty("code").GetString());
    }
    private WebApplicationFactory<Program> App(Stub stub) => factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        { services.RemoveAll<IFinanceTreasuryStore>(); services.AddSingleton<IFinanceTreasuryStore>(stub); }));
    private static string Token()
    {
        var now = DateTimeOffset.UtcNow; return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor {
            Audience = ElevantApiFactory.AuthenticationAudience, Expires = now.AddMinutes(15).UtcDateTime, IssuedAt = now.UtcDateTime,
            Issuer = ElevantApiFactory.AuthenticationIssuer, NotBefore = now.AddSeconds(-5).UtcDateTime,
            SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(Convert.FromBase64String(ElevantApiFactory.AuthenticationSigningKeyBase64)), SecurityAlgorithms.HmacSha256),
            Subject = new ClaimsIdentity([new Claim(JwtRegisteredClaimNames.Sub, Account.ToString("D")), new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("D")),
                new Claim(Elevant.Infrastructure.Authentication.SessionSecurityVersion.ClaimType, Elevant.Infrastructure.Authentication.SessionSecurityVersion.Fingerprint(ElevantApiFactory.TestSecurityStamp))]), TokenType = "at+jwt" });
    }
    private sealed class Stub : IFinanceTreasuryStore
    {
        public Guid Actor { get; private set; } public Guid AirlineId { get; } = Guid.NewGuid();
        public Task<AirlineTreasuryReadResult<AirlineTreasuryStatementData>> PortalStatementAsync(Guid actorId, DateOnly asOf, Guid? stationId, CancellationToken cancellationToken = default)
        { Actor = actorId; return Task.FromResult(new AirlineTreasuryReadResult<AirlineTreasuryStatementData>(new(AirlineId, asOf, [], [], [], []), null)); }
        public Task<AirlineTreasuryReadResult<AirlineTreasuryInvoiceDetailData>> PortalInvoiceAsync(Guid actorId, Guid invoiceId, CancellationToken cancellationToken = default) => Task.FromResult(new AirlineTreasuryReadResult<AirlineTreasuryInvoiceDetailData>(null, FinanceTreasuryFailure.NotFound));
        public Task<AirlineTreasuryReadResult<AirlineTreasuryReceiptData>> PortalReceiptAsync(Guid actorId, Guid receiptId, CancellationToken cancellationToken = default) => Task.FromResult(new AirlineTreasuryReadResult<AirlineTreasuryReceiptData>(null, FinanceTreasuryFailure.NotFound));
        public Task<AirlineTreasuryReadResult<AirlineTreasuryAdjustmentsData>> PortalAdjustmentsAsync(Guid actorId, Guid invoiceId, CancellationToken cancellationToken = default) => Task.FromResult(new AirlineTreasuryReadResult<AirlineTreasuryAdjustmentsData>(null, FinanceTreasuryFailure.NotFound));
        public Task<FinanceTreasuryOptionsData?> OptionsAsync(Guid actorId, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<FinanceTreasuryReceiptPageData?> ListAsync(Guid actorId, Guid? stationId, Guid? airlineId, int page, int limit, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<FinanceTreasuryReceiptData?> GetAsync(Guid actorId, Guid receiptId, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<FinanceTreasuryResult> RecordAsync(Guid actorId, FinanceTreasuryReceiptInput input, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<FinanceTreasuryResult> ApplyAsync(Guid actorId, Guid receiptId, FinanceTreasuryApplyInput input, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<FinanceTreasuryResult> ReverseAsync(Guid actorId, Guid receiptId, FinanceTreasuryReverseInput input, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<FinanceTreasuryResult> RefundAsync(Guid actorId, Guid receiptId, FinanceTreasuryRefundInput input, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<FinanceTreasuryAdjustmentsData?> AdjustmentsAsync(Guid actorId, Guid invoiceId, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<FinanceTreasuryResult> IssueAdjustmentAsync(Guid actorId, Guid invoiceId, FinanceTreasuryAdjustmentInput input, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<FinanceTreasuryStatementData?> StatementAsync(Guid actorId, DateOnly asOf, Guid? stationId, Guid? airlineId, CancellationToken cancellationToken = default) => throw new NotSupportedException();
    }
}
