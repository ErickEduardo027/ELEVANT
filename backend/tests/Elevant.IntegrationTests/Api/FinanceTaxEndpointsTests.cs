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

public sealed class FinanceTaxEndpointsTests(ElevantApiFactory factory) : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid Account = Guid.Parse("40000000-0000-7000-8000-000000000006");
    [Fact]
    public async Task FinanceTaxRoutesRequireJwtKeepSeparateDtosAndMapConcurrencyErrors()
    {
        var stub = new TaxStub(); await using var app = App(stub); using var client = app.CreateClient(); var ct = TestContext.Current.CancellationToken;
        using var anonymous = await client.GetAsync("/api/v1/finance/tax-policies", ct); Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token());
        var input = new FinanceTaxPolicyRequest(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), "USD", "Package", "RAMP", "Taxable", 0, null, new(2026, 10, 1), null, null, null);
        using var create = await client.PostAsJsonAsync("/api/v1/finance/tax-policies", input, ct);
        Assert.Equal(HttpStatusCode.Created, create.StatusCode); Assert.Equal(Account, stub.Actor); Assert.Equal(0, stub.Input!.Rate);
        Assert.Equal(input.RequestId, stub.Input.RequestId); Assert.Equal("Package", stub.Input.ConceptKind);
        Assert.Contains("no-store", create.Headers.CacheControl?.ToString());
        using var detail = await client.GetAsync($"/api/v1/finance/preinvoices/{stub.Id}/taxes", ct);
        var data = await detail.Content.ReadFromJsonAsync<FinanceTaxDetailResponse>(ct);
        Assert.False(data!.TreatmentsConfigured); Assert.Null(data.Tax); Assert.Equal(100, data.Gross);
        stub.Failure = "ambiguous_tax_policy";
        using var apply = await client.PostAsJsonAsync($"/api/v1/finance/preinvoices/{stub.Id}/taxes", new FinanceTaxCommandRequest(Guid.NewGuid(), "rv1"), ct);
        Assert.Equal(HttpStatusCode.Conflict, apply.StatusCode); Assert.Contains("ambiguous_tax_policy", await apply.Content.ReadAsStringAsync(ct), StringComparison.Ordinal);
        stub.Forbidden = true;
        using var forbidden = await client.GetAsync("/api/v1/finance/tax-policies", ct); Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);
    }
    [Fact]
    public async Task FinanceTaxOpenApiExposesIndependentResponseWithoutChangingLegacyDraftContract()
    {
        await using var app = App(new TaxStub()); using var client = app.CreateClient();
        using var response = await client.GetAsync("/swagger/v1/swagger.json", TestContext.Current.CancellationToken); response.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        var paths = doc.RootElement.GetProperty("paths"); Assert.True(paths.TryGetProperty("/api/v1/finance/preinvoices/{id}/taxes", out _));
        var schemas = doc.RootElement.GetProperty("components").GetProperty("schemas");
        Assert.True(schemas.TryGetProperty(nameof(FinanceTaxDetailResponse), out _));
        var legacyKeys = schemas.GetProperty(nameof(PreinvoiceDraftLineResponse)).GetProperty("properties")
            .EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal).ToArray();
        Assert.Equal(new[] { "id", "operationServiceId", "approvedSubmissionId", "lineNumber", "operationCode", "operationDate", "serviceCode", "serviceName", "executedQuantity", "billingUnit", "unitPrice", "currencyCode", "amount", "kind", "parentLineId", "computedQuantity", "computedAmount", "isExcluded", "adjustmentReason", "editedAt" }.Order(StringComparer.Ordinal), legacyKeys);
    }
    private WebApplicationFactory<Program> App(TaxStub stub) => factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
    { s.RemoveAll<IFinanceTaxStore>(); s.AddSingleton<IFinanceTaxStore>(stub); }));
    private static string Token()
    {
        var now = DateTimeOffset.UtcNow;
        return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor { Audience = ElevantApiFactory.AuthenticationAudience,
            Expires = now.AddMinutes(15).UtcDateTime, IssuedAt = now.UtcDateTime, Issuer = ElevantApiFactory.AuthenticationIssuer,
            NotBefore = now.AddSeconds(-5).UtcDateTime, SigningCredentials = new(new SymmetricSecurityKey(Convert.FromBase64String(ElevantApiFactory.AuthenticationSigningKeyBase64)), SecurityAlgorithms.HmacSha256),
            Subject = new ClaimsIdentity([new Claim(JwtRegisteredClaimNames.Sub, Account.ToString("D")), new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("D")),
                new Claim(Elevant.Infrastructure.Authentication.SessionSecurityVersion.ClaimType, Elevant.Infrastructure.Authentication.SessionSecurityVersion.Fingerprint(ElevantApiFactory.TestSecurityStamp))]), TokenType = "at+jwt" });
    }
    private sealed class TaxStub : IFinanceTaxStore
    {
        public Guid Id { get; } = Guid.NewGuid(); public Guid Actor { get; private set; } public FinanceTaxPolicyInput? Input { get; private set; }
        public string? Failure { get; set; } public bool Forbidden { get; set; }
        public Task<IReadOnlyList<FinanceTaxPolicyData>?> ListAsync(Guid actor, CancellationToken ct = default) => Task.FromResult<IReadOnlyList<FinanceTaxPolicyData>?>(Forbidden ? null : []);
        public Task<FinanceTaxContextData?> ContextAsync(Guid actor, CancellationToken ct = default) => Task.FromResult<FinanceTaxContextData?>(new([], []));
        public Task<FinanceTaxWriteResult> CreateAsync(Guid actor, FinanceTaxPolicyInput input, CancellationToken ct = default) { Actor = actor; Input = input; return Result(); }
        public Task<FinanceTaxWriteResult> PublishAsync(Guid actor, Guid id, FinanceTaxCommandInput input, CancellationToken ct = default) => Result();
        public Task<FinanceTaxWriteResult> ApplyAsync(Guid actor, Guid id, FinanceTaxCommandInput input, CancellationToken ct = default) => Result();
        public Task<FinanceTaxDetailData?> GetPreinvoiceAsync(Guid actor, Guid id, CancellationToken ct = default) => Task.FromResult<FinanceTaxDetailData?>(new(Id, "rv1", "USD", 100, 0, null, 100, false, []));
        private Task<FinanceTaxWriteResult> Result() => Task.FromResult(Failure is null ? FinanceTaxWriteResult.Success(Id) : FinanceTaxWriteResult.Fail(Failure));
    }
}
