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
}
