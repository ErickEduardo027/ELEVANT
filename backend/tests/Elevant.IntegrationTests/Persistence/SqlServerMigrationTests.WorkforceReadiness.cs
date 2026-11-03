using Elevant.Application.Abstractions.Identity;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    private static readonly Guid SeededRampAgentAccount = Guid.Parse("40000000-0000-7000-8000-000000000002");

    /// <summary>ADR-0026: HR programs and removes shifts, reads readiness; the agent reads its own schedule.</summary>
    [Fact]
    public async Task HumanResourcesProgramsShiftsAndAgentsSeeReadinessAndTheirOwnSchedule()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var readiness = scope.ServiceProvider.GetRequiredService<IWorkforceReadinessStore>();
        var shifts = scope.ServiceProvider.GetRequiredService<IHumanResourcesShiftWriteStore>();
        var options = scope.ServiceProvider.GetRequiredService<IHumanResourcesShiftReadStore>();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        // Readiness is for Gestión Humana; the ramp agent cannot list it.
        Assert.Null(await readiness.ListReadinessAsync(SeededRampAgentAccount, ct));
        var rows = (await readiness.ListReadinessAsync(HumanResourcesAccount, ct))!;
        var agent = Assert.Single(rows, row => row.Items.Single(item => item.Key == "mobile_role").Status == "Ok");
        Assert.All(agent.Items, item => Assert.Contains(item.Status, new[] { "Ok", "Expiring", "Missing", "Info" }));
        Assert.Equal(agent.Items.All(item => item.Status != "Missing"), agent.Ready);

        // HR programs a shift for the agent in a station it may plan; the agent sees it on the tablet.
        var choices = (await options.GetAssignmentOptionsAsync(HumanResourcesAccount, agent.RampProfileId, today.AddDays(2), ct))!;
        var station = choices.Stations.First();
        var shiftId = Guid.NewGuid();
        var input = new RecordHumanResourcesShiftInput(agent.RampProfileId, station.Id, station.Terminals.First().Id,
            today.AddDays(2), new TimeOnly(6, 0), new TimeOnly(14, 0), "Turno mañana");
        Assert.Null((await shifts.RecordAsync(HumanResourcesAccount, shiftId, input, ct)).Failure);
        Assert.Null((await shifts.RecordAsync(HumanResourcesAccount, shiftId, input, ct)).Failure);

        Assert.Null(await readiness.GetOwnScheduleAsync(HumanResourcesAccount, today, today.AddDays(13), ct));
        var mine = (await readiness.GetOwnScheduleAsync(SeededRampAgentAccount, today, today.AddDays(13), ct))!;
        Assert.Equal(agent.RampProfileId, mine.RampProfileId);
        var shift = Assert.Single(mine.Shifts, item => item.Id == shiftId);
        Assert.Equal(("Morning", new TimeOnly(6, 0)), (shift.Block, shift.StartsAtLocal));
        Assert.All(mine.Documents, document => Assert.Contains(document.Validity, new[] { "Current", "Expiring", "Expired" }));

        // A future shift can be removed (idempotently); a past one is history.
        Assert.Null((await shifts.RemoveAsync(HumanResourcesAccount, shiftId, ct)).Failure);
        Assert.Null((await shifts.RemoveAsync(HumanResourcesAccount, shiftId, ct)).Failure);
        Assert.DoesNotContain((await readiness.GetOwnScheduleAsync(SeededRampAgentAccount, today, today.AddDays(13), ct))!.Shifts,
            item => item.Id == shiftId);
        var pastId = Guid.NewGuid();
        Assert.Null((await shifts.RecordAsync(HumanResourcesAccount, pastId, input with { WorkDate = today.AddDays(3) }, ct)).Failure);
        await context.ShiftAssignments.Where(item => item.PublicId == pastId)
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.WorkDate, today.AddDays(-1)), ct);
        Assert.Equal(HumanResourcesShiftWriteFailure.Conflict, (await shifts.RemoveAsync(HumanResourcesAccount, pastId, ct)).Failure);
        Assert.Equal(HumanResourcesShiftWriteFailure.Forbidden, (await shifts.RemoveAsync(SeededRampAgentAccount, pastId, ct)).Failure);
    }
}
