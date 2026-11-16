using Elevant.Application.Abstractions.Operations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    private static readonly Guid SeededOccAccount = Guid.Parse("40000000-0000-7000-8000-000000000001");
    private static readonly Guid SeededPujStation = Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly Guid SeededStandA01 = Guid.Parse("20000000-0000-7000-8000-000000000005");

    /// <summary>ADR-0027: OCC sees the contracts ready to operate and places stands on the map.</summary>
    [Fact]
    public async Task OccListsContractsReadyToOperateAndPlacesStandsOnTheMap()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var ready = scope.ServiceProvider.GetRequiredService<IOccReadyContractsStore>();
        var positions = scope.ServiceProvider.GetRequiredService<IOccPositionStore>();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        // Only OCC with Planificación «Ver» in scope reads it; the seeded active contract is ready at PUJ.
        Assert.Null(await ready.ListAsync(SeededRampAgentAccount, SeededPujStation, today, ct));
        var list = (await ready.ListAsync(SeededOccAccount, SeededPujStation, today, ct))!;
        var contract = Assert.Single(list.Contracts);
        Assert.Equal("PUJ", list.StationCode);
        Assert.Equal(SeededContractVersion, contract.VersionId);
        Assert.NotEmpty(contract.Services);
        // A terminated contract is no longer ready.
        await context.Contracts.Where(item => item.PublicId == contract.ContractId)
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.TerminatedOn, today.AddDays(-1)), ct);
        Assert.Empty((await ready.ListAsync(SeededOccAccount, SeededPujStation, today, ct))!.Contracts);

        // OCC places a stand; the board returns its coordinates; half a coordinate is invalid.
        Assert.Equal(OccPositionFailure.Invalid,
            (await positions.LocateStandAsync(SeededOccAccount, SeededStandA01, 18.5674m, null, today, ct)).Failure);
        Assert.Equal(OccPositionFailure.Forbidden,
            (await positions.LocateStandAsync(SeededRampAgentAccount, SeededStandA01, 18.5674m, -68.3634m, today, ct)).Failure);
        var located = await positions.LocateStandAsync(SeededOccAccount, SeededStandA01, 18.5674123m, -68.3634567m, today, ct);
        Assert.Null(located.Failure);
        var stand = Assert.Single(located.Board!.Positions, item => item.StandId == SeededStandA01);
        Assert.Equal((18.567412m, -68.363457m), (stand.Latitude!.Value, stand.Longitude!.Value));
        var cleared = await positions.LocateStandAsync(SeededOccAccount, SeededStandA01, null, null, today, ct);
        Assert.Null(Assert.Single(cleared.Board!.Positions, item => item.StandId == SeededStandA01).Latitude);
    }
}
