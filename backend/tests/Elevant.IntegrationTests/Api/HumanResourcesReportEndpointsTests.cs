using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Elevant.Application.Abstractions.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

public sealed class HumanResourcesReportEndpointsTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000004");
    private static readonly Guid StationId = Guid.Parse("20000000-0000-7000-8000-000000000003");
    private const string Route = "/api/v1/human-resources/reports/expirations";

    [Fact]
    public async Task PageRequiresBearerAndReturnsPrivateTypedRows()
    {
        var state = new StubStore();
        await using var app = Application(state);
        using var anonymous = app.CreateClient();
        using var unauthorized = await anonymous.GetAsync(Query(), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, unauthorized.StatusCode);

        using var client = Authenticated(app);
        using var response = await client.GetAsync(Query(), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        AssertPrivate(response);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>(
            TestContext.Current.CancellationToken);
        Assert.Equal(StationId, json.GetProperty("stationId").GetGuid());
        Assert.Equal("GPU", json.GetProperty("rows")[0].GetProperty("code").GetString());
    }

    [Fact]
    public async Task ScopeFailuresAndOversizedExportNeverReturnPrivateRows()
    {
        var state = new StubStore { Failure = HumanResourcesReportFailure.ForbiddenStation };
        await using var app = Application(state);
        using var client = Authenticated(app);
        using var missingStation = await client.GetAsync(Query(), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NotFound, missingStation.StatusCode);
        AssertPrivate(missingStation);
        Assert.DoesNotContain("Agente de prueba", await missingStation.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken), StringComparison.Ordinal);

        state.Failure = HumanResourcesReportFailure.ForbiddenRole;
        using var forbidden = await client.GetAsync(Query(), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);

        state.Failure = HumanResourcesReportFailure.TooLarge;
        using var oversized = await client.GetAsync(Export("pdf"), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, oversized.StatusCode);
        AssertPrivate(oversized);
        Assert.NotEqual("application/pdf", oversized.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task ExportsRealPdfAndXlsxWithPrivateHeaders()
    {
        var state = new StubStore();
        await using var app = Application(state);
        using var client = Authenticated(app);
        using var pdf = await client.GetAsync(Export("pdf"), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, pdf.StatusCode);
        Assert.Equal("application/pdf", pdf.Content.Headers.ContentType?.MediaType);
        AssertPrivate(pdf);
        Assert.Equal("nosniff", pdf.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.StartsWith("elevant-gh-expirations-", pdf.Content.Headers.ContentDisposition?.FileName);
        var pdfBytes = await pdf.Content.ReadAsByteArrayAsync(TestContext.Current.CancellationToken);
        Assert.StartsWith("%PDF-", System.Text.Encoding.ASCII.GetString(pdfBytes, 0, 5));

        using var xlsx = await client.GetAsync(Export("xlsx"), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, xlsx.StatusCode);
        Assert.Equal("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            xlsx.Content.Headers.ContentType?.MediaType);
        AssertPrivate(xlsx);
        Assert.Equal("nosniff", xlsx.Headers.GetValues("X-Content-Type-Options").Single());
        var xlsxBytes = await xlsx.Content.ReadAsByteArrayAsync(TestContext.Current.CancellationToken);
        Assert.Equal((byte)'P', xlsxBytes[0]);
        Assert.Equal((byte)'K', xlsxBytes[1]);
        Assert.Equal(2, state.AuditCount);
    }

    [Fact]
    public async Task RevocationAfterSnapshotPreventsFileDelivery()
    {
        var state = new StubStore { AuditFailure = HumanResourcesReportFailure.ForbiddenRole };
        await using var app = Application(state);
        using var client = Authenticated(app);
        using var response = await client.GetAsync(Export("pdf"),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(1, state.AuditCount);
        AssertPrivate(response);
        Assert.NotEqual("application/pdf", response.Content.Headers.ContentType?.MediaType);
    }

    [Theory]
    [InlineData("from=2026-10-01&to=2026-10-31")]
    [InlineData("from=2026-10-30&to=2026-10-01")]
    [InlineData("from=2026-10-01&to=2026-10-30&page=0")]
    [InlineData("from=2026-10-01&to=2026-10-30&documentKind=Unknown")]
    [InlineData("from=2026-10-01&to=2026-10-30&validity=Unknown")]
    public async Task RejectsInvalidQueryBeforeReadingStore(string query)
    {
        var state = new StubStore();
        await using var app = Application(state);
        using var client = Authenticated(app);
        using var response = await client.GetAsync($"{Route}?stationId={StationId}&{query}",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(0, state.ReadCount);
    }

    [Theory]
    [InlineData("account-movements")]
    [InlineData("staff-distribution")]
    [InlineData("qualification-coverage")]
    public async Task OtherReportPagesExposeTypedAuthorizedContract(string kind)
    {
        await using var app = Application(new StubStore());
        using var client = Authenticated(app);
        using var response = await client.GetAsync(
            $"/api/v1/human-resources/reports/{kind}?stationId={StationId}&from=2026-10-01&to=2026-10-30",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        AssertPrivate(response);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(
            TestContext.Current.CancellationToken);
        Assert.Equal(StationId, body.GetProperty("stationId").GetGuid());
        Assert.Equal(JsonValueKind.Array, body.GetProperty("rows").ValueKind);
    }

    [Fact]
    public async Task CoveragePreservesRequestedWindowWhileEvaluatingItsFinalDate()
    {
        await using var app = Application(new StubStore());
        using var client = Authenticated(app);
        using var response = await client.GetAsync(
            $"/api/v1/human-resources/reports/qualification-coverage?stationId={StationId}&from=2026-10-01&to=2026-10-30",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(
            TestContext.Current.CancellationToken);
        Assert.Equal("2026-10-01", body.GetProperty("from").GetString());
        Assert.Equal("2026-10-30", body.GetProperty("to").GetString());
    }

    [Fact]
    public async Task ExpirationFiltersAreEchoedAndForwardedToExport()
    {
        var state = new StubStore();
        await using var app = Application(state);
        using var client = Authenticated(app);
        using var page = await client.GetAsync(
            Query() + "&documentKind=Qualification&validity=Current",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, page.StatusCode);
        var body = await page.Content.ReadFromJsonAsync<JsonElement>(
            TestContext.Current.CancellationToken);
        Assert.Equal("Qualification", body.GetProperty("documentKind").GetString());
        Assert.Equal("Current", body.GetProperty("validity").GetString());
        Assert.Equal("Qualification|Current", state.LastFilters);

        using var export = await client.GetAsync(
            Export("pdf") + "&documentKind=Qualification&validity=Current",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, export.StatusCode);
        Assert.Equal("Qualification|Current", state.LastFilters);
    }

    [Theory]
    [InlineData("bogus", "pdf")]
    [InlineData("expirations", "csv")]
    public async Task ExportRejectsUnknownKindOrFormat(string kind, string format)
    {
        await using var app = Application(new StubStore());
        using var client = Authenticated(app);
        using var response = await client.GetAsync(
            $"/api/v1/human-resources/reports/{kind}/export?stationId={StationId}&from=2026-10-01&to=2026-10-30&format={format}",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        AssertPrivate(response);
    }

    private static string Query() =>
        $"{Route}?stationId={StationId}&from=2026-10-01&to=2026-10-30&page=1&limit=20";

    private static string Export(string format) =>
        $"{Route}/export?stationId={StationId}&from=2026-10-01&to=2026-10-30&format={format}";

    private WebApplicationFactory<Program> Application(StubStore state) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<IHumanResourcesReportStore>();
            services.AddScoped<IHumanResourcesReportStore>(_ => state);
        }));

    private static HttpClient Authenticated(WebApplicationFactory<Program> app)
    {
        var client = app.CreateClient();
        var now = DateTimeOffset.UtcNow;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Bearer", new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
            {
                Audience = ElevantApiFactory.AuthenticationAudience,
                Expires = now.AddMinutes(15).UtcDateTime,
                IssuedAt = now.UtcDateTime,
                Issuer = ElevantApiFactory.AuthenticationIssuer,
                NotBefore = now.AddSeconds(-5).UtcDateTime,
                SigningCredentials = new SigningCredentials(
                    new SymmetricSecurityKey(Convert.FromBase64String(
                        ElevantApiFactory.AuthenticationSigningKeyBase64)),
                    SecurityAlgorithms.HmacSha256),
                Subject = new System.Security.Claims.ClaimsIdentity([
                    new System.Security.Claims.Claim(JwtRegisteredClaimNames.Sub,
                        AccountId.ToString("D")),
                    new System.Security.Claims.Claim(JwtRegisteredClaimNames.Jti,
                        Guid.NewGuid().ToString("D")),
                    new System.Security.Claims.Claim(
                        Elevant.Infrastructure.Authentication.SessionSecurityVersion.ClaimType,
                        Elevant.Infrastructure.Authentication.SessionSecurityVersion.Fingerprint(
                            ElevantApiFactory.TestSecurityStamp)),
                ]),
                TokenType = "at+jwt",
            }));
        return client;
    }

    private static void AssertPrivate(HttpResponseMessage response) =>
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString(),
            StringComparison.Ordinal);

    private sealed class StubStore : IHumanResourcesReportStore
    {
        public HumanResourcesReportFailure? Failure { get; set; }
        public HumanResourcesReportFailure? AuditFailure { get; set; }
        public int ReadCount { get; private set; }
        public int AuditCount { get; private set; }
        public string? LastFilters { get; private set; }

        public Task<HumanResourcesReportFailure?> RecordExportAsync(Guid actorId,
            Guid stationId, HumanResourcesReportKind kind, DateOnly startDate,
            DateOnly endDate, string format, int rowCount,
            string? documentKind = null, string? validity = null,
            CancellationToken cancellationToken = default)
        {
            AuditCount++;
            LastFilters = $"{documentKind}|{validity}";
            Assert.Equal(StationId, stationId);
            Assert.Equal(HumanResourcesReportKind.Expirations, kind);
            Assert.Equal(1, rowCount);
            Assert.True(format is "pdf" or "xlsx");
            return Task.FromResult(AuditFailure);
        }

        public Task<HumanResourcesReportReadResult<HumanResourcesExpirationRow>>
            ListExpirationsAsync(Guid actorId, Guid stationId, DateOnly startDate,
                DateOnly endDate, int page, int limit,
                string? documentKind = null, string? validity = null,
                CancellationToken cancellationToken = default)
        {
            ReadCount++;
            LastFilters = $"{documentKind}|{validity}";
            return Task.FromResult(Failure is HumanResourcesReportFailure failure
                ? new HumanResourcesReportReadResult<HumanResourcesExpirationRow>(null, failure)
                : new HumanResourcesReportReadResult<HumanResourcesExpirationRow>(
                    new HumanResourcesReportPage<HumanResourcesExpirationRow>(stationId,
                        startDate, endDate, page, limit, false, DateTimeOffset.UtcNow,
                        [new(Guid.NewGuid(), Guid.NewGuid(), "Agente de prueba",
                            "DEV-001", "Qualification", "GPU", endDate)]), null));
        }

        public Task<HumanResourcesReportSnapshotResult> ReadSnapshotAsync(Guid actorId,
            Guid stationId, HumanResourcesReportKind kind, DateOnly startDate,
            DateOnly endDate, int maxRows, string? documentKind = null,
            string? validity = null, CancellationToken cancellationToken = default) =>
            Task.FromResult(Failure is HumanResourcesReportFailure failure
                ? new HumanResourcesReportSnapshotResult(null, failure)
                : new HumanResourcesReportSnapshotResult(new HumanResourcesReportSnapshot(
                    kind, stationId, startDate, endDate, DateTimeOffset.UtcNow,
                    ["Agente"], [[new("Agente de prueba", HumanResourcesReportCellType.Text)]])
                    { StationCode = "PUJ", DocumentKind = documentKind,
                        Validity = validity }, null));

        public Task<HumanResourcesReportReadResult<HumanResourcesAccountMovementRow>>
            ListAccountMovementsAsync(Guid actorId, Guid stationId, DateOnly startDate,
                DateOnly endDate, int page, int limit, CancellationToken cancellationToken = default) =>
            Task.FromResult(new HumanResourcesReportReadResult<HumanResourcesAccountMovementRow>(
                new HumanResourcesReportPage<HumanResourcesAccountMovementRow>(stationId,
                    startDate, endDate, page, limit, false, DateTimeOffset.UtcNow, []), null));

        public Task<HumanResourcesReportReadResult<HumanResourcesStaffDistributionRow>>
            ListStaffDistributionAsync(Guid actorId, Guid stationId, DateOnly startDate,
                DateOnly endDate, int page, int limit, CancellationToken cancellationToken = default) =>
            Task.FromResult(new HumanResourcesReportReadResult<HumanResourcesStaffDistributionRow>(
                new HumanResourcesReportPage<HumanResourcesStaffDistributionRow>(stationId,
                    startDate, endDate, page, limit, false, DateTimeOffset.UtcNow, []), null));

        public Task<HumanResourcesReportReadResult<HumanResourcesQualificationCoverageRow>>
            ListQualificationCoverageAsync(Guid actorId, Guid stationId,
                DateOnly startDate, DateOnly reportDate,
                int page, int limit, CancellationToken cancellationToken = default) =>
            Task.FromResult(new HumanResourcesReportReadResult<HumanResourcesQualificationCoverageRow>(
                new HumanResourcesReportPage<HumanResourcesQualificationCoverageRow>(stationId,
                    startDate, reportDate, page, limit, false, DateTimeOffset.UtcNow, []), null));
    }
}
