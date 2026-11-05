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
        using var inverted = await client.GetAsync($"/api/v1/occ/reports/operations?stationId={StationId}&from=2026-09-01&to=2026-08-01", ct);
        Assert.Equal(HttpStatusCode.BadRequest, inverted.StatusCode);
        using var format = await client.GetAsync($"/api/v1/occ/reports/operations/export?stationId={StationId}&from=2026-08-01&to=2026-08-31&format=docx", ct);
        Assert.Equal(HttpStatusCode.BadRequest, format.StatusCode);
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
        Assert.Equal(5000, stub.LastLimit);
        Assert.Equal((format, 1), stub.Exported);
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

        public Task<OccReportResult> ReadAsync(Guid actorId, OccReportKind kind, Guid stationId, DateOnly from, DateOnly to,
            int page, int limit, CancellationToken cancellationToken = default)
        {
            LastLimit = limit;
            var definition = OccReportCatalog.All.Single(item => item.Kind == kind);
            IReadOnlyList<OccReportCell> row = definition.Columns.Select(column => new OccReportCell(column)).ToArray();
            return Task.FromResult(new OccReportResult(new OccReportTable(definition, stationId, "PUJ", from, to,
                DateTimeOffset.UtcNow, [row], page, limit, false), null));
        }

        public Task<OccReportFailure?> RecordExportAsync(Guid actorId, OccReportKind kind, Guid stationId, DateOnly from,
            DateOnly to, string format, int rows, CancellationToken cancellationToken = default)
        {
            if (ExportFailure is null) Exported = (format, rows);
            return Task.FromResult(ExportFailure);
        }
    }
}
