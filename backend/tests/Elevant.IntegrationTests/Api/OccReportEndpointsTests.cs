using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Elevant.Application.Abstractions.Operations;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

public sealed class OccReportEndpointsTests(ElevantApiFactory factory) : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid OccAccountId = Guid.Parse("40000000-0000-7000-8000-000000000001");
    private static readonly Guid StationId = Guid.Parse("20000000-0000-7000-8000-000000000001");

    [Fact]
    public async Task ReportsNeedAuthenticationAndAValidPeriod()
    {
        var ct = TestContext.Current.CancellationToken;
        using var anonymous = await factory.CreateClient().GetAsync("/api/v1/occ/reports", ct);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);

        using var client = Client(new Stub());
        using var catalog = await client.GetAsync("/api/v1/occ/reports", ct);
        catalog.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await catalog.Content.ReadAsStringAsync(ct));
        Assert.Equal(6, json.RootElement.GetProperty("reports").GetArrayLength());
        using var unknown = await client.GetAsync($"/api/v1/occ/reports/sla?stationId={StationId}&from=2026-08-01&to=2026-08-31", ct);
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        Assert.Equal("report_not_found", await CodeAsync(unknown, ct));
        using var unknownExport = await client.GetAsync($"/api/v1/occ/reports/sla/export?stationId={StationId}&from=2026-08-01&to=2026-08-31&format=pdf", ct);
        Assert.Equal("report_not_found", await CodeAsync(unknownExport, ct));
        using var inverted = await client.GetAsync($"/api/v1/occ/reports/operations?stationId={StationId}&from=2026-09-01&to=2026-08-01", ct);
        Assert.Equal(HttpStatusCode.BadRequest, inverted.StatusCode);
        Assert.Equal("invalid_report_query", await CodeAsync(inverted, ct));
        using var format = await client.GetAsync($"/api/v1/occ/reports/operations/export?stationId={StationId}&from=2026-08-01&to=2026-08-31&format=docx", ct);
        Assert.Equal(HttpStatusCode.BadRequest, format.StatusCode);
        Assert.Equal("invalid_report_query", await CodeAsync(format, ct));
        // A missing station or a malformed date fails in model binding: the same code, never the uncoded framework problem.
        using var missingStation = await client.GetAsync("/api/v1/occ/reports/operations?from=2026-08-01&to=2026-08-31", ct);
        Assert.Equal(HttpStatusCode.BadRequest, missingStation.StatusCode);
        Assert.Equal("invalid_report_query", await CodeAsync(missingStation, ct));
        using var malformedDate = await client.GetAsync($"/api/v1/occ/reports/operations/export?stationId={StationId}&from=agosto&to=2026-08-31&format=csv", ct);
        Assert.Equal(HttpStatusCode.BadRequest, malformedDate.StatusCode);
        Assert.Equal("invalid_report_query", await CodeAsync(malformedDate, ct));
    }

    [Fact]
    public async Task StationAndPermissionFailuresAreCodedButAPermissionStaysBare()
    {
        var ct = TestContext.Current.CancellationToken;
        using var missing = Client(new Stub { ReadFailure = OccReportFailure.StationNotFound });
        using var page = await missing.GetAsync($"/api/v1/occ/reports/operations?stationId={StationId}&from=2026-08-01&to=2026-08-31", ct);
        Assert.Equal(HttpStatusCode.NotFound, page.StatusCode);
        Assert.Equal("station_unavailable", await CodeAsync(page, ct));
        using var file = await missing.GetAsync($"/api/v1/occ/reports/operations/export?stationId={StationId}&from=2026-08-01&to=2026-08-31&format=xlsx", ct);
        Assert.Equal(HttpStatusCode.NotFound, file.StatusCode);
        Assert.Equal("station_unavailable", await CodeAsync(file, ct));

        using var forbidden = Client(new Stub { ReadFailure = OccReportFailure.Forbidden });
        using var refused = await forbidden.GetAsync($"/api/v1/occ/reports/operations?stationId={StationId}&from=2026-08-01&to=2026-08-31", ct);
        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
        Assert.Null(await CodeAsync(refused, ct));
    }

    [Theory]
    [InlineData("csv", "text/csv")]
    [InlineData("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")]
    [InlineData("pdf", "application/pdf")]
    public async Task ExportsTheWholePeriodAndAuditsIt(string format, string contentType)
    {
        var ct = TestContext.Current.CancellationToken;
        var stub = new Stub();
        using var client = Client(stub);
        using var page = await client.GetAsync($"/api/v1/occ/reports/operations?stationId={StationId}&from=2026-08-01&to=2026-08-31&limit=10", ct);
        page.EnsureSuccessStatusCode();
        using (var json = JsonDocument.Parse(await page.Content.ReadAsStringAsync(ct)))
            Assert.Equal("PUJ", json.RootElement.GetProperty("stationCode").GetString());
        Assert.Equal(10, stub.LastLimit);

        using var file = await client.GetAsync($"/api/v1/occ/reports/operations/export?stationId={StationId}&from=2026-08-01&to=2026-08-31&format={format}", ct);
        file.EnsureSuccessStatusCode();
        Assert.Equal(contentType, file.Content.Headers.ContentType!.MediaType);
        Assert.Equal($"elevant-occ-operations-PUJ-20260801-20260831.{format}", file.Content.Headers.ContentDisposition!.FileNameStar);
        // The export reads the whole period in one page as large as the format allows (3-N13).
        Assert.Equal(format == "pdf" ? OccReportCatalog.MaxPdfExportRows : OccReportCatalog.MaxExportRows, stub.LastLimit);
        Assert.Equal((format, 1), stub.Exported);
    }

    [Theory]
    [InlineData("csv")]
    [InlineData("xlsx")]
    [InlineData("pdf")]
    public async Task AnExportOverItsRowLimitIsRefusedWithoutAFileOrAnAudit(string format)
    {
        var ct = TestContext.Current.CancellationToken;
        var stub = new Stub { HasMore = true };
        using var client = Client(stub);
        using var file = await client.GetAsync($"/api/v1/occ/reports/operations/export?stationId={StationId}&from=2026-01-01&to=2026-12-31&format={format}", ct);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, file.StatusCode);
        Assert.Equal("application/problem+json", file.Content.Headers.ContentType!.MediaType);
        Assert.Null(file.Content.Headers.ContentDisposition);
        Assert.Equal("report_too_large", await CodeAsync(file, ct));
        Assert.Null(stub.Exported);
    }

    [Fact]
    public async Task ExportWithoutTheExportOptionReturnsNoFile()
    {
        var ct = TestContext.Current.CancellationToken;
        using var client = Client(new Stub { ExportFailure = OccReportFailure.Forbidden });
        using var file = await client.GetAsync($"/api/v1/occ/reports/operations/export?stationId={StationId}&from=2026-08-01&to=2026-08-31&format=pdf", ct);
        Assert.Equal(HttpStatusCode.Forbidden, file.StatusCode);
        Assert.Equal("application/problem+json", file.Content.Headers.ContentType!.MediaType);
    }

    private static async Task<string?> CodeAsync(HttpResponseMessage response, CancellationToken ct)
    {
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        return json.RootElement.TryGetProperty("code", out var code) ? code.GetString() : null;
    }

    private HttpClient Client(Stub stub)
    {
        var application = factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IOccReportStore>();
            services.AddSingleton<IOccReportStore>(stub);
        }));
        var client = application.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());
        return client;
    }

    private static string Token()
    {
        var now = DateTimeOffset.UtcNow;
        return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Audience = ElevantApiFactory.AuthenticationAudience, Expires = now.AddMinutes(15).UtcDateTime,
            IssuedAt = now.UtcDateTime, Issuer = ElevantApiFactory.AuthenticationIssuer, NotBefore = now.AddSeconds(-5).UtcDateTime,
            SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(
                Convert.FromBase64String(ElevantApiFactory.AuthenticationSigningKeyBase64)), SecurityAlgorithms.HmacSha256),
            Subject = new System.Security.Claims.ClaimsIdentity(
            [
                new System.Security.Claims.Claim(JwtRegisteredClaimNames.Sub, OccAccountId.ToString("D")),
                new System.Security.Claims.Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("D")),
                new System.Security.Claims.Claim(Elevant.Infrastructure.Authentication.SessionSecurityVersion.ClaimType,
                    Elevant.Infrastructure.Authentication.SessionSecurityVersion.Fingerprint(ElevantApiFactory.TestSecurityStamp)),
            ]),
            TokenType = "at+jwt",
        });
    }

    private sealed class Stub : IOccReportStore
    {
        public int LastLimit { get; private set; }
        public (string Format, int Rows)? Exported { get; private set; }
        public OccReportFailure? ExportFailure { get; init; }
        public OccReportFailure? ReadFailure { get; init; }
        public bool HasMore { get; init; }

        public Task<OccReportResult> ReadAsync(Guid actorId, OccReportKind kind, Guid stationId, DateOnly from, DateOnly to,
            int page, int limit, CancellationToken cancellationToken = default)
        {
            LastLimit = limit;
            if (ReadFailure is { } failure) return Task.FromResult(new OccReportResult(null, failure));
            var definition = OccReportCatalog.All.Single(item => item.Kind == kind);
            IReadOnlyList<OccReportCell> row = definition.Columns.Select(column => new OccReportCell(column)).ToArray();
            return Task.FromResult(new OccReportResult(new OccReportTable(definition, stationId, "PUJ", from, to,
                DateTimeOffset.UtcNow, [row], page, limit, HasMore), null));
        }

        public Task<OccReportFailure?> RecordExportAsync(Guid actorId, OccReportKind kind, Guid stationId, DateOnly from,
            DateOnly to, string format, int rows, CancellationToken cancellationToken = default)
        {
            if (ExportFailure is null) Exported = (format, rows);
            return Task.FromResult(ExportFailure);
        }
    }
}
