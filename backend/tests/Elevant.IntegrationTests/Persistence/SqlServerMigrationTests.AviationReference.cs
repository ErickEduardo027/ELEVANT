using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Abstractions.Integrations;
using Elevant.Application.Integration;
using Elevant.Domain.Entities.Integration;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    /// <summary>
    /// ADR-0028 (note of 15 November 2026): the on-demand reference reads write the same usage ledger, with their read as
    /// the operation and the OnDemand trigger; their totals count the operation by UTC day and month and the provider's
    /// month, and the flight feed's budget and its activity count only its FIDS reads.
    /// </summary>
    [Fact]
    public async Task AviationReferenceReadsShareTheLedgerWithoutTakingTheFeedBudget()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var seeded = await SeededFinanceProviderAsync(database, ct);
        await using var provider = new ServiceCollection().AddLogging()
            .AddSingleton<TimeProvider>(TimeProvider.System)
            .AddSingleton<IAirportFlightFeed, DisabledFeed>()
            .AddSingleton(FlightFeedBudget.Default)
            .AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString,
            }).Build()).BuildServiceProvider();
        await using var scope = provider.CreateAsyncScope();
        var ledger = scope.ServiceProvider.GetRequiredService<IProviderUsageLedger>();
        var sync = scope.ServiceProvider.GetRequiredService<IFlightFeedSyncStore>();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var now = DateTimeOffset.UtcNow;

        await ledger.RecordAsync(new ProviderUsageRecord("AeroDataBox", "airport_delays", SeededPujStation, 6, 200,
            ProviderCallOutcome.Succeeded, ProviderCallTrigger.OnDemand, SeededOccAccount, 1, now), ct);
        await ledger.RecordAsync(new ProviderUsageRecord("AeroDataBox", "aircraft", SeededPujStation, 1, 204,
            ProviderCallOutcome.NoContent, ProviderCallTrigger.OnDemand, SeededOccAccount, 0, now), ct);
        await ledger.RecordAsync(new ProviderUsageRecord("AeroDataBox", "airline_fleet", null, 6, 200,
            ProviderCallOutcome.Succeeded, ProviderCallTrigger.OnDemand, null, 25, now), ct);

        var delays = await ledger.GetTotalsAsync("AeroDataBox", "airport_delays", now, ct);
        Assert.Equal((6, 6, 13), (delays.OperationToday, delays.OperationThisMonth, delays.ProviderThisMonth));
        var rows = await context.Set<ProviderUsageEntry>().AsNoTracking().OrderBy(entry => entry.Id).ToArrayAsync(ct);
        Assert.Equal(["airport_delays", "aircraft", "airline_fleet"], rows.Select(row => row.Operation));
        Assert.All(rows, row => Assert.Equal(ProviderCallTrigger.OnDemand, row.Trigger));
        Assert.NotNull(rows[0].StationId);
        Assert.Null(rows[2].StationId);
        Assert.Equal(25, rows[2].FlightsReceived);

        // The feed's own budget and activity ignore the reference reads.
        var state = await sync.GetStateAsync("AeroDataBox", now, ct);
        Assert.Equal((0, 0), (state.UnitsToday, state.UnitsThisMonth));
        var station = Assert.Single(await sync.ListStationsAsync(now, ct), item => item.StationPublicId == SeededPujStation);
        var activity = await sync.GetActivityAsync("AeroDataBox", station, now, ct);
        Assert.Empty(activity.RecentFetches);
        Assert.Null(activity.LastManualRefreshAt);
    }
}
