using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Commercial;
using Elevant.Application.Documents;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>The new tabular reports (ADR-0048, «Reportes nuevos») over the Development seed.</summary>
public sealed partial class SqlServerMigrationTests
{
    private static readonly Guid NewReportsAirlineAccount = Guid.Parse("40000000-0000-7000-8000-000000000003");

    private static TabularReportQuery NewReportsQuery(TabularReportDefinition definition, string? from = null,
        string? to = null, params (string Name, string Value)[] filters) =>
        TabularReports.Parse(definition, from, to,
            filters.Select(item => new KeyValuePair<string, string?>(item.Name, item.Value))) ??
        throw new InvalidOperationException("The test query is invalid.");

    [Fact]
    public async Task ContractsReportsAreReadOnlyByContratosAndFilterTheirRows()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<IContractsReportStore>();
        await using var db = CreateContext(database.ConnectionString);
        var catalog = ContractsReportCatalog.All;

        // Finance and the airline's portal account hold no «contracts.reports.read»: a bare refusal, nothing read.
        foreach (var refused in new[] { FinanceAccount, NewReportsAirlineAccount })
        {
            Assert.Equal(TabularReportFailure.Forbidden, await store.AuthorizeExportAsync(refused, ct));
            Assert.Equal(TabularReportFailure.Forbidden,
                (await store.ReadAsync(refused, catalog.Find("agreements")!, NewReportsQuery(catalog.Find("agreements")!), ct)).Failure);
        }
        Assert.Null(await store.AuthorizeExportAsync(ContractsAccount, ct));

        var contracts = await db.Contracts.CountAsync(ct);
        var agreements = (await store.ReadAsync(ContractsAccount, catalog.Find("agreements")!,
            NewReportsQuery(catalog.Find("agreements")!), ct)).Document!;
        Assert.Equal(contracts, agreements.Rows.Count);
        Assert.True(contracts > 0);
        Assert.Contains(agreements.Summary, metric => metric.Label == "Activos" && metric.Context!.StartsWith("de ", StringComparison.Ordinal));

        // The airline filter keeps only that airline's contracts and names it.
        var airline = await db.Airlines.Where(item => db.Contracts.Any(contract => contract.AirlineId == item.Id))
            .Select(item => new { item.Id, item.PublicId, item.Name }).FirstAsync(ct);
        var byAirline = (await store.ReadAsync(ContractsAccount, catalog.Find("agreements")!,
            NewReportsQuery(catalog.Find("agreements")!, filters: ("airlineId", airline.PublicId.ToString("D"))), ct)).Document!;
        Assert.Equal(await db.Contracts.CountAsync(contract => contract.AirlineId == airline.Id, ct), byAirline.Rows.Count);
        Assert.All(byAirline.Rows, row => Assert.Equal(airline.Name, row[0].Text));
        Assert.Contains(new ReportFilter("Aerolínea", airline.Name), byAirline.Filters);

        // An airline id that does not exist returns no rows, never every contract.
        var unknown = (await store.ReadAsync(ContractsAccount, catalog.Find("agreements")!,
            NewReportsQuery(catalog.Find("agreements")!, filters: ("airlineId", Guid.NewGuid().ToString("D"))), ct)).Document!;
        Assert.Empty(unknown.Rows);

        // The agreed rates are those of approved versions; the requests and permits read with their filters.
        var approvedRates = await (from rate in db.ContractServiceRates
                                   join version in db.ContractVersions on rate.ContractVersionId equals version.Id
                                   where version.Status == ContractVersionStatus.Approved
                                   select rate.Id).CountAsync(ct);
        var rates = (await store.ReadAsync(ContractsAccount, catalog.Find("rates")!, NewReportsQuery(catalog.Find("rates")!), ct))
            .Document!;
        Assert.Equal(approvedRates, rates.Rows.Count);
        var permit = await db.AirlinePermits.FirstOrDefaultAsync(ct);
        if (permit is not null)
        {
            var permits = (await store.ReadAsync(ContractsAccount, catalog.Find("permits")!, NewReportsQuery(catalog.Find("permits")!,
                filters: ("review", permit.Review.ToString())), ct)).Document!;
            Assert.Equal(await db.AirlinePermits.CountAsync(item => item.Review == permit.Review, ct), permits.Rows.Count);
        }
        var firstRequest = await db.ServiceRequests.OrderBy(item => item.SubmittedAt).Select(item => item.SubmittedAt).FirstOrDefaultAsync(ct);
        var day = Elevant.Application.Common.BusinessCalendar.Today(firstRequest == default ? DateTimeOffset.UtcNow : firstRequest);
        var requests = (await store.ReadAsync(ContractsAccount, catalog.Find("requests")!, NewReportsQuery(catalog.Find("requests")!,
            day.AddDays(-1).ToString("yyyy-MM-dd"), day.AddDays(300).ToString("yyyy-MM-dd")), ct)).Document!;
        Assert.Equal(await db.ServiceRequests.CountAsync(item =>
            item.SubmittedAt >= Elevant.Application.Common.BusinessCalendar.StartOfDay(day.AddDays(-1), null) &&
            item.SubmittedAt < Elevant.Application.Common.BusinessCalendar.StartOfDay(day.AddDays(301), null), ct), requests.Rows.Count);
        requests.Validate();
    }

    [Fact]
    public async Task PortalReportsReadOnlyTheSessionsAirlineInItsContractedStations()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var services = scope.ServiceProvider;
        var store = services.GetRequiredService<IAirlinePortalReportStore>();
        var reports = new AirlinePortalReports(services.GetRequiredService<Elevant.Application.Abstractions.Identity.IActorContextResolver>(),
            store, services.GetRequiredService<Elevant.Application.Abstractions.Finance.IFinanceTreasuryStore>(), TimeProvider.System);
        await using var db = CreateContext(database.ConnectionString);
        var organizationId = await (from user in db.Users
                                    join membership in db.OrganizationMemberships on user.Id equals membership.AccountId
                                    join organization in db.Organizations on membership.OrganizationId equals organization.Id
                                    where user.PublicId == NewReportsAirlineAccount && organization.Type == OrganizationType.AirlineCustomer
                                    select new { organization.Id, organization.PublicId }).SingleAsync(ct);
        var airline = await db.Airlines.SingleAsync(item => item.OrganizationId == organizationId.Id, ct);

        var profile = (await store.ProfileAsync(organizationId.PublicId, ct))!;
        Assert.Equal(airline.Name, profile.AirlineName);
        Assert.NotEmpty(profile.Stations);
        Assert.Null(await store.ProfileAsync(Guid.NewGuid(), ct));
        Assert.Null(await store.OperationsAsync(Guid.NewGuid(), new DateOnly(2020, 1, 1), new DateOnly(2030, 1, 1), null, null, ct));

        // Every operation returned is of the airline, in a covered station; none of another airline leaks in.
        var operations = (await store.OperationsAsync(organizationId.PublicId, new DateOnly(2020, 1, 1), new DateOnly(2030, 12, 31),
            null, null, ct))!;
        var ownCodes = await db.Turnarounds.Where(item => item.AirlineId == airline.Id).Select(item => item.OperationCode).ToListAsync(ct);
        Assert.All(operations, operation => Assert.Contains(operation.OperationCode, ownCodes));
        Assert.All(operations, operation => Assert.Contains(profile.Stations, station => station.Code == operation.StationCode));
        var foreignCodes = await db.Turnarounds.Where(item => item.AirlineId != airline.Id).Select(item => item.OperationCode).ToListAsync(ct);
        Assert.DoesNotContain(operations, operation => foreignCodes.Contains(operation.OperationCode));
        Assert.All(operations.Where(operation => operation.Status != GroundOperationStatus.Approved),
            operation => Assert.Empty(operation.Services));

        // Through the source: the airline account reads its reports; Finance and Contratos are refused; another
        // station is unavailable.
        var definition = AirlinePortalReports.All.Find("operations")!;
        var query = NewReportsQuery(definition, "2020-01-01", "2020-12-31");
        Assert.Null((await reports.ReadAsync(NewReportsAirlineAccount, definition, query, ct)).Failure);
        foreach (var refused in new[] { FinanceAccount, ContractsAccount })
            Assert.Equal(TabularReportFailure.Forbidden, (await reports.ReadAsync(refused, definition, query, ct)).Failure);
        var foreignStation = await db.Stations.Where(station => !profile.Stations.Select(item => item.Id).Contains(station.PublicId))
            .Select(station => (Guid?)station.PublicId).FirstOrDefaultAsync(ct);
        if (foreignStation is { } stationId)
            Assert.Equal(TabularReportFailure.StationUnavailable, (await reports.ReadAsync(NewReportsAirlineAccount, definition,
                NewReportsQuery(definition, "2020-01-01", "2020-12-31", ("stationId", stationId.ToString("D"))), ct)).Failure);
        var today = Elevant.Application.Common.BusinessCalendar.Today(DateTimeOffset.UtcNow);
        var invoices = AirlinePortalReports.All.Find("invoices")!;
        var invoiceReport = await reports.ReadAsync(NewReportsAirlineAccount, invoices,
            NewReportsQuery(invoices, today.AddDays(-365).ToString("yyyy-MM-dd"), today.ToString("yyyy-MM-dd")), ct);
        Assert.Null(invoiceReport.Failure);
        invoiceReport.Document!.Validate();
        var statement = AirlinePortalReports.All.Find("statement")!;
        var statementReport = await reports.ReadAsync(NewReportsAirlineAccount, statement,
            NewReportsQuery(statement, to: today.ToString("yyyy-MM-dd")), ct);
        Assert.Contains(new ReportFilter("Aerolínea", airline.Name), statementReport.Document!.Filters);
        Assert.Equal("Documento para la aerolínea", statementReport.Document.Audience);
    }

    [Fact]
    public async Task GestionHumanaTableReportsReadTheRosterAndTheTrailOfItsStores()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var services = scope.ServiceProvider;
        var reports = new Elevant.Application.Identity.HumanResourcesTableReports(
            services.GetRequiredService<Elevant.Application.Abstractions.Identity.IEmployeeGovernanceStore>(),
            services.GetRequiredService<Elevant.Application.Abstractions.Identity.IActorContextResolver>(), TimeProvider.System);
        await using var db = CreateContext(database.ConnectionString);
        var roster = Elevant.Application.Identity.HumanResourcesTableReports.All.Find("staff-roster")!;
        var result = await reports.ReadAsync(HumanResourcesAccount, roster, NewReportsQuery(roster), ct);
        Assert.Null(result.Failure);
        Assert.Equal(await db.Employees.CountAsync(ct), result.Document!.Rows.Count);
        result.Document.Validate();
        foreach (var refused in new[] { FinanceAccount, NewReportsAirlineAccount })
            Assert.Equal(TabularReportFailure.Forbidden, (await reports.ReadAsync(refused, roster, NewReportsQuery(roster), ct)).Failure);

        var trail = Elevant.Application.Identity.HumanResourcesTableReports.All.Find("audit-trail")!;
        var today = Elevant.Application.Common.BusinessCalendar.Today(DateTimeOffset.UtcNow);
        var audit = await reports.ReadAsync(HumanResourcesAccount, trail,
            NewReportsQuery(trail, today.AddDays(-30).ToString("yyyy-MM-dd"), today.ToString("yyyy-MM-dd")), ct);
        Assert.Null(audit.Failure);
        Assert.All(audit.Document!.Rows, row => Assert.DoesNotContain('.', row[2].Text));
    }
}
