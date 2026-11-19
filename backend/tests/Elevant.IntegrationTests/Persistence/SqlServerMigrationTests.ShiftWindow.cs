using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Common;
using Elevant.Application.Operations;
using Microsoft.EntityFrameworkCore;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>
/// N24 of the run of 16 November: only an agent whose shift covers the whole stay may work the flight. José Rosario
/// was «Elegible» with a shift from 11:00 to 20:00 for a stay from 19:53 to 20:53, because the rule looked at the
/// arrival only. An assignment made after the planned start needs the shift for what is left of the stay (D-N24).
/// </summary>
public sealed partial class SqlServerMigrationTests
{
    /// <summary>
    /// A shift from 11:00 to 20:00 covers the arrival at 19:53 but not the departure at 20:53: the agent is not
    /// eligible («Turno no compatible», so Planificación still offers «Ajustar turno») and the assignment is refused.
    /// From 12:00 to 21:00 the shift covers the whole stay and OCC assigns them.
    /// </summary>
    [Fact]
    public async Task AnAgentWhoseShiftEndsBeforeTheDepartureIsNotEligible()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        var connection = database.ConnectionString;
        var (airline, stands) = await PlanningFixtureAsync(connection, ct);
        var day = BusinessCalendar.Today(DateTimeOffset.UtcNow, StationZone).AddDays(2);
        long riley;
        await using (var setup = CreateContext(connection))
            riley = await setup.RampAgents.Where(item => item.PublicId == RileyProfile).Select(item => item.Id).SingleAsync(ct);
        await AddRampShiftAsync(connection, riley, day, "A", 11, 20, ct);
        var planned = await PlanManualFlightAsync(provider, airline, stands["A01"], day, "ZZ961", LocalAt(day, 19, 53),
            LocalAt(day, 20, 53), ct);
        Assert.True(planned.Failure is null, planned.Code ?? planned.Failure?.ToString());
        var flight = planned.TurnaroundId!.Value;

        var offShift = await CandidateAsync(provider, flight, "DEV-RA-001", ct);
        Assert.False(offShift.HasCompatibleShift);
        Assert.Equal(["shift_not_compatible"], OccAgentEligibilityPolicy.Evaluate(offShift).EligibilityReasons);
        Assert.Equal(OccAssignmentWriteFailure.Conflict,
            (await AssignThroughPlanningAsync(provider, flight, RileyProfile, ct)).Failure);

        // From 12:00 to 21:00 the shift covers the whole stay.
        await using (var setup = CreateContext(connection))
            await setup.ShiftAssignments.Where(item => item.RampAgentId == riley && item.WorkDate == day)
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.StartsAtLocal, new TimeOnly(12, 0))
                    .SetProperty(item => item.EndsAtLocal, new TimeOnly(21, 0)), ct);
        var onShift = await CandidateAsync(provider, flight, "DEV-RA-001", ct);
        Assert.True(onShift.HasCompatibleShift);
        Assert.Empty(OccAgentEligibilityPolicy.Evaluate(onShift).EligibilityReasons);
        var assigned = await AssignThroughPlanningAsync(provider, flight, RileyProfile, ct);
        Assert.True(assigned.IsSuccess, assigned.Failure?.ToString());
    }

    /// <summary>
    /// D-N24: an assignment made after the planned start needs the shift only for what is left of the stay, from the
    /// server's clock; before the start, and once the stay has ended, it needs all of it. The stay runs from 23:30 to
    /// 00:30 and the agent's only shift is the next day's, from midnight: it covers what is left at 00:10.
    /// </summary>
    [Fact]
    public async Task ALateAssignmentNeedsTheShiftOnlyForWhatIsLeftOfTheStay()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        var day = BusinessCalendar.Today(DateTimeOffset.UtcNow, StationZone).AddDays(2);
        var clock = new MovableTimeProvider(LocalAt(day, 23));
        await using var provider = await SeededFinanceProviderAsync(database, ct, clock);
        var connection = database.ConnectionString;
        var (airline, stands) = await PlanningFixtureAsync(connection, ct);
        long riley;
        await using (var setup = CreateContext(connection))
            riley = await setup.RampAgents.Where(item => item.PublicId == RileyProfile).Select(item => item.Id).SingleAsync(ct);
        await AddRampShiftAsync(connection, riley, day.AddDays(1), "A", 0, 8, ct);
        var planned = await PlanManualFlightAsync(provider, airline, stands["A01"], day, "ZZ963", LocalAt(day, 23, 30),
            LocalAt(day.AddDays(1), 0, 30), ct);
        Assert.True(planned.Failure is null, planned.Code ?? planned.Failure?.ToString());
        var flight = planned.TurnaroundId!.Value;
        async Task<IReadOnlyList<string>> ReasonsAt(DateTimeOffset now)
        {
            clock.Now = now;
            return OccAgentEligibilityPolicy.Evaluate(await CandidateAsync(provider, flight, "DEV-RA-001", ct))
                .EligibilityReasons;
        }

        // Before the stay the shift must cover all of it, and it starts at midnight, after the arrival.
        Assert.Equal(["shift_not_compatible"], await ReasonsAt(LocalAt(day, 23, 10)));
        // At 00:10 twenty minutes are left, and the shift of the new day covers them.
        Assert.Empty(await ReasonsAt(LocalAt(day.AddDays(1), 0, 10)));
        // Once the stay has ended it is judged whole again, as planned.
        Assert.Equal(["shift_not_compatible"], await ReasonsAt(LocalAt(day.AddDays(1), 0, 40)));

        // The late assignment goes through.
        clock.Now = LocalAt(day.AddDays(1), 0, 10);
        var assigned = await AssignThroughPlanningAsync(provider, flight, RileyProfile, ct);
        Assert.True(assigned.IsSuccess, assigned.Failure?.ToString());
    }
}
