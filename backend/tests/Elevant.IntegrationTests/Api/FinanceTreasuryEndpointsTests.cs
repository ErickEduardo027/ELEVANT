using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Json;
using Elevant.Application.Abstractions.Finance;
using Elevant.Contracts.Finance;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
namespace Elevant.IntegrationTests.Api;

public sealed class FinanceTreasuryEndpointsTests(ElevantApiFactory factory) : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid Account = Guid.Parse("40000000-0000-7000-8000-000000000006");
    [Fact]
    public async Task TreasuryRoutesRequireJwtAndExposeContractsInOpenApi()
    {
        await using var app = App(new Stub()); using var client = app.CreateClient(); var ct = TestContext.Current.CancellationToken;
        using var anonymous = await client.GetAsync("/api/v1/finance/receipts", ct);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        using var swagger = await client.GetAsync("/swagger/v1/swagger.json", ct); swagger.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await swagger.Content.ReadAsStringAsync(ct));
        var paths = json.RootElement.GetProperty("paths");
        foreach (var path in new[] { "/api/v1/finance/receipts", "/api/v1/finance/receipts/options", "/api/v1/finance/receipts/{receiptId}",
            "/api/v1/finance/receipts/{receiptId}/applications", "/api/v1/finance/receipts/{receiptId}/reversals",
            "/api/v1/finance/receipts/{receiptId}/refunds", "/api/v1/finance/invoices/{invoiceId}/adjustment-notes", "/api/v1/finance/statements" })
            Assert.True(paths.TryGetProperty(path, out _), path);
        Assert.True(json.RootElement.GetProperty("components").GetProperty("schemas").TryGetProperty("FinanceTreasuryReceiptResponse", out _));
    }
    [Fact]
    public async Task ReceiptAndApplicationsMapExactPayloadAndReturnReplayWithoutDuplicateStatus()
    {
        var stub = new Stub(); await using var app = App(stub); using var client = app.CreateClient();
        var ct = TestContext.Current.CancellationToken;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());
        var request = new FinanceTreasuryReceiptRequest(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), "USD", 1000m,
            "TEST-RECEIPT", "Transfer", new DateOnly(2026, 10, 18), "Customer advance");
        using var created = await client.PostAsJsonAsync("/api/v1/finance/receipts", request, ct);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode); Assert.Equal(Account, stub.Actor);
        Assert.Equal(1000m, stub.Receipt!.Amount); Assert.Equal(request.RequestId, stub.Receipt.RequestId);
        Assert.Contains("no-store", created.Headers.CacheControl?.ToString());
        var receipt = await created.Content.ReadFromJsonAsync<FinanceTreasuryMutationResponse>(ct);
        var allocation = new FinanceTreasuryApplyRequest(Guid.NewGuid(), "AAAAAQ==", new DateOnly(2026, 10, 18),
            "Partial receipt", [new(Guid.NewGuid(), "0", 300m)]);
        using var applied = await client.PostAsJsonAsync($"/api/v1/finance/receipts/{receipt!.Id}/applications", allocation, ct);
        Assert.Equal(HttpStatusCode.Created, applied.StatusCode);
        Assert.Equal(receipt.Id, stub.Resource); Assert.Equal(300m, Assert.Single(stub.Allocation!.Applications).ReceiptAmount);
        Assert.Equal("0", Assert.Single(stub.Allocation.Applications).ExpectedInvoiceVersion);
        stub.Replayed = true;
        using var replayed = await client.PostAsJsonAsync($"/api/v1/finance/receipts/{receipt.Id}/applications", allocation, ct);
        Assert.Equal(HttpStatusCode.OK, replayed.StatusCode);
        Assert.True((await replayed.Content.ReadFromJsonAsync<FinanceTreasuryMutationResponse>(ct))!.Replayed);
        stub.Failure = FinanceTreasuryFailure.Conflict;
        using var conflict = await client.PostAsJsonAsync($"/api/v1/finance/receipts/{receipt.Id}/applications", allocation, ct);
        Assert.Equal(HttpStatusCode.Conflict, conflict.StatusCode);
    }
    [Fact]
    public async Task MissingReadScopeDoesNotRevealReceiptAndForbiddenMutationsReturn403()
    {
        var stub = new Stub { Failure = FinanceTreasuryFailure.Forbidden };
        await using var app = App(stub); using var client = app.CreateClient(); var ct = TestContext.Current.CancellationToken;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());
        using var hidden = await client.GetAsync($"/api/v1/finance/receipts/{Guid.NewGuid()}", ct);
        Assert.Equal(HttpStatusCode.NotFound, hidden.StatusCode);
        using var forbidden = await client.PostAsJsonAsync($"/api/v1/finance/receipts/{Guid.NewGuid()}/refunds",
            new FinanceTreasuryRefundRequest(Guid.NewGuid(), "v1", new DateOnly(2026, 10, 18), "Return remaining advance", 100m, "RF-1"), ct);
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);
    }
    private WebApplicationFactory<Program> App(Stub stub) => factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        { services.RemoveAll<IFinanceTreasuryStore>(); services.AddSingleton<IFinanceTreasuryStore>(stub); }));
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
    private sealed class Stub : IFinanceTreasuryStore
    {
        public Guid Actor { get; private set; } public Guid Resource { get; private set; }
        public FinanceTreasuryReceiptInput? Receipt { get; private set; } public FinanceTreasuryApplyInput? Allocation { get; private set; }
        public bool Replayed { get; set; } public FinanceTreasuryFailure? Failure { get; set; }
        private readonly Guid _id = Guid.NewGuid();
        private Task<FinanceTreasuryResult> Result() => Task.FromResult(Failure is { } failure ? FinanceTreasuryResult.Failed(failure) : new(_id, "v1", Replayed, null));
        public Task<FinanceTreasuryResult> RecordAsync(Guid actorId, FinanceTreasuryReceiptInput input, CancellationToken cancellationToken = default)
        { Actor = actorId; Receipt = input; return Result(); }
        public Task<FinanceTreasuryResult> ApplyAsync(Guid actorId, Guid receiptId, FinanceTreasuryApplyInput input, CancellationToken cancellationToken = default)
        { Actor = actorId; Resource = receiptId; Allocation = input; return Result(); }
        public Task<AirlineTreasuryReadResult<AirlineTreasuryStatementData>> PortalStatementAsync(Guid actorId, DateOnly asOf, Guid? stationId, CancellationToken cancellationToken = default) => Task.FromResult(new AirlineTreasuryReadResult<AirlineTreasuryStatementData>(null, FinanceTreasuryFailure.Forbidden));
        public Task<AirlineTreasuryReadResult<AirlineTreasuryInvoiceDetailData>> PortalInvoiceAsync(Guid actorId, Guid invoiceId, CancellationToken cancellationToken = default) => Task.FromResult(new AirlineTreasuryReadResult<AirlineTreasuryInvoiceDetailData>(null, FinanceTreasuryFailure.Forbidden));
        public Task<AirlineTreasuryReadResult<AirlineTreasuryReceiptData>> PortalReceiptAsync(Guid actorId, Guid receiptId, CancellationToken cancellationToken = default) => Task.FromResult(new AirlineTreasuryReadResult<AirlineTreasuryReceiptData>(null, FinanceTreasuryFailure.Forbidden));
        public Task<AirlineTreasuryReadResult<AirlineTreasuryAdjustmentsData>> PortalAdjustmentsAsync(Guid actorId, Guid invoiceId, CancellationToken cancellationToken = default) => Task.FromResult(new AirlineTreasuryReadResult<AirlineTreasuryAdjustmentsData>(null, FinanceTreasuryFailure.Forbidden));
        public Task<FinanceTreasuryOptionsData?> OptionsAsync(Guid actorId, CancellationToken cancellationToken = default) => Task.FromResult<FinanceTreasuryOptionsData?>(new([], []));
        public Task<FinanceTreasuryReceiptPageData?> ListAsync(Guid actorId, Guid? stationId, Guid? airlineId, int page, int limit, CancellationToken cancellationToken = default) => Task.FromResult<FinanceTreasuryReceiptPageData?>(null);
        public Task<FinanceTreasuryReceiptData?> GetAsync(Guid actorId, Guid receiptId, CancellationToken cancellationToken = default) => Task.FromResult<FinanceTreasuryReceiptData?>(null);
        public Task<FinanceTreasuryResult> ReverseAsync(Guid actorId, Guid receiptId, FinanceTreasuryReverseInput input, CancellationToken cancellationToken = default) => Result();
        public Task<FinanceTreasuryResult> RefundAsync(Guid actorId, Guid receiptId, FinanceTreasuryRefundInput input, CancellationToken cancellationToken = default) => Result();
        public Task<FinanceTreasuryAdjustmentsData?> AdjustmentsAsync(Guid actorId, Guid invoiceId, CancellationToken cancellationToken = default) => Task.FromResult<FinanceTreasuryAdjustmentsData?>(null);
        public Task<FinanceTreasuryResult> IssueAdjustmentAsync(Guid actorId, Guid invoiceId, FinanceTreasuryAdjustmentInput input, CancellationToken cancellationToken = default) => Result();
        public Task<FinanceTreasuryStatementData?> StatementAsync(Guid actorId, DateOnly asOf, Guid? stationId, Guid? airlineId, CancellationToken cancellationToken = default) => Task.FromResult<FinanceTreasuryStatementData?>(null);
    }
}
