using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Finance;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

/// <summary>
/// Suppliers, supplier invoices, supplier payments and employee expenses over HTTP (phase 4, block D): every refusal is
/// Problem Details with a stable code and the status of its table (4-N27), on every route of the module.
/// </summary>
public sealed class FinancePayablesEndpointsTests(ElevantApiFactory factory) : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid Account = Guid.Parse("40000000-0000-7000-8000-000000000006");

    public static TheoryData<string, int> Codes => new()
    {
        { FinancePayablesProblems.Forbidden, 403 }, { FinancePayablesProblems.SegregationOfDuties, 403 },
        { FinancePayablesProblems.NotFound, 404 }, { FinancePayablesProblems.VersionConflict, 409 },
        { FinancePayablesProblems.IdempotencyConflict, 409 }, { FinancePayablesProblems.InvalidState, 409 },
        { FinancePayablesProblems.DuplicateReference, 409 }, { FinancePayablesProblems.SupplierHasOpenBalance, 409 },
        { FinancePayablesProblems.AlreadyReversed, 409 }, { FinancePayablesProblems.BalanceExceeded, 409 },
        { FinancePayablesProblems.ReasonRequired, 400 }, { FinancePayablesProblems.ExpenseDateOutsideAssignment, 400 },
        { FinancePayablesProblems.ReceiptRequired, 400 }, { FinancePayablesProblems.Invalid, 400 },
        { FinancePayablesProblems.Unavailable, 503 },
    };

    [Theory]
    [MemberData(nameof(Codes))]
    public async Task EveryRefusalIsProblemDetailsWithItsCodeAndStatus(string code, int status)
    {
        var ct = TestContext.Current.CancellationToken;
        await using var app = App(new Stub(code));
        using var client = Authorized(app);
        using var response = await client.PostAsJsonAsync($"/api/v1/finance/payables/{Guid.NewGuid()}/decisions",
            new { requestId = Guid.NewGuid(), expectedVersion = "AAAAAAAAB9E=", decision = "Approved" }, ct);
        Assert.Equal(status, (int)response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        Assert.Equal(code, json.RootElement.GetProperty("code").GetString());
        Assert.Equal(status, json.RootElement.GetProperty("status").GetInt32());
    }

    [Theory]
    [InlineData("GET", "/api/v1/finance/suppliers")]
    [InlineData("PUT", "/api/v1/finance/suppliers/{0}")]
    [InlineData("DELETE", "/api/v1/finance/suppliers/{0}")]
    [InlineData("GET", "/api/v1/finance/payables/{0}")]
    [InlineData("POST", "/api/v1/finance/payables")]
    [InlineData("GET", "/api/v1/finance/payable-payments")]
    [InlineData("POST", "/api/v1/finance/payable-payments/{0}/applications")]
    [InlineData("POST", "/api/v1/finance/payable-payments/{0}/reversals")]
    [InlineData("GET", "/api/v1/finance/expenses/{0}")]
    [InlineData("POST", "/api/v1/finance/expenses/{0}/decisions")]
    [InlineData("POST", "/api/v1/finance/expenses/{0}/reimbursements")]
    [InlineData("GET", "/api/v1/finance/expenses/{0}/attachments/{0}")]
    [InlineData("POST", "/api/v1/finance/expenses/{0}/attachments/{0}/removals")]
    [InlineData("POST", "/api/v1/finance/payables/{0}/attachments/{0}/removals")]
    [InlineData("GET", "/api/v1/finance/payables/options")]
    public async Task EveryRouteOfTheModuleCodesItsRefusal(string method, string route)
    {
        var ct = TestContext.Current.CancellationToken;
        await using var app = App(new Stub(FinancePayablesProblems.SupplierInactive));
        using var client = Authorized(app);
        using var request = new HttpRequestMessage(new HttpMethod(method),
            string.Format(System.Globalization.CultureInfo.InvariantCulture, route, Guid.NewGuid()));
        if (method != "GET") request.Content = JsonContent.Create(BodyOf(route));
        using var response = await client.SendAsync(request, ct);
        Assert.Equal((HttpStatusCode.Conflict, FinancePayablesProblems.SupplierInactive), (response.StatusCode, await CodeAsync(response, ct)));
    }

    /// <summary>A body that binds for <paramref name="route"/>: the refusal comes from the store, never from the binder.</summary>
    private static object BodyOf(string route)
    {
        var fx = new { currency = "USD", rateToDop = 60m, source = "Synthetic FX", rateDate = "2026-10-18" };
        const string version = "AAAAAAAAB9E=";
        return route switch
        {
            // The supplier's save (PUT) and its retirement (DELETE) ignore each other's fields.
            _ when route.Contains("/suppliers/", StringComparison.Ordinal) =>
                new { requestId = Guid.NewGuid(), scopeStationId = Guid.NewGuid(), code = "QA", name = "Synthetic", isActive = true,
                    expectedVersion = version, decision = "Retired", reason = "Synthetic retirement" },
            "/api/v1/finance/payables" => new { requestId = Guid.NewGuid(), supplierId = Guid.NewGuid(), scopeStationId = Guid.NewGuid(),
                documentReference = "SUP-1", documentDate = "2026-10-18", dueDate = "2026-11-18", fx, dimensions = new { },
                lines = new[] { new { description = "Synthetic", quantity = 1m, unitPrice = 10m, taxAmount = 0m } } },
            _ when route.EndsWith("/applications", StringComparison.Ordinal) => new { requestId = Guid.NewGuid(), expectedVersion = version,
                applications = new[] { new { invoiceId = Guid.NewGuid(), expectedVersion = version, paymentAmount = 10m, rateToInvoice = 1m } } },
            _ when route.EndsWith("/reversals", StringComparison.Ordinal) => new { requestId = Guid.NewGuid(), expectedVersion = version,
                reason = "Aplicado a la factura equivocada", applicationId = Guid.NewGuid() },
            _ when route.EndsWith("/reimbursements", StringComparison.Ordinal) => new { requestId = Guid.NewGuid(), expectedVersion = version,
                paidOn = "2026-10-18", reference = "TR-1", fx, amount = 10m, rateToExpense = 1m },
            _ => new { requestId = Guid.NewGuid(), expectedVersion = version, decision = "Approved", reason = (string?)null },
        };
    }

    [Fact]
    public async Task MalformedRequestsAndFilesAnswerTheModuleCodes()
    {
        var ct = TestContext.Current.CancellationToken;
        var stub = new Stub(FinancePayablesProblems.Forbidden);
        await using var app = App(stub);
        using var client = Authorized(app);
        using (var malformed = await client.PostAsync($"/api/v1/finance/payables/{Guid.NewGuid()}/decisions",
                   new StringContent("{\"requestId\": 12", Encoding.UTF8, "application/json"), ct))
            Assert.Equal((HttpStatusCode.BadRequest, FinancePayablesProblems.Invalid), (malformed.StatusCode, await CodeAsync(malformed, ct)));
        using (var query = await client.GetAsync("/api/v1/finance/payables?scopeStationId=nope", ct))
            Assert.Equal((HttpStatusCode.BadRequest, FinancePayablesProblems.Invalid), (query.StatusCode, await CodeAsync(query, ct)));
        foreach (var length in new[] { 0, 8 * 1024 * 1024 + 1 })
        {
            using var form = new MultipartFormDataContent { { new StringContent(Guid.NewGuid().ToString()), "requestId" },
                { new StringContent("AAAAAAAAB9E="), "expectedVersion" } };
            if (length > 0) form.Add(new ByteArrayContent(new byte[length]) { Headers = { ContentType = new MediaTypeHeaderValue("application/pdf") } }, "file", "receipt.pdf");
            using var upload = await client.PostAsync($"/api/v1/finance/expenses/{Guid.NewGuid()}/attachments", form, ct);
            Assert.Equal((HttpStatusCode.BadRequest, FinancePayablesProblems.InvalidAttachment), (upload.StatusCode, await CodeAsync(upload, ct)));
        }
        Assert.Empty(stub.Calls);
    }

    /// <summary>
    /// 4-N04: a reversal without its reason binds and reaches the store, which answers <c>reason_required</c>; it is
    /// never a binding failure with the generic <c>invalid</c>.
    /// </summary>
    [Fact]
    public async Task AReversalWithoutItsReasonIsReasonRequiredFromTheStore()
    {
        var ct = TestContext.Current.CancellationToken;
        var stub = new Stub(FinancePayablesProblems.ReasonRequired);
        await using var app = App(stub);
        using var client = Authorized(app);
        foreach (object body in new object[] {
            new { requestId = Guid.NewGuid(), expectedVersion = "AAAAAAAAB9E=" },
            new { requestId = Guid.NewGuid(), expectedVersion = "AAAAAAAAB9E=", reason = (string?)null, applicationId = Guid.NewGuid() } })
        {
            using var response = await client.PostAsJsonAsync($"/api/v1/finance/payable-payments/{Guid.NewGuid()}/reversals", body, ct);
            Assert.Equal((HttpStatusCode.BadRequest, FinancePayablesProblems.ReasonRequired), (response.StatusCode, await CodeAsync(response, ct)));
        }
        Assert.Equal(["payment.reverse", "payment.reverse"], stub.Calls.ToArray());
    }

    [Fact]
    public async Task AnUnknownActorIsAskedToAuthenticate()
    {
        var ct = TestContext.Current.CancellationToken;
        await using var app = App(new Stub(FinancePayablesProblems.Unauthorized));
        using var client = Authorized(app);
        using var response = await client.GetAsync("/api/v1/finance/expenses", ct);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Contains("Bearer", response.Headers.WwwAuthenticate.ToString(), StringComparison.Ordinal);
        Assert.Equal(FinancePayablesProblems.Unauthorized, await CodeAsync(response, ct));
        using var anonymous = await app.CreateClient().GetAsync("/api/v1/finance/expenses", ct);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
    }

    private static async Task<string?> CodeAsync(HttpResponseMessage response, CancellationToken ct)
    {
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        return json.RootElement.TryGetProperty("code", out var code) ? code.GetString() : null;
    }

    private WebApplicationFactory<Program> App(Stub stub) => factory.WithWebHostBuilder(builder =>
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IFinancePayablesStore>();
            services.AddSingleton<IFinancePayablesStore>(stub);
        }));

    private static HttpClient Authorized(WebApplicationFactory<Program> app)
    {
        var client = app.CreateClient();
        var now = DateTimeOffset.UtcNow;
        var token = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Audience = ElevantApiFactory.AuthenticationAudience, Expires = now.AddMinutes(15).UtcDateTime,
            IssuedAt = now.UtcDateTime, Issuer = ElevantApiFactory.AuthenticationIssuer, NotBefore = now.AddSeconds(-5).UtcDateTime,
            SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(
                Convert.FromBase64String(ElevantApiFactory.AuthenticationSigningKeyBase64)), SecurityAlgorithms.HmacSha256),
            Subject = new System.Security.Claims.ClaimsIdentity(
            [
                new System.Security.Claims.Claim(JwtRegisteredClaimNames.Sub, Account.ToString("D")),
                new System.Security.Claims.Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("D")),
                new System.Security.Claims.Claim(Elevant.Infrastructure.Authentication.SessionSecurityVersion.ClaimType,
                    Elevant.Infrastructure.Authentication.SessionSecurityVersion.Fingerprint(ElevantApiFactory.TestSecurityStamp)),
            ]),
            TokenType = "at+jwt",
        });
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    /// <summary>A store that refuses every call with one code and records what reached it.</summary>
    private sealed class Stub(string code) : IFinancePayablesStore
    {
        public List<string> Calls { get; } = [];

        private Task<FinancePayablesResult<T>> Refuse<T>(string call)
        {
            Calls.Add(call);
            return Task.FromResult(FinancePayablesResult<T>.Fail(code));
        }

        public Task<FinancePayablesResult<IReadOnlyList<SupplierView>>> ListSuppliersAsync(Guid actorId, FinancePayablesFilter filter, CancellationToken ct = default) => Refuse<IReadOnlyList<SupplierView>>("suppliers");
        public Task<FinancePayablesResult<SupplierView>> GetSupplierAsync(Guid actorId, Guid id, CancellationToken ct = default) => Refuse<SupplierView>("supplier");
        public Task<FinancePayablesResult<FinancePayablesMutation>> SaveSupplierAsync(Guid actorId, Guid? id, SupplierSave input, CancellationToken ct = default) => Refuse<FinancePayablesMutation>("supplier.save");
        public Task<FinancePayablesResult<FinancePayablesMutation>> DeleteSupplierAsync(Guid actorId, Guid id, FinancePayablesDecision input, CancellationToken ct = default) => Refuse<FinancePayablesMutation>("supplier.retire");
        public Task<FinancePayablesResult<IReadOnlyList<FinancePayablesView>>> ListInvoicesAsync(Guid actorId, FinancePayablesFilter filter, CancellationToken ct = default) => Refuse<IReadOnlyList<FinancePayablesView>>("payables");
        public Task<FinancePayablesResult<FinancePayablesView>> GetInvoiceAsync(Guid actorId, Guid id, CancellationToken ct = default) => Refuse<FinancePayablesView>("payable");
        public Task<FinancePayablesResult<FinancePayablesMutation>> SaveInvoiceAsync(Guid actorId, Guid? id, FinancePayablesSave input, CancellationToken ct = default) => Refuse<FinancePayablesMutation>("payable.save");
        public Task<FinancePayablesResult<FinancePayablesMutation>> DecideInvoiceAsync(Guid actorId, Guid id, FinancePayablesDecision input, CancellationToken ct = default) => Refuse<FinancePayablesMutation>("payable.decide");
        public Task<FinancePayablesResult<IReadOnlyList<FinancePayablesPaymentView>>> ListPaymentsAsync(Guid actorId, FinancePayablesFilter filter, CancellationToken ct = default) => Refuse<IReadOnlyList<FinancePayablesPaymentView>>("payments");
        public Task<FinancePayablesResult<FinancePayablesPaymentView>> GetPaymentAsync(Guid actorId, Guid id, CancellationToken ct = default) => Refuse<FinancePayablesPaymentView>("payment");
        public Task<FinancePayablesResult<FinancePayablesMutation>> RecordPaymentAsync(Guid actorId, FinancePayablesPaymentSave input, CancellationToken ct = default) => Refuse<FinancePayablesMutation>("payment.record");
        public Task<FinancePayablesResult<FinancePayablesMutation>> ApplyPaymentAsync(Guid actorId, Guid id, FinancePayablesApply input, CancellationToken ct = default) => Refuse<FinancePayablesMutation>("payment.apply");
        public Task<FinancePayablesResult<FinancePayablesMutation>> ReversePaymentAsync(Guid actorId, Guid id, FinancePayablesReverse input, CancellationToken ct = default) => Refuse<FinancePayablesMutation>("payment.reverse");
        public Task<FinancePayablesResult<IReadOnlyList<EmployeeExpenseView>>> ListExpensesAsync(Guid actorId, FinancePayablesFilter filter, CancellationToken ct = default) => Refuse<IReadOnlyList<EmployeeExpenseView>>("expenses");
        public Task<FinancePayablesResult<EmployeeExpenseView>> GetExpenseAsync(Guid actorId, Guid id, CancellationToken ct = default) => Refuse<EmployeeExpenseView>("expense");
        public Task<FinancePayablesResult<FinancePayablesMutation>> SaveExpenseAsync(Guid actorId, Guid? id, EmployeeExpenseSave input, CancellationToken ct = default) => Refuse<FinancePayablesMutation>("expense.save");
        public Task<FinancePayablesResult<FinancePayablesMutation>> DecideExpenseAsync(Guid actorId, Guid id, FinancePayablesDecision input, CancellationToken ct = default) => Refuse<FinancePayablesMutation>("expense.decide");
        public Task<FinancePayablesResult<FinancePayablesMutation>> ReimburseExpenseAsync(Guid actorId, Guid id, EmployeeExpensePaymentSave input, CancellationToken ct = default) => Refuse<FinancePayablesMutation>("expense.reimburse");
        public Task<FinancePayablesResult<FinancePayablesOptions>> OptionsAsync(Guid actorId, Guid? scopeStationId, CancellationToken ct = default) => Refuse<FinancePayablesOptions>("options");
        public Task<FinancePayablesResult<FinancePayablesMutation>> UploadAttachmentAsync(Guid actorId, Guid id, bool expense, Guid requestId, string expectedVersion, string contentType, byte[] bytes, CancellationToken ct = default) => Refuse<FinancePayablesMutation>("attachment.upload");
        public Task<FinancePayablesResult<FinancePayablesAttachmentContent>> DownloadAttachmentAsync(Guid actorId, Guid id, bool expense, Guid attachmentId, CancellationToken ct = default) => Refuse<FinancePayablesAttachmentContent>("attachment.download");
        public Task<FinancePayablesResult<FinancePayablesMutation>> RemoveAttachmentAsync(Guid actorId, Guid id, bool expense, Guid attachmentId, FinancePayablesAttachmentRemoval input, CancellationToken ct = default) => Refuse<FinancePayablesMutation>("attachment.remove");
    }
}
