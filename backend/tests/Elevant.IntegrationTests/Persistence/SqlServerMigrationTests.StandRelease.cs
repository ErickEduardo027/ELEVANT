using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Integration;
using Elevant.Application.Integration.DemoFlights;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Persistence.Operations;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>
/// Owner decision 23 (ADR-0041): the stand frees itself when the tablet records the push-back. It is an occupancy rule:
/// the positions board, the stand's availability for another flight and the deactivation check stop counting the flight
/// whose aircraft left, while its stand assignment stays open, so the forms, the tablet and the planning keep naming the
/// flight's stand, and OCC's «Liberar» still closes it. A demo flight OCC imported is operated with the real tablet
/// stores, on a clock the test moves.
/// </summary>
public sealed partial class SqlServerMigrationTests
{
    private static readonly Guid StandReleaseTablet = Guid.Parse("81000000-0000-7000-8000-0000000000e1");

    /// <summary>A demo flight OCC imported on a stand, and the operation the seeded agent runs on the tablet.</summary>
    private sealed record OperatedFlight(DemoFlightData Flight, Guid TurnaroundId, Guid OperationId);

    /// <summary>
    /// A demo flight imported on <paramref name="stand"/> with the seeded agent assigned: the worker reports its landing,
    /// the agent starts the operation on a registered tablet and taps BLOCK_ON at the on-block instant. The clock is left
    /// just after the on-block.
    /// </summary>
    private static async Task<OperatedFlight> OperatedOnStandAsync(DemoFlights demo, Guid stand, CancellationToken ct)
    {
        var flight = await demo.Triggered(minutes: 8);
        var turnaroundId = await demo.Imported(flight, stand);
        await demo.AssignAgent(turnaroundId);
        var operationId = (await demo.Turnaround(turnaroundId)).Operation.PublicId;
        Assert.True((await demo.Run(services => services.GetRequiredService<IMobileDeviceCommandStore>().RegisterAsync(
            new MobileDeviceRegistrationWriteRequest(SeededRampAgentAccount, StandReleaseTablet, MobilePlatform.Android,
                "1.2.3", "Stand release SQL test tablet", "Android 16"), ct))).IsSuccess);

        demo.Clock.Now = flight.TouchdownAt.AddSeconds(20);
        Assert.Equal(1, await demo.Tick());
        var startKey = Guid.NewGuid();
        var started = await demo.Run(services => services.GetRequiredService<IRampOperationsCommandStore>()
            .StartOperationAsync(new RampOperationStartWriteRequest(SeededRampAgentAccount, [SeededPujStation], operationId,
                StandReleaseTablet, startKey, startKey, "stand-release-start", demo.Now), ct));
        Assert.True(started.IsSuccess, started.Failure?.ToString());
        demo.Clock.Now = flight.OnBlockAt.AddSeconds(10);
        await TappedAsync(demo, operationId, RampEvidenceTimePolicy.BlockOn, flight.OnBlockAt, ct);
        return new OperatedFlight(flight, turnaroundId, operationId);
    }

    /// <summary>The agent taps <paramref name="code"/> on the tablet at <paramref name="at"/>, and the server takes it.</summary>
    private static async Task TappedAsync(DemoFlights demo, Guid operationId, string code, DateTimeOffset at,
        CancellationToken ct)
    {
        var tapped = await demo.Run(services => services.GetRequiredService<IRampExecutionCommandStore>()
            .RecordMilestoneAsync(new RampMilestoneWriteRequest(SeededRampAgentAccount, [SeededPujStation], operationId,
                code, at, StandReleaseTablet, Guid.NewGuid(), $"stand-release-{code.ToLowerInvariant()}"), ct));
        Assert.True(tapped.IsSuccess, tapped.Code ?? tapped.Failure?.ToString());
    }

    /// <summary>The agent taps PUSHBACK half an hour after the on-block, inside the planned window; the clock is there.</summary>
    private static async Task<DateTimeOffset> PushedBackAsync(DemoFlights demo, OperatedFlight operated, CancellationToken ct)
    {
        demo.Clock.Now = operated.Flight.OnBlockAt.AddMinutes(30);
        Assert.True(demo.Now < operated.Flight.ScheduledOffBlockAt);
        await TappedAsync(demo, operated.OperationId, RampEvidenceTimePolicy.Pushback, demo.Now, ct);
        return demo.Now;
    }

    /// <summary>OCC's positions board of the demo day.</summary>
    private static async Task<OccPositionBoardData> PositionsBoardAsync(DemoFlights demo, CancellationToken ct)
    {
        var read = await demo.Run(services => services.GetRequiredService<IOccPositionStore>()
            .ReadAsync(SeededOccAccount, SeededPujStation, demo.Day, ct));
        Assert.Null(read.Failure);
        return read.Board!;
    }

    private static OccPositionData BoardPosition(OccPositionBoardData board, string code) =>
        Assert.Single(board.Positions, item => item.Code == code);

    /// <summary>The lists of the board that name the turnaround: the codes of its stands and «unassigned».</summary>
    private static string[] ListedOn(OccPositionBoardData board, Guid turnaroundId)
    {
        var listed = board.Positions.Where(position => position.Turnarounds.Any(item => item.TurnaroundId == turnaroundId))
            .Select(position => position.Code).ToList();
        if (board.Unassigned.Any(item => item.TurnaroundId == turnaroundId)) listed.Add("unassigned");
        return [.. listed];
    }

    /// <summary>Where a flight of [<paramref name="from"/>, <paramref name="to"/>) can park, as every placing command checks it.</summary>
    private static async Task<StandAvailability.Placement> PlacementAsync(DemoFlights demo, Guid stand, DateTimeOffset from,
        DateTimeOffset to, CancellationToken ct)
    {
        await using var context = CreateContext(demo.Connection);
        var station = await context.Stations.AsNoTracking().Where(item => item.PublicId == SeededPujStation)
            .Select(item => item.Id).SingleAsync(ct);
        return await StandAvailability.CheckAsync(context, station, stand, from, to, null, null, ct);
    }

    private static bool StandFree(DemoFlightOptionsData options, string code) =>
        Assert.Single(options.Stands, item => item.Code == code).Free;

    /// <summary>
    /// After the push-back the stand reads «Libre» and the flight that left is listed nowhere, neither on its stand nor
    /// among the flights without one; the stands it cancelled or limited are free again. OCC's screens hear the tap, and
    /// the assignment stays open.
    /// </summary>
    [Fact]
    public async Task AfterPushbackTheBoardAnswersAvailableAndListsTheFlightNowhere()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var demo = await DemoFlightsAsync(database, ct);
        // Combined stands (ADR-0030): while A03 is occupied it cancels A02 and limits B03 to narrow-bodies.
        foreach (var (affected, kind) in new[] { ("A02", "Cancels"), ("B03", "NarrowbodyOnly") })
            Assert.Null((await demo.Run(services => services.GetRequiredService<IPositionCoverageStore>()
                .AddConstraintAsync(SeededOccAccount, new StandConstraintInput(demo.Stands["A03"], demo.Stands[affected], kind),
                    demo.Day, ct))).Failure);
        var operated = await OperatedOnStandAsync(demo, demo.Stands["A03"], ct);

        var parked = await PositionsBoardAsync(demo, ct);
        Assert.Equal(("occupied", operated.TurnaroundId),
            (BoardPosition(parked, "A03").Status, Assert.Single(BoardPosition(parked, "A03").Turnarounds).TurnaroundId));
        Assert.Equal(("A03", true), (BoardPosition(parked, "A02").CancelledBy, BoardPosition(parked, "B03").NarrowbodyOnly));
        Assert.Equal(["A03"], ListedOn(parked, operated.TurnaroundId));

        var hints = await demo.PlanningHints();
        await PushedBackAsync(demo, operated, ct);
        // The tap is announced to the station's OCC, whose screens read the board again.
        Assert.Equal(hints + await demo.OccAccounts(), await demo.PlanningHints());
        var left = await PositionsBoardAsync(demo, ct);
        Assert.Equal(("available", 0), (BoardPosition(left, "A03").Status, BoardPosition(left, "A03").Turnarounds.Count));
        Assert.Equal(((string?)null, false), (BoardPosition(left, "A02").CancelledBy, BoardPosition(left, "B03").NarrowbodyOnly));
        Assert.Empty(ListedOn(left, operated.TurnaroundId));
        Assert.Empty(left.Unassigned);

        // It frees the occupancy, not the assignment: the flight keeps A03 as its stand of record.
        await using var check = CreateContext(database.ConnectionString);
        var turnaround = await check.Turnarounds.AsNoTracking().Where(item => item.PublicId == operated.TurnaroundId)
            .Select(item => item.Id).SingleAsync(ct);
        var assignment = await check.Set<StandAssignment>().AsNoTracking().SingleAsync(item => item.TurnaroundId == turnaround, ct);
        Assert.Equal((demo.Stands.Key("A03"), (DateTimeOffset?)null), (assignment.StandId, assignment.AssignedTo));
    }

    /// <summary>
    /// The stand the aircraft left takes the next flight at once: OCC plans one inside the window the departed flight had
    /// planned, which it refused while the aircraft was still there, and the board shows it as the stand's planned flight.
    /// </summary>
    [Fact]
    public async Task AfterPushbackTheBoardShowsTheNextPlannedFlightOnTheStand()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var demo = await DemoFlightsAsync(database, ct);
        var operated = await OperatedOnStandAsync(demo, demo.Stands["A03"], ct);
        // The next flight parks before the departed one's planned window ends.
        var arrival = operated.Flight.OnBlockAt.AddMinutes(45);
        Assert.True(arrival < operated.Flight.ScheduledOffBlockAt);
        var early = await PlanManualFlightAsync(demo.Provider, demo.Airline, demo.Stands["A03"], demo.Day, "ZZ931", arrival,
            arrival.AddMinutes(60), ct);
        Assert.Equal(ManualTurnaroundWriteFailure.Conflict, early.Failure);

        await PushedBackAsync(demo, operated, ct);
        var next = await PlanManualFlightAsync(demo.Provider, demo.Airline, demo.Stands["A03"], demo.Day, "ZZ931", arrival,
            arrival.AddMinutes(60), ct);
        Assert.True(next.IsSuccess, next.Code);
        var board = await PositionsBoardAsync(demo, ct);
        var stand = BoardPosition(board, "A03");
        Assert.Equal(("planned", next.TurnaroundId!.Value), (stand.Status, Assert.Single(stand.Turnarounds).TurnaroundId));
        Assert.Empty(ListedOn(board, operated.TurnaroundId));
        Assert.Empty(board.Unassigned);
    }

    /// <summary>
    /// After the push-back the stand is free for any window: its availability, the demo options and the trigger no
    /// longer count the aircraft that left, which is still an active demo flight while it taxis out, and OCC imports the
    /// next demo flight onto it. Both flights keep A03 as their stand of record; only the one on its way in is on it.
    /// </summary>
    [Fact]
    public async Task AfterPushbackTheWindowIsFreeAndAnotherFlightIsImportedOntoTheStand()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var demo = await DemoFlightsAsync(database, ct);
        var operated = await OperatedOnStandAsync(demo, demo.Stands["A03"], ct);

        // Half an hour on the stand: a visit of the form's defaults overlaps the planned window, and the stand is taken.
        demo.Clock.Now = operated.Flight.OnBlockAt.AddMinutes(30);
        var (from, to) = (demo.Now.AddMinutes(8), demo.Now.AddMinutes(68));
        Assert.Equal(["stand_taken"], (await PlacementAsync(demo, demo.Stands["A03"], from, to, ct)).Reasons);
        Assert.False(StandFree(await demo.Options(), "A03"));
        var taken = await demo.Trigger(demo.Command(stand: demo.Stands["A03"]));
        Assert.Equal((MasterDataFailure.Conflict, "stand_unavailable"), (taken.Failure, taken.Code));
        Assert.Contains("stand_taken", taken.Reasons!);

        await PushedBackAsync(demo, operated, ct);
        Assert.True((await PlacementAsync(demo, demo.Stands["A03"], from, to, ct)).Available);
        var leaving = await demo.Flight(operated.Flight.Id);
        Assert.Equal(("Active", "TaxiOut", "A03"), (leaving.State, leaving.Phase, leaving.StandCode));
        Assert.True(StandFree(await demo.Options(), "A03"));
        var next = await demo.Triggered(minutes: 8, stand: demo.Stands["A03"]);
        var nextTurnaround = await demo.Imported(next, demo.Stands["A03"]);

        Assert.Equal(("A03", "A03"), ((await demo.Flight(operated.Flight.Id)).StandCode, (await demo.Flight(next.Id)).StandCode));
        var board = await PositionsBoardAsync(demo, ct);
        Assert.Equal(("planned", nextTurnaround),
            (BoardPosition(board, "A03").Status, Assert.Single(BoardPosition(board, "A03").Turnarounds).TurnaroundId));
        Assert.Empty(ListedOn(board, operated.TurnaroundId));
    }

    /// <summary>
    /// A stand whose only flight pushed back can be deactivated in «Datos maestros», which refused it while the aircraft
    /// was there. The operation the agent still runs keeps its stand on the tablet: a started one follows its open
    /// assignment, active stand or not (3-N03).
    /// </summary>
    [Fact]
    public async Task AStandWhoseOnlyFlightPushedBackCanBeDeactivated()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var demo = await DemoFlightsAsync(database, ct);
        var operated = await OperatedOnStandAsync(demo, demo.Stands["A03"], ct);
        async Task<MasterDataResult<MasterStandData>> Deactivated()
        {
            var row = Assert.Single((await demo.Run(services => services.GetRequiredService<IOccMasterDataStore>()
                .ReadAsync(SeededOccAccount, SeededPujStation, ct))).Value!.Stands, item => item.Code == "A03");
            return await demo.Run(services => services.GetRequiredService<IOccMasterDataStore>().UpdateStandAsync(
                SeededOccAccount, row.Id, new UpdateStandInput(row.TerminalId!.Value, row.Code, row.HasBoardingBridge,
                    row.IsRemote, row.MaxAircraftSize, false, row.Version), Guid.NewGuid(), ct));
        }

        demo.Clock.Now = operated.Flight.OnBlockAt.AddMinutes(20);
        var inUse = await Deactivated();
        Assert.Equal((MasterDataFailure.Conflict, "stand_in_use"), (inUse.Failure, inUse.Code));

        await PushedBackAsync(demo, operated, ct);
        var deactivated = await Deactivated();
        Assert.Null(deactivated.Failure);
        Assert.False(deactivated.Value!.IsActive);
        var tablet = await demo.Run(services => services.GetRequiredService<IRampOperationsReadStore>()
            .GetActiveAssignedOperationsAsync(SeededRampAgentAccount, [SeededPujStation], ct));
        var running = Assert.Single(tablet.Operations!, item => item.Operation.Id == operated.OperationId);
        Assert.Equal(("InProgress", "A03"), (running.Operation.Status, running.Turnaround.Stand?.Code));
    }

    /// <summary>
    /// After the push-back every reader of «the flight's stand» still names it: the forms of the tablet and of OCC, the
    /// tablet's operation, OCC's planning and the flight's detail, and the superadministrator's list. Only its occupancy
    /// ended. (OCC's assignment options answer only for a planned operation, which a push-back never is.)
    /// </summary>
    [Fact]
    public async Task AfterPushbackTheDocumentsTheTabletAndThePlanningSnapshotStillNameTheStand()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var demo = await DemoFlightsAsync(database, ct);
        var operated = await OperatedOnStandAsync(demo, demo.Stands["A03"], ct);
        await PushedBackAsync(demo, operated, ct);
        Assert.Equal("available", BoardPosition(await PositionsBoardAsync(demo, ct), "A03").Status);

        var forms = await demo.Run(services => services.GetRequiredService<IOperationDocumentStore>()
            .ReadForAgentAsync(SeededRampAgentAccount, [SeededPujStation], operated.OperationId, ct));
        Assert.NotEmpty(forms!.Documents);
        Assert.All(forms.Documents, document => Assert.Equal("A03", document.Content.Flight.Position));
        var reviewed = await demo.Run(services => services.GetRequiredService<IOperationDocumentStore>()
            .ReadForOccAsync([SeededPujStation], operated.OperationId, ct));
        Assert.All(reviewed!.Documents, document => Assert.Equal("A03", document.Content.Flight.Position));

        var tablet = await demo.Run(services => services.GetRequiredService<IRampOperationsReadStore>()
            .GetActiveAssignedOperationsAsync(SeededRampAgentAccount, [SeededPujStation], ct));
        Assert.Equal("A03", Assert.Single(tablet.Operations!, item => item.Operation.Id == operated.OperationId)
            .Turnaround.Stand?.Code);

        var snapshot = await demo.Run(services => services.GetRequiredService<IOccPlanningReadStore>()
            .GetSnapshotAsync(SeededPujStation, demo.Day, ct));
        Assert.Equal("A03", Assert.Single(snapshot!.Turnarounds, item => item.Id == operated.TurnaroundId).Stand?.Code);
        var detail = await demo.Run(services => services.GetRequiredService<IOccTurnaroundStore>()
            .ReadAsync(SeededOccAccount, operated.TurnaroundId, ct));
        Assert.Equal("A03", detail.Value!.Turnaround.Stand?.Code);
        Assert.Equal("A03", (await demo.Flight(operated.Flight.Id)).StandCode);
    }

    /// <summary>
    /// The agent corrects the push-back time on the tablet (the tap records it again): the milestone keeps the corrected
    /// time and the stand stays free.
    /// </summary>
    [Fact]
    public async Task CorrectingThePushbackTimeKeepsTheStandFree()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var demo = await DemoFlightsAsync(database, ct);
        var operated = await OperatedOnStandAsync(demo, demo.Stands["A03"], ct);
        var first = await PushedBackAsync(demo, operated, ct);

        demo.Clock.Now = first.AddMinutes(2);
        var corrected = first.AddMinutes(-5);
        await TappedAsync(demo, operated.OperationId, RampEvidenceTimePolicy.Pushback, corrected, ct);
        await using (var check = CreateContext(database.ConnectionString))
        {
            var operation = await check.GroundOperations.AsNoTracking().Where(item => item.PublicId == operated.OperationId)
                .Select(item => item.Id).SingleAsync(ct);
            Assert.Equal(corrected, (await check.Set<OperationMilestone>().AsNoTracking().SingleAsync(item =>
                item.GroundOperationId == operation && item.Code == RampEvidenceTimePolicy.Pushback, ct)).ActualAt);
        }

        var board = await PositionsBoardAsync(demo, ct);
        Assert.Equal(("available", 0), (BoardPosition(board, "A03").Status, BoardPosition(board, "A03").Turnarounds.Count));
        Assert.Empty(ListedOn(board, operated.TurnaroundId));
        Assert.True((await PlacementAsync(demo, demo.Stands["A03"], corrected, corrected.AddMinutes(60), ct)).Available);
        Assert.True(StandFree(await demo.Options(), "A03"));
    }

    /// <summary>
    /// Without a push-back the flight keeps holding its stand: with BLOCK_ON alone, and after the agent hands the
    /// operation off without tapping PUSHBACK, the board says «Ocupada» and another flight finds it taken.
    /// </summary>
    [Fact]
    public async Task AFlightWithoutPushbackStillHoldsItsStand()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var demo = await DemoFlightsAsync(database, ct);
        var operated = await OperatedOnStandAsync(demo, demo.Stands["A03"], ct);
        demo.Clock.Now = operated.Flight.OnBlockAt.AddMinutes(30);
        async Task StillHeld()
        {
            var board = await PositionsBoardAsync(demo, ct);
            Assert.Equal(("occupied", operated.TurnaroundId),
                (BoardPosition(board, "A03").Status, Assert.Single(BoardPosition(board, "A03").Turnarounds).TurnaroundId));
            Assert.Equal(["stand_taken"], (await PlacementAsync(demo, demo.Stands["A03"], demo.Now.AddMinutes(8),
                demo.Now.AddMinutes(68), ct)).Reasons);
            Assert.False(StandFree(await demo.Options(), "A03"));
        }
        await StillHeld();

        // The hand-off without PUSHBACK (its rules have their own tests): the rows as the submission leaves them.
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var operation = await setup.GroundOperations.SingleAsync(item => item.PublicId == operated.OperationId, ct);
            operation.CurrentStatus = GroundOperationStatus.PendingReview;
            operation.ActualEndAt = demo.Now;
            await setup.SaveChangesAsync(ct);
        }
        await StillHeld();
    }

    /// <summary>
    /// OCC's «Liberar» still closes the assignment after the push-back: the flight loses its stand of record, and the
    /// board lists it nowhere, since its aircraft left.
    /// </summary>
    [Fact]
    public async Task OccReleaseStillClosesTheAssignment()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var demo = await DemoFlightsAsync(database, ct);
        var operated = await OperatedOnStandAsync(demo, demo.Stands["A03"], ct);
        await PushedBackAsync(demo, operated, ct);

        demo.Clock.Now += TimeSpan.FromMinutes(1);
        var released = await demo.Run(services => services.GetRequiredService<IOccPositionStore>()
            .ReleaseAsync(SeededOccAccount, operated.TurnaroundId, OccPositionCommand.None, ct));
        Assert.Null(released.Failure);
        Assert.Equal("available", BoardPosition(released.Board!, "A03").Status);
        Assert.Empty(ListedOn(released.Board!, operated.TurnaroundId));
        await using (var check = CreateContext(database.ConnectionString))
        {
            var turnaround = await check.Turnarounds.AsNoTracking().Where(item => item.PublicId == operated.TurnaroundId)
                .Select(item => item.Id).SingleAsync(ct);
            var assignment = await check.Set<StandAssignment>().AsNoTracking()
                .SingleAsync(item => item.TurnaroundId == turnaround, ct);
            Assert.Equal(demo.Now, assignment.AssignedTo);
        }
        Assert.Null((await demo.Flight(operated.Flight.Id)).StandCode);
    }
}
