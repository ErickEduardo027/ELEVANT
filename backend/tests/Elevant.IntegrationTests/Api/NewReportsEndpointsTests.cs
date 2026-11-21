using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Documents;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
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
/// The new reports of ADR-0048 («Reportes nuevos») through the API with their real sources: the airline portal only
/// ever reads the session's airline, the statement of account of Finance needs its permission, and Gestión Humana
/// checks «Exportar» before reading anything.
/// </summary>
public sealed class NewReportsEndpointsTests(ElevantApiFactory factory) : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid Account = Guid.Parse("40000000-0000-7000-8000-0000000000c3");
    private static readonly Guid Organization = Guid.NewGuid();
    private static readonly Guid OwnStation = Guid.NewGuid();
    private static readonly Guid Invoice = Guid.NewGuid();
    private static readonly Guid OtherInvoice = Guid.NewGuid();

    private sealed class State
    {
        public ActorContext? Actor { get; set; }
        public List<Guid> Organizations { get; } = [];
        public List<(string Area, string Key, string Format)> Audits { get; } = [];
        public object? Treasury { get; set; }
        public object? Portal { get; set; }
        public object? Governance { get; set; }
    }

    private static ActorContext AirlineActor(params Guid[] organizations) => new(Account, "ops@arajet.test", "Laura Gómez",
        [new ActorRole(Guid.NewGuid(), "AIRLINE_CLIENT", "Aerolínea", PortalKind.AirlinePortal, "airline")],
        organizations.Select(id => new ActorMembership(Guid.NewGuid(), id, "DM", "Arajet", OrganizationType.AirlineCustomer,
            MembershipKind.AirlineClient)).ToArray(), []);

    private static ActorContext InternalActor(Department department, params string[] permissions) => new(Account,
        "staff@aviam.test", "Ana Pérez", [new ActorRole(Guid.NewGuid(), "STAFF", "Staff", PortalKind.BackOffice, "internal")],
        [new ActorMembership(Guid.NewGuid(), Guid.NewGuid(), "AVIAM", "AVIAM", OrganizationType.AviamOperator,
            MembershipKind.InternalStaff)],
        [new ActorStationScope(OwnStation, "PUJ")],
        new DepartmentAccess(DepartmentAssignmentKind.Member, department, permissions.ToHashSet(StringComparer.Ordinal)));

    private static AirlineTreasuryStatementData PortalStatement(DateOnly asOf) => new(Guid.NewGuid(), asOf,
        [
            new AirlineTreasuryInvoiceData(Invoice, Guid.NewGuid(), "NF-1", OwnStation, "PUJ", "USD", 1180m, 0m, 0m, 1180m, 0m,
                0m, 0m, new DateOnly(2026, 10, 30), 0, "Current", "E310000000001"),
            new AirlineTreasuryInvoiceData(OtherInvoice, Guid.NewGuid(), "NF-2", OwnStation, "PUJ", "USD", 590m, 0m, 0m, 0m, 0m,
                0m, 590m, new DateOnly(2026, 10, 15), 20, "1-30", "E310000000002"),
        ], [],
        [
            new AirlineTreasuryMovementData(Invoice, null, Invoice, "Invoice", "USD", 1180m, new DateOnly(2026, 10, 1),
                DateTimeOffset.UtcNow, null, "E310000000001"),
            new AirlineTreasuryMovementData(OtherInvoice, null, OtherInvoice, "Invoice", "USD", 590m, new DateOnly(2026, 9, 15),
                DateTimeOffset.UtcNow, null, "E310000000002"),
            new AirlineTreasuryMovementData(Guid.NewGuid(), Guid.NewGuid(), null, "Receipt", "USD", 1180m, new DateOnly(2026, 10, 20),
                DateTimeOffset.UtcNow, null, "TR-1"),
        ],
        [new AirlineTreasuryAgingData("USD", 590m, 0m, 590m, 0m, 0m, 0m, 0m, 0m)]);

    private WebApplicationFactory<Program> App(State state)
    {
        state.Treasury ??= InterfaceStub.Create<IFinanceTreasuryStore>((name, args) => name switch
        {
            nameof(IFinanceTreasuryStore.PortalStatementAsync) => Task.FromResult(
                new AirlineTreasuryReadResult<AirlineTreasuryStatementData>(PortalStatement((DateOnly)args[1]!), null)),
            nameof(IFinanceTreasuryStore.StatementAsync) => Task.FromResult<FinanceTreasuryStatementData?>(
                (Guid?)args[2] is { } station && station != OwnStation ? null
                    : new FinanceTreasuryStatementData((DateOnly)args[1]!, [], [], [], [])),
            nameof(IFinanceTreasuryStore.OptionsAsync) => Task.FromResult<FinanceTreasuryOptionsData?>(new(
                [new FinanceTreasuryAirlineOptionData(Organization, "Arajet")], [new FinanceTreasuryStationOptionData(OwnStation, "PUJ")])),
            _ => null,
        });
        state.Portal ??= InterfaceStub.Create<IAirlinePortalReportStore>((name, args) =>
        {
            if (name != nameof(IAirlinePortalReportStore.CustomerAsync)) state.Organizations.Add((Guid)args[0]!);
            return name switch
            {
                nameof(IAirlinePortalReportStore.CustomerAsync) => Task.FromResult<AirlineCustomerData?>(
                    new("Arajet", "DM", "RNC 1-31-23456-9")),
                nameof(IAirlinePortalReportStore.ProfileAsync) => Task.FromResult<AirlinePortalReportProfile?>(new("Arajet",
                    [new AirlinePortalReportStation(OwnStation, "PUJ", "Punta Cana")])),
                nameof(IAirlinePortalReportStore.OperationsAsync) => Task.FromResult<IReadOnlyList<AirlinePortalReportOperation>?>(
                [
                    new(new DateOnly(2026, 10, 2), "PUJ-0001", "DM101", "DM102", "PUJ", GroundOperationStatus.Approved,
                        DateTimeOffset.UtcNow, [new("GPU", "Ground power", "Completed", 2m, "hour"),
                            new("PBB", "Pasarela", "Completed", 1m, "operation")]),
                    new(new DateOnly(2026, 10, 3), "PUJ-0002", "DM201", null, "PUJ", GroundOperationStatus.InReview, null, []),
                ]),
                _ => null,
            };
        });
        state.Governance ??= InterfaceStub.Create<IEmployeeGovernanceStore>((name, args) => name switch
        {
            nameof(IEmployeeGovernanceStore.ListEmployeesAsync) => Task.FromResult<EmployeePageData?>((int)args[6]! == 1
                ? new EmployeePageData(1, 100, 101, true, [Employee("E-1", "Ana", "Active")])
                : new EmployeePageData(2, 100, 101, false, [Employee("E-2", "Luis", "Terminated")])),
            nameof(IEmployeeGovernanceStore.ListActivityAsync) => Task.FromResult<ActivityPageData?>(null),
            _ => null,
        });
        var audit = new AuditStub(state);
        var actors = new ActorsStub(state);
        return factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IActorContextResolver>();
            services.RemoveAll<IFinanceTreasuryStore>();
            services.RemoveAll<IAirlinePortalReportStore>();
            services.RemoveAll<IEmployeeGovernanceStore>();
            services.RemoveAll<IReportExportAudit>();
            services.AddSingleton<IActorContextResolver>(actors);
            services.AddSingleton((IFinanceTreasuryStore)state.Treasury);
            services.AddSingleton((IAirlinePortalReportStore)state.Portal);
            services.AddSingleton((IEmployeeGovernanceStore)state.Governance);
            services.AddSingleton<IReportExportAudit>(audit);
        }));
    }

    private static EmployeeSummaryData Employee(string number, string name, string status) => new(Guid.NewGuid(), number,
        name, "Pérez", "human-resources", new JobPositionRefData(Guid.NewGuid(), "Analista", false), status,
        new DateOnly(2025, 1, 15), [new GovernanceStationData(OwnStation, "PUJ")], null, null, null, "v1");

    [Fact]
    public async Task ThePortalReadsOnlyTheSessionsAirlineAndRefusesAnotherStation()
    {
        var ct = TestContext.Current.CancellationToken;
        var state = new State { Actor = AirlineActor(Organization) };
        await using var app = App(state);
        using var client = Authorized(app);
        using var catalog = await client.GetAsync("/api/v1/airline/portal/reports", ct);
        using (var json = JsonDocument.Parse(await catalog.Content.ReadAsStringAsync(ct)))
            Assert.Equal(["operations", "invoices", "statement"],
                json.RootElement.GetProperty("reports").EnumerateArray().Select(item => item.GetProperty("key").GetString()));

        using var page = await client.GetAsync("/api/v1/airline/portal/reports/operations?from=2026-10-01&to=2026-10-31", ct);
        Assert.Equal(HttpStatusCode.OK, page.StatusCode);
        using (var json = JsonDocument.Parse(await page.Content.ReadAsStringAsync(ct)))
        {
            var root = json.RootElement;
            Assert.Equal(3, root.GetProperty("totalRows").GetInt32());
            Assert.Equal("Pendiente de aprobación de AVIAM", root.GetProperty("rows")[2][5].GetProperty("value").GetString());
            Assert.Equal("Aerolínea", root.GetProperty("appliedFilters")[0].GetProperty("label").GetString());
            Assert.Equal("Arajet", root.GetProperty("appliedFilters")[0].GetProperty("value").GetString());
        }
        Assert.All(state.Organizations, organization => Assert.Equal(Organization, organization));

        // Another airline's (or an unknown) station: 404 station_unavailable, the operations are never read.
        var reads = InterfaceStub.CallsOf(state.Portal!).Count(call => call == nameof(IAirlinePortalReportStore.OperationsAsync));
        using var foreign = await client.GetAsync(
            $"/api/v1/airline/portal/reports/operations?from=2026-10-01&to=2026-10-31&stationId={Guid.NewGuid()}", ct);
        Assert.Equal((HttpStatusCode.NotFound, "station_unavailable"), (foreign.StatusCode, await CodeAsync(foreign, ct)));
        Assert.Equal(reads, InterfaceStub.CallsOf(state.Portal!).Count(call => call == nameof(IAirlinePortalReportStore.OperationsAsync)));
        using var export = await client.GetAsync(
            $"/api/v1/airline/portal/reports/statement/export?format=pdf&to=2026-10-31&stationId={Guid.NewGuid()}", ct);
        Assert.Equal(HttpStatusCode.NotFound, export.StatusCode);
        Assert.Empty(state.Audits);

        // The portal cannot choose an airline: the parameter does not exist.
        using var chosen = await client.GetAsync(
            $"/api/v1/airline/portal/reports/invoices?from=2026-10-01&to=2026-10-31&airlineId={Guid.NewGuid()}", ct);
        Assert.Equal((HttpStatusCode.BadRequest, "invalid_report_query"), (chosen.StatusCode, await CodeAsync(chosen, ct)));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task AnAccountWithoutTheAirlineRoleOrWithTwoAirlinesIsRefused(bool twoAirlines)
    {
        var ct = TestContext.Current.CancellationToken;
        var state = new State
        {
            Actor = twoAirlines ? AirlineActor(Organization, Guid.NewGuid()) : InternalActor(Department.Finance, "finance.reports.read"),
        };
        await using var app = App(state);
        using var client = Authorized(app);
        using var page = await client.GetAsync("/api/v1/airline/portal/reports/invoices?from=2026-10-01&to=2026-10-31", ct);
        Assert.Equal(HttpStatusCode.Forbidden, page.StatusCode);
        Assert.Null(await CodeAsync(page, ct));
        using var export = await client.GetAsync("/api/v1/airline/portal/reports/statement/export?format=xlsx&to=2026-10-31", ct);
        Assert.Equal(HttpStatusCode.Forbidden, export.StatusCode);
        Assert.Empty(state.Organizations);
        Assert.Empty(InterfaceStub.CallsOf(state.Treasury!));
    }

    [Fact]
    public async Task ThePortalInvoicesKeepThoseIssuedInThePeriodWithTheirStatusAndTotals()
    {
        var ct = TestContext.Current.CancellationToken;
        await using var app = App(new State { Actor = AirlineActor(Organization) });
        using var client = Authorized(app);
        using var page = await client.GetAsync("/api/v1/airline/portal/reports/invoices?from=2026-10-01&to=2026-10-31", ct);
        using var json = JsonDocument.Parse(await page.Content.ReadAsStringAsync(ct));
        var rows = json.RootElement.GetProperty("rows");
        Assert.Equal(1, rows.GetArrayLength());
        Assert.Equal(("E310000000001", "Pagada"), (rows[0][1].GetProperty("value").GetString(), rows[0][5].GetProperty("value").GetString()));
        using var overdue = await client.GetAsync("/api/v1/airline/portal/reports/invoices?from=2026-09-01&to=2026-10-31&status=overdue", ct);
        using var filtered = JsonDocument.Parse(await overdue.Content.ReadAsStringAsync(ct));
        Assert.Equal("E310000000002", filtered.RootElement.GetProperty("rows")[0][1].GetProperty("value").GetString());
        Assert.Equal("590", filtered.RootElement.GetProperty("totals")[0].GetProperty("cells")[9].GetProperty("value").GetString());
    }

    [Theory]
    [InlineData("pdf", "application/pdf")]
    [InlineData("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")]
    public async Task ThePortalStatementExportsTheSameDocumentAndIsAudited(string format, string contentType)
    {
        var ct = TestContext.Current.CancellationToken;
        var state = new State { Actor = AirlineActor(Organization) };
        await using var app = App(state);
        using var client = Authorized(app);
        using var response = await client.GetAsync($"/api/v1/airline/portal/reports/statement/export?format={format}&to=2026-10-31", ct);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(contentType, response.Content.Headers.ContentType?.MediaType);
        Assert.Equal($"elevant-portal-statement-20261031.{format}", response.Content.Headers.ContentDisposition?.FileName?.Trim('"'));
        Assert.Equal([("airline-portal", "statement", format)], state.Audits);
    }

    [Fact]
    public async Task TheFinanceStatementNeedsItsPermissionAndAnAirline()
    {
        var ct = TestContext.Current.CancellationToken;
        var refused = new State { Actor = InternalActor(Department.Finance, "finance.reports.read") };
        await using (var app = App(refused))
        {
            using var client = Authorized(app);
            using var response = await client.GetAsync(
                $"/api/v1/finance/statements/export?format=pdf&asOf=2026-10-31&airlineId={Organization}", ct);
            Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
            Assert.Empty(InterfaceStub.CallsOf(refused.Treasury!));
        }
        var state = new State { Actor = InternalActor(Department.Finance, "finance.receipts.read", "finance.statements.read") };
        await using var allowed = App(state);
        using var finance = Authorized(allowed);
        using (var missing = await finance.GetAsync("/api/v1/finance/statements/export?format=pdf&asOf=2026-10-31", ct))
            Assert.Equal((HttpStatusCode.BadRequest, "invalid_report_query"), (missing.StatusCode, await CodeAsync(missing, ct)));
        using (var word = await finance.GetAsync($"/api/v1/finance/statements/export?format=docx&asOf=2026-10-31&airlineId={Organization}", ct))
            Assert.Equal(HttpStatusCode.BadRequest, word.StatusCode);
        using (var foreign = await finance.GetAsync(
                   $"/api/v1/finance/statements/export?format=pdf&asOf=2026-10-31&airlineId={Organization}&stationId={Guid.NewGuid()}", ct))
            Assert.Equal((HttpStatusCode.NotFound, "station_unavailable"), (foreign.StatusCode, await CodeAsync(foreign, ct)));
        using var xlsx = await finance.GetAsync(
            $"/api/v1/finance/statements/export?format=xlsx&asOf=2026-10-31&airlineId={Organization}&stationId={OwnStation}", ct);
        Assert.Equal(HttpStatusCode.OK, xlsx.StatusCode);
        Assert.Equal("estado-de-cuenta-arajet-20261031.xlsx", xlsx.Content.Headers.ContentDisposition?.FileName?.Trim('"'));
        using var pdf = await finance.GetAsync(
            $"/api/v1/finance/statements/export?format=pdf&asOf=2026-10-31&airlineId={Organization}&currency=USD", ct);
        Assert.Equal((HttpStatusCode.OK, "application/pdf"), (pdf.StatusCode, pdf.Content.Headers.ContentType?.MediaType));
        using (var euros = await finance.GetAsync(
                   $"/api/v1/finance/statements/export?format=pdf&asOf=2026-10-31&airlineId={Organization}&currency=EUR", ct))
            Assert.Equal(HttpStatusCode.BadRequest, euros.StatusCode);
        Assert.Equal([("finance", "statement", "xlsx"), ("finance", "statement", "pdf")], state.Audits);
    }

    [Fact]
    public async Task GestionHumanaChecksExportBeforeReadingAndReadsEveryPageOfTheRoster()
    {
        var ct = TestContext.Current.CancellationToken;
        var state = new State { Actor = InternalActor(Department.HumanResources, "human_resources.reports.read") };
        await using var app = App(state);
        using var client = Authorized(app);
        using (var export = await client.GetAsync("/api/v1/human-resources/table-reports/staff-roster/export?format=pdf", ct))
            Assert.Equal(HttpStatusCode.Forbidden, export.StatusCode);
        Assert.Empty(InterfaceStub.CallsOf(state.Governance!));

        using var page = await client.GetAsync($"/api/v1/human-resources/table-reports/staff-roster?stationId={OwnStation}", ct);
        Assert.Equal(HttpStatusCode.OK, page.StatusCode);
        using (var json = JsonDocument.Parse(await page.Content.ReadAsStringAsync(ct)))
        {
            Assert.Equal(2, json.RootElement.GetProperty("totalRows").GetInt32());
            Assert.Equal("De baja", json.RootElement.GetProperty("rows")[1][5].GetProperty("value").GetString());
            Assert.Equal("PUJ", json.RootElement.GetProperty("appliedFilters")[0].GetProperty("value").GetString());
        }
        Assert.Equal(2, InterfaceStub.CallsOf(state.Governance!).Count(call => call == nameof(IEmployeeGovernanceStore.ListEmployeesAsync)));

        // The trail reads at most 92 days, and an account «Trazabilidad» refuses is refused here too.
        using (var long_ = await client.GetAsync("/api/v1/human-resources/table-reports/audit-trail?from=2026-06-01&to=2026-10-31", ct))
            Assert.Equal((HttpStatusCode.BadRequest, "invalid_report_query"), (long_.StatusCode, await CodeAsync(long_, ct)));
        using (var trail = await client.GetAsync("/api/v1/human-resources/table-reports/audit-trail?from=2026-10-01&to=2026-10-31", ct))
            Assert.Equal(HttpStatusCode.Forbidden, trail.StatusCode);

        state.Actor = InternalActor(Department.Finance, "finance.reports.read");
        using var outsider = await client.GetAsync("/api/v1/human-resources/table-reports/staff-roster", ct);
        Assert.Equal(HttpStatusCode.Forbidden, outsider.StatusCode);
    }

    private static async Task<string?> CodeAsync(HttpResponseMessage response, CancellationToken ct)
    {
        var text = await response.Content.ReadAsStringAsync(ct);
        if (string.IsNullOrWhiteSpace(text)) return null;
        using var json = JsonDocument.Parse(text);
        return json.RootElement.TryGetProperty("code", out var code) ? code.GetString() : null;
    }

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

    private sealed class ActorsStub(State state) : IActorContextResolver
    {
        public Task<ActorContext?> ResolveAsync(Guid accountId, CancellationToken cancellationToken = default) =>
            Task.FromResult(state.Actor);
    }

    private sealed class AuditStub(State state) : IReportExportAudit
    {
        public Task RecordAsync(Guid actorId, string area, string reportKey, string format, TabularReportQuery query, int rows,
            CancellationToken cancellationToken = default)
        {
            state.Audits.Add((area, reportKey, format));
            return Task.CompletedTask;
        }
    }
}
