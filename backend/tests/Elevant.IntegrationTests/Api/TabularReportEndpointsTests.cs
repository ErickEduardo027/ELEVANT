using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Documents;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Commercial;
using Elevant.Application.Documents;
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
/// The tabular reports (ADR-0048, «Reportes nuevos») through Contratos: the query is validated against the report
/// before the store is read, a refused account is a bare 403, «Exportar» is checked before reading, every export is
/// audited and the page carries the filters, totals and summary of every row.
/// </summary>
public sealed class TabularReportEndpointsTests(ElevantApiFactory factory) : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid Account = Guid.Parse("40000000-0000-7000-8000-0000000000c1");
    private const string Route = "/api/v1/contracts/reports";

    [Fact]
    public async Task TheCatalogListsTheFourReportsWithTheirFiltersAndPeriods()
    {
        var ct = TestContext.Current.CancellationToken;
        await using var app = App(new Stub());
        using var client = Authorized(app);
        using var response = await client.GetAsync(Route, ct);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        Assert.Equal("Contratos", json.RootElement.GetProperty("area").GetString());
        var reports = json.RootElement.GetProperty("reports").EnumerateArray().ToArray();
        Assert.Equal(["agreements", "rates", "requests", "permits"], reports.Select(item => item.GetProperty("key").GetString()));
        var agreements = reports[0];
        Assert.Equal("asOf", agreements.GetProperty("period").GetString());
        Assert.True(agreements.GetProperty("asOfDate").GetBoolean());
        Assert.False(reports[2].GetProperty("asOfDate").GetBoolean());
        Assert.Equal(366, json.RootElement.GetProperty("maxRangeDays").GetInt32());
        Assert.Equal(["airline", "status", "station", "expiresWithinDays"],
            agreements.GetProperty("filters").EnumerateArray().Select(item => item.GetProperty("key").GetString()));
        Assert.Equal("range", reports[2].GetProperty("period").GetString());
        Assert.Contains("money", reports[1].GetProperty("columnTypes").EnumerateArray().Select(item => item.GetString()));
    }

    [Fact]
    public async Task APageCarriesTheRowsOfThePageAndTheTotalsFiltersAndSummaryOfEveryRow()
    {
        var ct = TestContext.Current.CancellationToken;
        var stub = new Stub { Rows = 3 };
        await using var app = App(stub);
        using var client = Authorized(app);
        var airline = Guid.NewGuid();
        using var response = await client.GetAsync($"{Route}/agreements?airlineId={airline}&status=Active&page=2&limit=2", ct);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString() ?? string.Empty, StringComparison.Ordinal);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        var root = json.RootElement;
        Assert.Equal(3, root.GetProperty("totalRows").GetInt32());
        Assert.False(root.GetProperty("hasMore").GetBoolean());
        Assert.Single(root.GetProperty("rows").EnumerateArray());
        Assert.Equal("Contrato 3", root.GetProperty("rows")[0][0].GetProperty("value").GetString());
        Assert.Equal("number", root.GetProperty("rows")[0][1].GetProperty("type").GetString());
        Assert.Equal("6", root.GetProperty("totals")[0].GetProperty("cells")[1].GetProperty("value").GetString());
        Assert.Equal("Ana Pérez", root.GetProperty("generatedBy").GetString());
        Assert.Equal("Aerolínea", root.GetProperty("appliedFilters")[0].GetProperty("label").GetString());
        Assert.Equal("de 3 contratos", root.GetProperty("summary")[0].GetProperty("context").GetString());
        Assert.Equal(airline.ToString("D"), stub.LastQuery!.Text("airline"));
        Assert.Equal("Active", stub.LastQuery.Text("status"));
    }

    [Theory]
    [InlineData("/agreements?unknown=1")]
    [InlineData("/agreements?status=Unknown")]
    [InlineData("/agreements?airlineId=00000000-0000-0000-0000-000000000000")]
    [InlineData("/agreements?airlineId=abc")]
    [InlineData("/agreements?to=2026-13-01")]
    [InlineData("/agreements?expiresWithinDays=0")]
    [InlineData("/agreements?page=0")]
    [InlineData("/agreements?limit=101")]
    [InlineData("/requests")]
    [InlineData("/requests?from=2026-10-31&to=2026-10-01")]
    [InlineData("/requests?from=2025-01-01&to=2026-10-31")]
    [InlineData("/requests?from=octubre&to=2026-10-31")]
    [InlineData("/rates?status=Active")]
    [InlineData("/agreements/export?format=docx")]
    [InlineData("/agreements/export")]
    public async Task AnInvalidQueryIsCodedBeforeTheStoreIsRead(string path)
    {
        var ct = TestContext.Current.CancellationToken;
        var stub = new Stub();
        await using var app = App(stub);
        using var client = Authorized(app);
        using var response = await client.GetAsync(Route + path, ct);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("invalid_report_query", await CodeAsync(response, ct));
        Assert.Equal(0, stub.Reads);
    }

    [Fact]
    public async Task AnUnknownReportIsNotFoundAndAnonymousCallsAreUnauthorized()
    {
        var ct = TestContext.Current.CancellationToken;
        var stub = new Stub();
        await using var app = App(stub);
        using var client = Authorized(app);
        using var missing = await client.GetAsync($"{Route}/salaries", ct);
        Assert.Equal((HttpStatusCode.NotFound, "report_not_found"), (missing.StatusCode, await CodeAsync(missing, ct)));
        using var anonymous = app.CreateClient();
        using var unauthorized = await anonymous.GetAsync($"{Route}/agreements", ct);
        Assert.Equal(HttpStatusCode.Unauthorized, unauthorized.StatusCode);
        Assert.Equal(0, stub.Reads);
    }

    [Fact]
    public async Task AnAccountWithoutThePermissionIsABare403AndNothingIsExported()
    {
        var ct = TestContext.Current.CancellationToken;
        var stub = new Stub { Refused = true };
        await using var app = App(stub);
        using var client = Authorized(app);
        using var page = await client.GetAsync($"{Route}/permits", ct);
        Assert.Equal(HttpStatusCode.Forbidden, page.StatusCode);
        Assert.Null(await CodeAsync(page, ct));
        using var export = await client.GetAsync($"{Route}/permits/export?format=xlsx", ct);
        Assert.Equal(HttpStatusCode.Forbidden, export.StatusCode);
        Assert.Equal(1, stub.Reads);
        Assert.Empty(stub.Audits);
    }

    [Theory]
    [InlineData("pdf", "application/pdf", "%PDF-")]
    [InlineData("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "PK")]
    [InlineData("csv", "text/csv", "﻿Contrato")]
    public async Task ExportsRenderEveryRowAndAreAudited(string format, string contentType, string start)
    {
        var ct = TestContext.Current.CancellationToken;
        var stub = new Stub { Rows = 3 };
        await using var app = App(stub);
        using var client = Authorized(app);
        using var response = await client.GetAsync(
            $"{Route}/requests/export?format={format}&from=2026-10-01&to=2026-10-31&status=Approved", ct);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(contentType, response.Content.Headers.ContentType?.MediaType);
        Assert.Equal($"elevant-contratos-requests-20261001-20261031.{format}",
            response.Content.Headers.ContentDisposition?.FileName?.Trim('"'));
        var bytes = await response.Content.ReadAsByteArrayAsync(ct);
        Assert.StartsWith(start, System.Text.Encoding.UTF8.GetString(bytes, 0, Math.Min(bytes.Length, 20)), StringComparison.Ordinal);
        var audit = Assert.Single(stub.Audits);
        Assert.Equal(("contracts", "requests", format, 3, "Approved"), (audit.Area, audit.Key, audit.Format, audit.Rows,
            audit.Query.Text("status")));
    }

    [Fact]
    public async Task AnExportOverItsRowLimitIs422AndIsNotAudited()
    {
        var ct = TestContext.Current.CancellationToken;
        var stub = new Stub { Rows = 5001 };
        await using var app = App(stub);
        using var client = Authorized(app);
        using var response = await client.GetAsync($"{Route}/rates/export?format=pdf", ct);
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "report_too_large"), (response.StatusCode, await CodeAsync(response, ct)));
        Assert.Empty(stub.Audits);
    }

    private static async Task<string?> CodeAsync(HttpResponseMessage response, CancellationToken ct)
    {
        var text = await response.Content.ReadAsStringAsync(ct);
        if (string.IsNullOrWhiteSpace(text)) return null;
        using var json = JsonDocument.Parse(text);
        return json.RootElement.TryGetProperty("code", out var code) ? code.GetString() : null;
    }

    private WebApplicationFactory<Program> App(Stub stub) => factory.WithWebHostBuilder(builder =>
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IActorContextResolver>();
            services.RemoveAll<IContractsReportStore>();
            services.RemoveAll<IReportExportAudit>();
            services.AddSingleton<IActorContextResolver>(stub);
            services.AddSingleton<IContractsReportStore>(stub);
            services.AddSingleton<IReportExportAudit>(stub);
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

    private sealed record AuditCall(string Area, string Key, string Format, TabularReportQuery Query, int Rows);

    /// <summary>A store answering a synthetic report of <see cref="Rows"/> rows, or refusing every account.</summary>
    private sealed class Stub : IActorContextResolver, IContractsReportStore, IReportExportAudit
    {
        public int Rows { get; init; } = 1;
        public bool Refused { get; init; }
        public int Reads { get; private set; }
        public TabularReportQuery? LastQuery { get; private set; }
        public List<AuditCall> Audits { get; } = [];

        public Task<ActorContext?> ResolveAsync(Guid accountId, CancellationToken cancellationToken = default) =>
            Task.FromResult<ActorContext?>(new ActorContext(Account, "contratos@dev.elevant.test", "Ana Pérez", [], [], []));

        public IReadOnlyList<TabularReportDefinition> Catalog => ContractsReportCatalog.All;

        public Task<TabularReportFailure?> AuthorizeExportAsync(Guid actorId, CancellationToken cancellationToken = default) =>
            Task.FromResult<TabularReportFailure?>(Refused ? TabularReportFailure.Forbidden : null);

        public Task<TabularReportResult> ReadAsync(Guid actorId, TabularReportDefinition definition, TabularReportQuery query,
            CancellationToken cancellationToken = default)
        {
            Reads++;
            LastQuery = query;
            if (Refused) return Task.FromResult(TabularReportResult.Failed(TabularReportFailure.Forbidden));
            var columns = new[] { ReportColumn.Text("Contrato"), ReportColumn.Number("Tarifas", summable: true) };
            var rows = Enumerable.Range(1, Rows).Select(index =>
                (IReadOnlyList<ReportCell>)[ReportCell.Of($"Contrato {index}"), ReportCell.Value(index)]).ToArray();
            return Task.FromResult(TabularReportResult.Of(new ReportDocument("Contratos", definition.Title, columns, rows)
            {
                Filters = [new ReportFilter("Aerolínea", "Arajet")],
                Summary = [new ReportMetric("Contratos", "3", "de 3 contratos")],
            }));
        }

        public Task RecordAsync(Guid actorId, string area, string reportKey, string format, TabularReportQuery query, int rows,
            CancellationToken cancellationToken = default)
        {
            Audits.Add(new AuditCall(area, reportKey, format, query, rows));
            return Task.CompletedTask;
        }
    }
}
