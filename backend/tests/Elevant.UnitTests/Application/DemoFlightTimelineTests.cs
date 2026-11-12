using Elevant.Application.Integration.DemoFlights;

namespace Elevant.UnitTests.Application;

/// <summary>
/// ADR-0041: the clock of a demo flight. The server owns every instant (the aircraft appears, touches down, parks,
/// leaves the stand, takes off and vanishes); the screens only decide where to draw it.
/// </summary>
public sealed class DemoFlightTimelineTests
{
    // Triggered at 14:00 UTC to park in 8 minutes and stay an hour: touchdown 14:04:24, on-block 14:08, off-block 15:08.
    private static readonly DateTimeOffset Appear = At(14, 0);
    private static readonly DateTimeOffset Touchdown = At(14, 4, 24);
    private static readonly DateTimeOffset OnBlock = At(14, 8);
    private static readonly DateTimeOffset ScheduledOffBlock = At(15, 8);

    private static DateTimeOffset At(int hour, int minute, int second = 0) =>
        new(2026, 11, 12, hour, minute, second, TimeSpan.Zero);

    private static DemoFlightFacts Facts(bool imported = false, DateTimeOffset? markedTakeoffAt = null,
        DateTimeOffset? pushbackAt = null, DateTimeOffset? handedOffAt = null, DateTimeOffset? finishRequestedAt = null,
        DateTimeOffset? cancelledAt = null, bool dismissedBySystem = false) =>
        new(Appear, OnBlock, ScheduledOffBlock, imported, markedTakeoffAt, pushbackAt, handedOffAt, finishRequestedAt,
            cancelledAt, dismissedBySystem);

    private static void AssertDeparture(DemoFlightTimeline timeline, DateTimeOffset? offBlockAt, DateTimeOffset? takeoffAt,
        DateTimeOffset? vanishAt)
    {
        Assert.Equal(offBlockAt, timeline.OffBlockAt);
        Assert.Equal(takeoffAt, timeline.TakeoffAt);
        Assert.Equal(vanishAt, timeline.VanishAt);
    }

    [Theory]
    [InlineData(2, 90)]
    [InlineData(3, 90)]
    [InlineData(5, 135)]
    [InlineData(8, 216)]
    [InlineData(11, 297)]
    [InlineData(12, 300)]
    [InlineData(15, 300)]
    [InlineData(30, 300)]
    public void TaxiInIsFortyFivePercentOfTheSpanBetweenNinetySecondsAndFiveMinutes(int minutesToOnBlock, int taxiSeconds)
    {
        Assert.Equal(TimeSpan.FromSeconds(taxiSeconds), DemoFlightTimeline.TaxiIn(TimeSpan.FromMinutes(minutesToOnBlock)));

        var onBlock = Appear.AddMinutes(minutesToOnBlock);
        var timeline = DemoFlightTimeline.Resolve(
            new DemoFlightFacts(Appear, onBlock, onBlock.AddMinutes(60), false, null, null, null, null, null, false), Appear);

        Assert.Equal(Appear, timeline.AppearAt);
        Assert.Equal(onBlock.AddSeconds(-taxiSeconds), timeline.TouchdownAt);
        Assert.Equal(onBlock, timeline.OnBlockAt);
        Assert.Equal(onBlock.AddMinutes(60), timeline.ScheduledOffBlockAt);
    }

    /// <summary>Instants are stored with milliseconds: the split never leaves a fraction the database would round.</summary>
    [Fact]
    public void TaxiInKeepsWholeMilliseconds() =>
        Assert.Equal(TimeSpan.FromMilliseconds(149_999), DemoFlightTimeline.TaxiIn(TimeSpan.FromMilliseconds(333_333)));

    /// <summary>
    /// The form never asks for less than two minutes, but the clock stays ordered with any span: under the 90-second
    /// floor the whole span is taxi and the aircraft appears on the runway.
    /// </summary>
    [Theory]
    [InlineData(0, 0)]
    [InlineData(30, 0)]
    [InlineData(89, 0)]
    [InlineData(90, 0)]
    [InlineData(100, 10)]
    [InlineData(120, 30)]
    public void TouchdownIsNeverBeforeTheAircraftAppears(int secondsToOnBlock, int secondsOnApproach)
    {
        var onBlock = Appear.AddSeconds(secondsToOnBlock);
        var timeline = DemoFlightTimeline.Resolve(
            new DemoFlightFacts(Appear, onBlock, onBlock.AddMinutes(60), false, null, null, null, null, null, false), Appear);

        Assert.Equal(Appear.AddSeconds(secondsOnApproach), timeline.TouchdownAt);
        Assert.InRange(timeline.TouchdownAt, timeline.AppearAt, timeline.OnBlockAt);
    }

    [Fact]
    public void AFlightNobodyImportedLeavesOnSchedule()
    {
        // The departure is known from the first read, an hour before it happens.
        var early = DemoFlightTimeline.Resolve(Facts(), At(14, 1));
        AssertDeparture(early, ScheduledOffBlock, At(15, 13), At(15, 23));
        Assert.Equal(DemoFlightState.Active, early.State);

        var leaving = DemoFlightTimeline.Resolve(Facts(), ScheduledOffBlock);
        AssertDeparture(leaving, ScheduledOffBlock, At(15, 13), At(15, 23));
        Assert.Equal(DemoFlightPhase.TaxiOut, leaving.PhaseAt(ScheduledOffBlock));
    }

    [Fact]
    public void AnImportedFlightNobodyStartedWaitsPastItsScheduledOffBlock()
    {
        foreach (var now in new[] { At(14, 30), ScheduledOffBlock, At(15, 30), At(17, 7, 59) })
        {
            var timeline = DemoFlightTimeline.Resolve(Facts(imported: true), now);

            AssertDeparture(timeline, null, null, null);
            Assert.Equal(DemoFlightPhase.Parked, timeline.PhaseAt(now));
            Assert.Equal(DemoFlightState.Active, timeline.State);
        }
    }

    [Fact]
    public void AFlightImportedAfterItsScheduledOffBlockWaitsToo()
    {
        var now = At(15, 10);
        var notImported = DemoFlightTimeline.Resolve(Facts(), now);
        Assert.Equal(ScheduledOffBlock, notImported.OffBlockAt);
        Assert.Equal(DemoFlightPhase.TaxiOut, notImported.PhaseAt(now));

        // OCC imports it two minutes after it left: it is back on its stand, waiting for the agent.
        var imported = DemoFlightTimeline.Resolve(Facts(imported: true), now);
        AssertDeparture(imported, null, null, null);
        Assert.Equal(DemoFlightPhase.Parked, imported.PhaseAt(now));
        Assert.Equal(DemoFlightState.Active, imported.State);
    }

    [Fact]
    public void PushbackBeforeOnBlockParksFirstAndThenLeaves()
    {
        var timeline = DemoFlightTimeline.Resolve(Facts(imported: true, pushbackAt: At(14, 6)), At(14, 6, 30));

        AssertDeparture(timeline, OnBlock, At(14, 13), At(14, 23));
        Assert.Equal(DemoFlightPhase.TaxiIn, timeline.PhaseAt(At(14, 7, 59)));
        Assert.Equal(DemoFlightPhase.TaxiOut, timeline.PhaseAt(OnBlock));
    }

    [Fact]
    public void AHandOffWithoutPushbackReleasesTheAircraft()
    {
        AssertDeparture(DemoFlightTimeline.Resolve(Facts(imported: true, handedOffAt: At(14, 40)), At(14, 41)),
            At(14, 40), At(14, 45), At(14, 55));
        // With both, the aircraft left when the push-back was recorded.
        AssertDeparture(
            DemoFlightTimeline.Resolve(Facts(imported: true, pushbackAt: At(14, 35), handedOffAt: At(14, 40)), At(14, 41)),
            At(14, 35), At(14, 40), At(14, 50));
        // An operation handed off before the aircraft parked still lets it reach the stand.
        AssertDeparture(DemoFlightTimeline.Resolve(Facts(imported: true, handedOffAt: At(14, 5)), At(14, 6)),
            OnBlock, At(14, 13), At(14, 23));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void ACancellationBeforeTouchdownVanishesAtTheCancelInstant(bool imported)
    {
        var cancelledAt = At(14, 2);
        var timeline = DemoFlightTimeline.Resolve(Facts(imported: imported, cancelledAt: cancelledAt), At(14, 2, 5));

        Assert.Equal(DemoFlightState.Cancelled, timeline.State);
        AssertDeparture(timeline, null, null, cancelledAt);
        Assert.Equal(DemoFlightPhase.Approach, timeline.PhaseAt(At(14, 1, 59)));
        Assert.Equal(DemoFlightPhase.Gone, timeline.PhaseAt(cancelledAt));
        Assert.Equal(DemoFlightPhase.Gone, timeline.PhaseAt(At(15, 30)));
        // The landing that was planned stays readable, although it never happens.
        Assert.Equal(Touchdown, timeline.TouchdownAt);
        Assert.Equal(OnBlock, timeline.OnBlockAt);
    }

    /// <summary>OCC can dismiss a proposal nobody imported at any moment: the flight ends there, without a departure.</summary>
    [Fact]
    public void ACancelledFlightHasNoDeparture()
    {
        var timeline = DemoFlightTimeline.Resolve(Facts(cancelledAt: At(15, 10)), At(15, 11));

        Assert.Equal(DemoFlightState.Cancelled, timeline.State);
        AssertDeparture(timeline, null, null, At(15, 10));
        Assert.Equal(DemoFlightPhase.Gone, timeline.PhaseAt(At(15, 11)));
    }

    [Fact]
    public void TheMaxHoldReleasesAnImportedFlightAfterTwoHours()
    {
        var waiting = DemoFlightTimeline.Resolve(Facts(imported: true), At(17, 7, 59));
        AssertDeparture(waiting, null, null, null);

        var released = DemoFlightTimeline.Resolve(Facts(imported: true), At(17, 8));
        AssertDeparture(released, At(17, 8), At(17, 13), At(17, 23));
        Assert.Equal(DemoFlightPhase.TaxiOut, released.PhaseAt(At(17, 8)));
        Assert.Equal(DemoFlightState.Active, released.State);

        // Read later, the release is still that instant and not the moment of the read.
        var later = DemoFlightTimeline.Resolve(Facts(imported: true), At(17, 40));
        AssertDeparture(later, At(17, 8), At(17, 13), At(17, 23));
        Assert.Equal(DemoFlightState.Finished, later.State);
    }

    [Fact]
    public void TakeoffIsFiveMinutesAfterOffBlockAndTheAircraftVanishesTenMinutesLater()
    {
        var timeline = DemoFlightTimeline.Resolve(Facts(imported: true, pushbackAt: At(14, 50)), At(14, 50));

        AssertDeparture(timeline, At(14, 50), At(14, 55), At(15, 5));
        Assert.Equal(DemoFlightPhase.Parked, timeline.PhaseAt(At(14, 49, 59)));
        Assert.Equal(DemoFlightPhase.TaxiOut, timeline.PhaseAt(At(14, 50)));
        Assert.Equal(DemoFlightPhase.TaxiOut, timeline.PhaseAt(At(14, 54, 59)));
        Assert.Equal(DemoFlightPhase.Departed, timeline.PhaseAt(At(14, 55)));
        Assert.Equal(DemoFlightPhase.Departed, timeline.PhaseAt(At(15, 4, 59)));
        Assert.Equal(DemoFlightPhase.Gone, timeline.PhaseAt(At(15, 5)));
    }

    [Fact]
    public void AMarkedTakeoffFixesTheOffBlock()
    {
        // The worker marked the take-off at 14:55: a push-back corrected afterwards no longer moves the aircraft.
        var marked = DemoFlightTimeline.Resolve(
            Facts(imported: true, markedTakeoffAt: At(14, 55), pushbackAt: At(14, 52)), At(14, 56));
        AssertDeparture(marked, At(14, 50), At(14, 55), At(15, 5));
        Assert.Equal(DemoFlightPhase.Departed, marked.PhaseAt(At(14, 56)));
        Assert.Equal(DemoFlightState.Finished, marked.State);
    }

    /// <summary>
    /// No writer marks a take-off sooner than a taxi after the on-block: the worker writes the one this clock planned,
    /// and «Terminar demo» brings the off-block forward instead. A row that says so anyway never puts the departure
    /// before the arrival: the aircraft parks, leaves at once and takes off a taxi later. The marked take-off still ends
    /// the flight.
    /// </summary>
    [Theory]
    [InlineData(8, 6 * 60)]  // 14:06, while it taxis in: minus the taxi, it would have left its stand on approach
    [InlineData(8, 60)]      // 14:01, on approach
    [InlineData(8, 10 * 60)] // 14:10, parked, but sooner than a taxi after the on-block
    [InlineData(2, 40)]      // two minutes to the stand: 14:00:40 minus the taxi is before the aircraft appeared
    public void ATakeoffMarkedTooSoonNeverPutsTheDepartureBeforeTheOnBlock(int minutesToOnBlock, int markedAfterSeconds)
    {
        var onBlock = Appear.AddMinutes(minutesToOnBlock);
        var markedAt = Appear.AddSeconds(markedAfterSeconds);
        var timeline = DemoFlightTimeline.Resolve(
            new DemoFlightFacts(Appear, onBlock, onBlock.AddMinutes(60), false, markedAt, null, null, null, null, false), markedAt);

        Assert.True(timeline.OffBlockAt >= timeline.OnBlockAt);
        Assert.True(timeline.TakeoffAt >= timeline.OffBlockAt + DemoFlightTimeline.TaxiOut);
        AssertDeparture(timeline, onBlock, onBlock.AddMinutes(5), onBlock.AddMinutes(15));
        Assert.Equal(DemoFlightState.Finished, timeline.State);
        Assert.Equal([DemoFlightPhase.TaxiIn, DemoFlightPhase.TaxiOut, DemoFlightPhase.Departed, DemoFlightPhase.Gone],
            new[] { timeline.TouchdownAt, onBlock, onBlock.AddMinutes(5), onBlock.AddMinutes(15) }.Select(timeline.PhaseAt));
    }

    [Fact]
    public void FinishingBringsTheOffBlockForwardButNeverBeforeOnBlock()
    {
        // Forty-eight minutes before the schedule, imported or not.
        AssertDeparture(DemoFlightTimeline.Resolve(Facts(imported: true, finishRequestedAt: At(14, 20)), At(14, 20)),
            At(14, 20), At(14, 25), At(14, 35));
        AssertDeparture(DemoFlightTimeline.Resolve(Facts(finishRequestedAt: At(14, 20)), At(14, 20)),
            At(14, 20), At(14, 25), At(14, 35));
        // Asked while the aircraft still taxis in: it parks first.
        AssertDeparture(DemoFlightTimeline.Resolve(Facts(imported: true, finishRequestedAt: At(14, 6)), At(14, 6)),
            OnBlock, At(14, 13), At(14, 23));
        // What the tablet recorded outranks the request.
        AssertDeparture(
            DemoFlightTimeline.Resolve(Facts(imported: true, handedOffAt: At(14, 30), finishRequestedAt: At(14, 20)), At(14, 31)),
            At(14, 30), At(14, 35), At(14, 45));
    }

    /// <summary>
    /// «Terminar demo» on a flight nobody imported writes the same off-block and closes the pair at once, without an
    /// account: the flight is finished, but its aircraft still parks, leaves its stand and takes off in that order.
    /// </summary>
    [Fact]
    public void FinishingAFlightNobodyImportedEndsItWithTheDepartureInOrder()
    {
        // Asked at 14:06, while it taxis in: the off-block written is the on-block.
        var taxiing = DemoFlightTimeline.Resolve(Facts(finishRequestedAt: OnBlock, dismissedBySystem: true), At(14, 6));
        Assert.Equal(DemoFlightState.Finished, taxiing.State);
        AssertDeparture(taxiing, OnBlock, At(14, 13), At(14, 23));
        Assert.Equal([DemoFlightPhase.TaxiIn, DemoFlightPhase.TaxiOut, DemoFlightPhase.Departed, DemoFlightPhase.Gone],
            new[] { At(14, 6), OnBlock, At(14, 13), At(14, 23) }.Select(taxiing.PhaseAt));

        // Asked while it is parked: it leaves at that instant.
        var parked = DemoFlightTimeline.Resolve(Facts(finishRequestedAt: At(14, 20), dismissedBySystem: true), At(14, 20));
        Assert.Equal(DemoFlightState.Finished, parked.State);
        AssertDeparture(parked, At(14, 20), At(14, 25), At(14, 35));
        Assert.Equal(DemoFlightPhase.TaxiOut, parked.PhaseAt(At(14, 20)));
    }

    /// <summary>
    /// Whatever the tablet, OCC, the superadministrator and the worker wrote, and whenever they wrote it, the instants
    /// come in order: the aircraft appears, touches down, parks, leaves its stand, takes off a taxi later and vanishes
    /// once it was in sight long enough. Its phase never moves back as time passes, a cancelled aircraft is gone from its
    /// cancel instant, and an instant or an end, once known, never changes later. The facts are random but repeatable
    /// (one seed per case): the schedule as the trigger writes it, with spans down to zero, and every other fact absent
    /// or at any instant from before the trigger to after the longest wait.
    /// </summary>
    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    [InlineData(5)]
    public void TheInstantsComeInOrderWhateverTheRowsSay(int seed)
    {
        var random = new Random(seed);
        for (var sample = 0; sample < 400; sample++)
        {
            var facts = RandomFacts(random);
            var latest = facts.ScheduledOffBlockAt + DemoFlightTimeline.MaxHold + TimeSpan.FromHours(1);
            var nows = Enumerable.Range(0, 8).Select(_ => Between(random, facts.AppearAt.AddMinutes(-5), latest))
                .Append(facts.ScheduledOffBlockAt + DemoFlightTimeline.MaxHold).Order().ToArray();
            DemoFlightTimeline? earlier = null;
            foreach (var now in nows)
            {
                var timeline = DemoFlightTimeline.Resolve(facts, now);
                var context = $"seed {seed}, sample {sample}, {facts} at {now:O} gives {timeline}";
                AssertInOrder(facts, timeline, context);
                // The state follows the phase: a flight is never active once its aircraft is gone.
                Assert.True(timeline.State != DemoFlightState.Active || timeline.PhaseAt(now) != DemoFlightPhase.Gone, context);
                AssertPhasesMoveForward(timeline, random, latest, context);
                if (earlier is not null) AssertNothingKnownChanges(earlier, timeline, context);
                earlier = timeline;
            }
        }
    }

    private static DateTimeOffset Between(Random random, DateTimeOffset from, DateTimeOffset to) =>
        from.AddMilliseconds(random.NextInt64(0, (long)(to - from).TotalMilliseconds + 1));

    /// <summary>
    /// The schedule as the trigger writes it, with spans down to zero (the form asks 2 to 30 minutes to the stand and
    /// 20 to 240 on the ground), and every other fact absent or at any instant around the flight.
    /// </summary>
    private static DemoFlightFacts RandomFacts(Random random)
    {
        var onBlock = Between(random, Appear, Appear.AddMinutes(30));
        var scheduledOffBlock = Between(random, onBlock, onBlock.AddMinutes(240));
        var earliest = Appear.AddMinutes(-10);
        var latest = scheduledOffBlock + DemoFlightTimeline.MaxHold + TimeSpan.FromHours(1);
        DateTimeOffset? Maybe(DateTimeOffset from) => random.Next(3) == 0 ? Between(random, from, latest) : null;
        return new DemoFlightFacts(Appear, onBlock, scheduledOffBlock, Imported: random.Next(2) == 0,
            MarkedTakeoffAt: Maybe(earliest), PushbackAt: Maybe(earliest), HandedOffAt: Maybe(earliest),
            FinishRequestedAt: Maybe(earliest), CancelledAt: random.Next(5) == 0 ? Between(random, Appear, latest) : null,
            DismissedBySystem: random.Next(4) == 0);
    }

    private static void AssertInOrder(DemoFlightFacts facts, DemoFlightTimeline timeline, string context)
    {
        Assert.True((timeline.AppearAt, timeline.OnBlockAt, timeline.ScheduledOffBlockAt) ==
            (facts.AppearAt, facts.OnBlockAt, facts.ScheduledOffBlockAt), context);
        Assert.True(timeline.AppearAt <= timeline.TouchdownAt && timeline.TouchdownAt <= timeline.OnBlockAt, context);
        if (facts.CancelledAt is { } cancelledAt)
        {
            Assert.True(timeline.State == DemoFlightState.Cancelled && timeline.OffBlockAt is null &&
                timeline.TakeoffAt is null && timeline.VanishAt == cancelledAt, context);
            return;
        }
        Assert.True(timeline.State != DemoFlightState.Cancelled, context);
        if (timeline.OffBlockAt is not { } offBlockAt)
        {
            // An imported aircraft waits for its agent: nothing after the stand is known yet.
            Assert.True(facts.Imported && timeline.TakeoffAt is null && timeline.VanishAt is null, context);
            return;
        }
        Assert.True(timeline.OnBlockAt <= offBlockAt, context);
        Assert.True(timeline.TakeoffAt == offBlockAt + DemoFlightTimeline.TaxiOut, context);
        Assert.True(timeline.VanishAt == timeline.TakeoffAt + DemoFlightTimeline.DepartureVisible, context);
        // A take-off the worker could have marked is read back as it is.
        if (facts.MarkedTakeoffAt >= facts.OnBlockAt + DemoFlightTimeline.TaxiOut)
            Assert.True(timeline.TakeoffAt == facts.MarkedTakeoffAt, context);
    }

    private static void AssertPhasesMoveForward(DemoFlightTimeline timeline, Random random, DateTimeOffset latest,
        string context)
    {
        var times = new[]
            {
                timeline.AppearAt, timeline.TouchdownAt, timeline.OnBlockAt, timeline.OffBlockAt, timeline.TakeoffAt,
                timeline.VanishAt,
            }
            .OfType<DateTimeOffset>()
            .SelectMany(at => new[] { at.AddMilliseconds(-1), at, at.AddMilliseconds(1) })
            .Concat(Enumerable.Range(0, 8).Select(_ => Between(random, timeline.AppearAt.AddMinutes(-5), latest)))
            .Order().ToArray();
        var phases = times.Select(timeline.PhaseAt).ToArray();
        for (var index = 1; index < phases.Length; index++)
            Assert.True(phases[index] >= phases[index - 1],
                $"{context}: {phases[index - 1]} at {times[index - 1]:O}, then {phases[index]} at {times[index]:O}");

        if (timeline.State == DemoFlightState.Cancelled)
        {
            // Gone from the cancel instant and never on its way out before it.
            var cancelledAt = timeline.VanishAt!.Value;
            Assert.True(timeline.PhaseAt(cancelledAt) == DemoFlightPhase.Gone &&
                times.Where(at => at < cancelledAt).All(at => timeline.PhaseAt(at) <= DemoFlightPhase.Parked), context);
            return;
        }
        if (timeline.OffBlockAt is not { } offBlockAt)
        {
            // Waiting for its agent, the aircraft stays at its stand.
            Assert.True(phases.All(phase => phase <= DemoFlightPhase.Parked), context);
            return;
        }
        // No phase of the departure is skipped: the taxi out and the time in sight last what they should.
        var takeoffAt = timeline.TakeoffAt!.Value;
        var vanishAt = timeline.VanishAt!.Value;
        Assert.True(timeline.PhaseAt(offBlockAt) == DemoFlightPhase.TaxiOut &&
            timeline.PhaseAt(takeoffAt.AddMilliseconds(-1)) == DemoFlightPhase.TaxiOut &&
            timeline.PhaseAt(takeoffAt) == DemoFlightPhase.Departed &&
            timeline.PhaseAt(vanishAt.AddMilliseconds(-1)) == DemoFlightPhase.Departed &&
            timeline.PhaseAt(vanishAt) == DemoFlightPhase.Gone, context);
    }

    private static void AssertNothingKnownChanges(DemoFlightTimeline earlier, DemoFlightTimeline later, string context)
    {
        Assert.True(later.TouchdownAt == earlier.TouchdownAt, context);
        if (earlier.VanishAt is not null)
            Assert.True((later.OffBlockAt, later.TakeoffAt, later.VanishAt) ==
                (earlier.OffBlockAt, earlier.TakeoffAt, earlier.VanishAt), context);
        if (earlier.State != DemoFlightState.Active) Assert.True(later.State == earlier.State, context);
    }

    [Theory]
    [InlineData(13, 59, 0, DemoFlightPhase.Approach)]
    [InlineData(14, 0, 0, DemoFlightPhase.Approach)]
    [InlineData(14, 4, 23, DemoFlightPhase.Approach)]
    [InlineData(14, 4, 24, DemoFlightPhase.TaxiIn)]
    [InlineData(14, 7, 59, DemoFlightPhase.TaxiIn)]
    [InlineData(14, 8, 0, DemoFlightPhase.Parked)]
    [InlineData(15, 7, 59, DemoFlightPhase.Parked)]
    [InlineData(15, 8, 0, DemoFlightPhase.TaxiOut)]
    [InlineData(15, 12, 59, DemoFlightPhase.TaxiOut)]
    [InlineData(15, 13, 0, DemoFlightPhase.Departed)]
    [InlineData(15, 22, 59, DemoFlightPhase.Departed)]
    [InlineData(15, 23, 0, DemoFlightPhase.Gone)]
    [InlineData(18, 0, 0, DemoFlightPhase.Gone)]
    public void PhaseAtEachInstant(int hour, int minute, int second, DemoFlightPhase phase)
    {
        var now = At(hour, minute, second);

        Assert.Equal(phase, DemoFlightTimeline.Resolve(Facts(), now).PhaseAt(now));
    }

    [Fact]
    public void StateIsCancelledFinishedOrActive()
    {
        // Active while the aircraft is on its way, parked or still in sight after a take-off nobody marked.
        Assert.Equal(DemoFlightState.Active, DemoFlightTimeline.Resolve(Facts(), At(14, 1)).State);
        Assert.Equal(DemoFlightState.Active, DemoFlightTimeline.Resolve(Facts(imported: true), At(16, 30)).State);
        Assert.Equal(DemoFlightState.Active, DemoFlightTimeline.Resolve(Facts(), At(15, 22, 59)).State);
        // Finished once it is gone, the worker dismissed the pair or the take-off is marked.
        Assert.Equal(DemoFlightState.Finished, DemoFlightTimeline.Resolve(Facts(), At(15, 23)).State);
        Assert.Equal(DemoFlightState.Finished, DemoFlightTimeline.Resolve(Facts(dismissedBySystem: true), At(14, 1)).State);
        Assert.Equal(DemoFlightState.Finished,
            DemoFlightTimeline.Resolve(Facts(imported: true, markedTakeoffAt: At(14, 55)), At(14, 55)).State);
        // A cancellation outranks the rest.
        Assert.Equal(DemoFlightState.Cancelled, DemoFlightTimeline.Resolve(
            Facts(markedTakeoffAt: At(15, 13), cancelledAt: At(15, 14), dismissedBySystem: true), At(16, 0)).State);
    }
}
