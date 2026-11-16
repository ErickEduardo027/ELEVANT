using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
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

/// <summary>
/// The simplified Finance over HTTP (phase 4, block B): the legacy writes answer 410 with their code (4-N12), the
/// retired modules are gone (4-A), «Inicio» (4-A, 4-N02), «Facturas» (4-N21) and the reports (4-N19, 4-N20) refuse with
/// a stable code.
/// </summary>
public sealed class FinanceSimplificationEndpointsTests(ElevantApiFactory factory) : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid Account = Guid.Parse("40000000-0000-7000-8000-000000000006");
    private static readonly Guid Station = Guid.NewGuid();

    /// <summary>Whatever permissions the caller holds, nothing is read or written.</summary>
    [Theory]
    [InlineData("/api/v1/finance/invoices")]
    [InlineData("/api/v1/finance/invoices/{0}/credit-notes")]
    [InlineData("/api/v1/finance/payments")]
    public async Task LegacyFinanceWritesAreGoneWithTheirCode(string route)
    {
        var stub = new Stub();
        await using var app = App(stub);
        var ct = TestContext.Current.CancellationToken;
        var path = string.Format(System.Globalization.CultureInfo.InvariantCulture, route, Guid.NewGuid());
        var body = new { preinvoiceId = Guid.NewGuid(), invoiceId = Guid.NewGuid(), requestId = Guid.NewGuid(), amount = 10m,
            reference = "LEGACY-1", reason = "Legacy client" };
        using (var anonymous = await app.CreateClient().PostAsJsonAsync(path, body, ct))
            Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        using var client = Authorized(app);
        using var response = await client.PostAsJsonAsync(path, body, ct);
        Assert.Equal(HttpStatusCode.Gone, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal("legacy_finance_route_retired", await CodeAsync(response, ct));
        Assert.Empty(stub.Calls);
    }

    [Theory]
    [InlineData("GET", "/api/v1/finance/preinvoices?stationId={0}")]
    [InlineData("POST", "/api/v1/finance/preinvoices")]
    [InlineData("GET", "/api/v1/finance/preinvoices/{0}")]
    [InlineData("POST", "/api/v1/finance/preinvoices/{0}/submit")]
    [InlineData("GET", "/api/v1/finance/preinvoices/{0}/disputes")]
    [InlineData("POST", "/api/v1/finance/preinvoices/{0}/resolution")]
    [InlineData("PUT", "/api/v1/finance/preinvoices/{0}/lines/{0}")]
    [InlineData("POST", "/api/v1/finance/preinvoices/{0}/adjustments")]
    [InlineData("GET", "/api/v1/finance/preinvoices/{0}/calculations")]
    [InlineData("GET", "/api/v1/finance/preinvoices/{0}/taxes")]
    [InlineData("GET", "/api/v1/finance/approved-services?stationId={0}")]
    [InlineData("GET", "/api/v1/finance/reconciliation?stationId={0}")]
    [InlineData("GET", "/api/v1/finance/invoices/by-preinvoice/{0}")]
    [InlineData("GET", "/api/v1/finance/invoices/by-preinvoice/{0}/document")]
    [InlineData("GET", "/api/v1/finance/tax-policies")]
    [InlineData("POST", "/api/v1/finance/tax-policies")]
    [InlineData("GET", "/api/v1/finance/fiscal-documents")]
    [InlineData("POST", "/api/v1/finance/fiscal-documents")]
    [InlineData("POST", "/api/v1/finance/fiscal-xml/validate")]
    public async Task RetiredFinanceModulesAreGone(string method, string route)
    {
        var stub = new Stub();
        await using var app = App(stub);
        using var client = Authorized(app);
        using var request = new HttpRequestMessage(new HttpMethod(method),
            string.Format(System.Globalization.CultureInfo.InvariantCulture, route, Guid.NewGuid()));
        if (method != "GET") request.Content = JsonContent.Create(new { requestId = Guid.NewGuid() });
        using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Empty(stub.Calls);
    }

    [Fact]
    public async Task TheContractPublishesHomeAndForgetsTheRetiredOperations()
    {
        await using var app = App(new Stub());
        using var client = app.CreateClient();
        var ct = TestContext.Current.CancellationToken;
        using var swagger = await client.GetAsync("/swagger/v1/swagger.json", ct);
        swagger.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await swagger.Content.ReadAsStringAsync(ct));
        var paths = json.RootElement.GetProperty("paths");
        Assert.Equal("GetFinanceHome", paths.GetProperty("/api/v1/finance/home").GetProperty("get")
            .GetProperty("operationId").GetString());
        var operations = paths.EnumerateObject().SelectMany(path => path.Value.EnumerateObject())
            .Where(operation => operation.Value.ValueKind == JsonValueKind.Object &&
                operation.Value.TryGetProperty("operationId", out _))
            .Select(operation => operation.Value.GetProperty("operationId").GetString()).ToHashSet(StringComparer.Ordinal);
        foreach (var retired in new[]
                 {
                     "ListFinancePreinvoices", "CreatePreinvoiceDraft", "GetPreinvoiceDraft", "SubmitPreinvoice",
                     "GetFinancePreinvoiceDisputes", "ResolveFinancePreinvoiceDispute", "EditFinancePreinvoiceLine",
                     "AddFinancePreinvoiceAdjustment", "GetFinanceApprovedServices", "ListFinanceReconciliation",
                     "GetFinanceInvoiceByPreinvoice", "ListFinanceTaxPolicies", "GetAirlinePreinvoices",
                     "AcceptAirlinePreinvoice", "DisputeAirlinePreinvoice",
                 })
            Assert.DoesNotContain(retired, operations);
        Assert.Contains("ListFinanceInvoices", operations);
    }

    [Fact]
    public async Task HomeCodesItsRefusalsAndKeepsEverySection()
    {
        var stub = new Stub();
        await using var app = App(stub);
        using var client = Authorized(app);
        var ct = TestContext.Current.CancellationToken;
        foreach (var query in new[] { "", "?stationId=nope", $"?stationId={Guid.Empty}" })
        {
            using var invalid = await client.GetAsync($"/api/v1/finance/home{query}", ct);
            Assert.Equal((HttpStatusCode.BadRequest, "invalid_finance_home_query"), (invalid.StatusCode, await CodeAsync(invalid, ct)));
        }
        Assert.Empty(stub.Calls);
        using (var forbidden = await client.GetAsync($"/api/v1/finance/home?stationId={Guid.NewGuid()}", ct))
            Assert.Equal((HttpStatusCode.Forbidden, "forbidden"), (forbidden.StatusCode, await CodeAsync(forbidden, ct)));

        using var ok = await client.GetAsync($"/api/v1/finance/home?stationId={Station}", ct);
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.Contains("no-store", ok.Headers.CacheControl?.ToString());
        using var body = JsonDocument.Parse(await ok.Content.ReadAsStringAsync(ct));
        var root = body.RootElement;
        Assert.Equal(["businessDate", "cardCollectionsThisMonth", "chartersAwaitingPrepayment", "invoicedThisMonth",
                "pendingContractApprovals", "receivables", "stationId", "toInvoice"],
            root.EnumerateObject().Select(property => property.Name).Order(StringComparer.Ordinal).ToArray());
        Assert.Equal("2026-10-31", root.GetProperty("businessDate").GetString());
        Assert.Equal(3, root.GetProperty("toInvoice").GetProperty("operations").GetInt32());
        Assert.Equal("2026-10-02", root.GetProperty("toInvoice").GetProperty("oldestOperationDate").GetString());
        var receivable = Assert.Single(root.GetProperty("receivables").EnumerateArray());
        Assert.Equal(["currencyCode", "open", "openInvoices", "overdue", "overdueInvoices"],
            receivable.EnumerateObject().Select(property => property.Name).Order(StringComparer.Ordinal).ToArray());
        // A module outside the template is a null section, never a missing key.
        Assert.Equal(JsonValueKind.Null, root.GetProperty("cardCollectionsThisMonth").ValueKind);
        Assert.Equal(JsonValueKind.Null, root.GetProperty("chartersAwaitingPrepayment").ValueKind);
        Assert.Equal(2, root.GetProperty("pendingContractApprovals").GetInt32());
    }

    [Fact]
    public async Task InvoicesAreSearchedPagedAndCodeTheirRefusals()
    {
        var stub = new Stub();
        await using var app = App(stub);
        using var client = Authorized(app);
        var ct = TestContext.Current.CancellationToken;
        foreach (var query in new[] { "?page=0", "?limit=0", "?limit=101", "?stationId=nope", "?page=nope",
                     "?search=" + new string('E', 41) })
        {
            using var invalid = await client.GetAsync($"/api/v1/finance/invoices{query}", ct);
            Assert.Equal((HttpStatusCode.BadRequest, "invalid_invoice_query"), (invalid.StatusCode, await CodeAsync(invalid, ct)));
        }
        Assert.Empty(stub.Calls);
        using (var ok = await client.GetAsync($"/api/v1/finance/invoices?stationId={Station}&page=2&limit=25&search=%20%20E31%20", ct))
            Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.Equal(("E31", 2, 25), (stub.Search, stub.Page, stub.Limit));
        using (var blank = await client.GetAsync($"/api/v1/finance/invoices?stationId={Station}&search=%20%20", ct))
            Assert.Equal(HttpStatusCode.OK, blank.StatusCode);
        Assert.Null(stub.Search);
        using (var forbidden = await client.GetAsync($"/api/v1/finance/invoices?stationId={Guid.NewGuid()}", ct))
            Assert.Equal((HttpStatusCode.Forbidden, "forbidden"), (forbidden.StatusCode, await CodeAsync(forbidden, ct)));
        using (var missing = await client.GetAsync($"/api/v1/finance/invoices/{Guid.NewGuid()}", ct))
            Assert.Equal((HttpStatusCode.NotFound, "not_found"), (missing.StatusCode, await CodeAsync(missing, ct)));
    }

    [Fact]
    public async Task ReportsListTheSixAndCodeEveryRefusal()
    {
        var stub = new Stub();
        await using var app = App(stub);
        using var client = Authorized(app);
        var ct = TestContext.Current.CancellationToken;
        using (var list = await client.GetAsync("/api/v1/finance/reports", ct))
        {
            using var json = JsonDocument.Parse(await list.Content.ReadAsStringAsync(ct));
            Assert.Equal(["revenue", "receivables", "collections", "payables", "charges", "sales"],
                json.RootElement.EnumerateArray().Select(item => item.GetProperty("key").GetString()!).ToArray());
        }
        const string period = "from=2026-11-01&to=2026-11-05";
        foreach (var retired in new[] { "pipeline", "disputes", "fiscal", "fiscal-simulation", "credit-notes" })
        {
            using var unknown = await client.GetAsync($"/api/v1/finance/reports/{retired}?{period}", ct);
            Assert.Equal((HttpStatusCode.BadRequest, "unknown_finance_report"), (unknown.StatusCode, await CodeAsync(unknown, ct)));
            using var export = await client.GetAsync($"/api/v1/finance/reports/{retired}/export?format=csv&{period}", ct);
            Assert.Equal((HttpStatusCode.BadRequest, "unknown_finance_report"), (export.StatusCode, await CodeAsync(export, ct)));
        }
        using (var format = await client.GetAsync($"/api/v1/finance/reports/sales/export?format=docx&{period}", ct))
            Assert.Equal((HttpStatusCode.BadRequest, "invalid_report_export_format"), (format.StatusCode, await CodeAsync(format, ct)));
        foreach (var query in new[] { "from=2026-11-05&to=2026-11-01", "from=2026-11-01", "from=nope&to=2026-11-05",
                     $"{period}&currency=EUR", "from=2024-01-01&to=2026-11-05" })
        {
            using var invalid = await client.GetAsync($"/api/v1/finance/reports/sales?{query}", ct);
            Assert.Equal((HttpStatusCode.BadRequest, "invalid_report_query"), (invalid.StatusCode, await CodeAsync(invalid, ct)));
        }
        Assert.Empty(stub.Calls);
        using (var forbidden = await client.GetAsync($"/api/v1/finance/reports/sales?{period}", ct))
            Assert.Equal((HttpStatusCode.Forbidden, "forbidden"), (forbidden.StatusCode, await CodeAsync(forbidden, ct)));
    }

    private static async Task<string?> CodeAsync(HttpResponseMessage response, CancellationToken ct)
    {
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        return json.RootElement.TryGetProperty("code", out var code) ? code.GetString() : null;
    }

    private WebApplicationFactory<Program> App(Stub stub) => factory.WithWebHostBuilder(builder =>
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IActorContextResolver>();
            services.RemoveAll<IFinanceHomeStore>();
            services.RemoveAll<IFinanceInvoiceLedgerStore>();
            services.RemoveAll<IFinanceReportStore>();
            services.RemoveAll<INonFiscalPaymentReadStore>();
            services.AddSingleton<IActorContextResolver>(stub);
            services.AddSingleton<IFinanceHomeStore>(stub);
            services.AddSingleton<IFinanceInvoiceLedgerStore>(stub);
            services.AddSingleton<IFinanceReportStore>(stub);
            services.AddSingleton<INonFiscalPaymentReadStore>(stub);
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

    /// <summary>An account holding every Finance code; the stores record each call and answer for <see cref="Station"/> only.</summary>
    private sealed class Stub : IActorContextResolver, IFinanceHomeStore, IFinanceInvoiceLedgerStore, IFinanceReportStore,
        INonFiscalPaymentReadStore
    {
        public List<string> Calls { get; } = [];
        public string? Search { get; private set; }
        public int Page { get; private set; }
        public int Limit { get; private set; }

        public Task<ActorContext?> ResolveAsync(Guid accountId, CancellationToken cancellationToken = default) =>
            Task.FromResult<ActorContext?>(new ActorContext(Account, "finance@dev.elevant.test", "Finance",
                [new ActorRole(Guid.NewGuid(), "FINANZAS", "Finance", PortalKind.BackOffice, "finance")],
                [new ActorMembership(Guid.NewGuid(), Guid.NewGuid(), "AVIAM", "AVIAM", OrganizationType.AviamOperator,
                    MembershipKind.InternalStaff)],
                [new ActorStationScope(Station, "PUJ")],
                new DepartmentAccess(DepartmentAssignmentKind.Administrator, Department.Finance,
                    Elevant.Domain.Governance.DepartmentPermissionCatalog.CodesOf(Department.Finance).ToHashSet(StringComparer.Ordinal))));

        Task<FinanceHomeData?> IFinanceHomeStore.GetAsync(Guid actorId, Guid stationId, CancellationToken cancellationToken)
        {
            Calls.Add("home");
            return Task.FromResult(stationId != Station ? null : new FinanceHomeData(stationId, new DateOnly(2026, 10, 31),
                new FinanceHomeToInvoiceData(3, 2, new DateOnly(2026, 10, 2)), [new FinanceHomeAmountData("USD", 1, 118m)],
                [new FinanceHomeReceivableData("USD", 1, 118m, 0, 0m)], null, 2, null));
        }

        public Task<FinanceInvoicePageData?> ListAsync(Guid actorId, Guid? stationId, Guid? airlineId, string? status, int page,
            int limit, string? search = null, CancellationToken cancellationToken = default)
        {
            Calls.Add("list");
            (Search, Page, Limit) = (search, page, limit);
            return Task.FromResult(stationId is { } requested && requested != Station ? null
                : new FinanceInvoicePageData(page, limit, false, []));
        }

        public Task<FinanceInvoiceDetailData?> GetAsync(Guid actorId, Guid invoiceId, CancellationToken cancellationToken = default)
        {
            Calls.Add("invoice");
            return Task.FromResult<FinanceInvoiceDetailData?>(null);
        }

        public Task<AirlineInvoiceStatementData?> GetStatementForAirlineAsync(Guid organizationId, Guid invoiceId,
            CancellationToken cancellationToken = default)
        {
            Calls.Add("statement");
            return Task.FromResult<AirlineInvoiceStatementData?>(null);
        }

        public Task<FinanceReportData?> GetAsync(Guid actorId, string reportKey, FinanceReportFilter filter,
            CancellationToken cancellationToken = default)
        {
            Calls.Add("report");
            return Task.FromResult<FinanceReportData?>(null);
        }

        public Task<NonFiscalPaymentLookupData?> GetForFinanceAsync(Guid accountId, Guid invoiceId,
            CancellationToken cancellationToken = default)
        {
            Calls.Add("payment");
            return Task.FromResult<NonFiscalPaymentLookupData?>(null);
        }

        public Task<NonFiscalPaymentLookupData?> GetForAirlineAsync(Guid organizationId, Guid invoiceId,
            CancellationToken cancellationToken = default)
        {
            Calls.Add("airline-payment");
            return Task.FromResult<NonFiscalPaymentLookupData?>(null);
        }
    }
}
