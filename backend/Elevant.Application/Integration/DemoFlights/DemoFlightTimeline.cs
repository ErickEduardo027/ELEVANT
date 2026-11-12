namespace Elevant.Application.Integration.DemoFlights;

/// <summary>Where a demo aircraft is at an instant. The map decides the place, never the phase.</summary>
public enum DemoFlightPhase
{
    /// <summary>Airborne towards the runway, from the moment it appears.</summary>
    Approach,

    /// <summary>On the ground, from the wheels on the runway to the stand.</summary>
    TaxiIn,

    /// <summary>At its stand, or waiting for one, until it leaves.</summary>
    Parked,

    /// <summary>From the off-block to the lift-off.</summary>
    TaxiOut,

    /// <summary>Airborne again and still in sight.</summary>
    Departed,

    /// <summary>No longer shown.</summary>
    Gone,
}

/// <summary>Only active demo flights count toward the limit of a station.</summary>
public enum DemoFlightState
{
    Active,
    Cancelled,
    Finished,
}

/// <summary>
/// What the rows of a demo flight say, read by the store (ADR-0041).
/// </summary>
/// <param name="AppearAt">When the flight was triggered: the arrival proposal's first-seen time, never rewritten.</param>
/// <param name="OnBlockAt">The arrival's scheduled time: the aircraft reaches its stand.</param>
/// <param name="ScheduledOffBlockAt">The departure's scheduled time.</param>
/// <param name="Imported">OCC imported the pair: the leg is linked and its turnaround is neither cancelled nor diverted.</param>
/// <param name="MarkedTakeoffAt">
/// The departure's runway time, once it is written. Only the progress worker writes it, with the take-off this clock
/// planned, so it is never earlier than the on-block plus <see cref="DemoFlightTimeline.TaxiOut"/>.
/// </param>
/// <param name="PushbackAt">The actual time of the operation's PUSHBACK milestone.</param>
/// <param name="HandedOffAt">The operation's actual end: the agent handed it off, with or without a push-back.</param>
/// <param name="FinishRequestedAt">
/// When «Terminar demo» brought the off-block forward (the departure's revised time), whether OCC imported the flight or
/// not.
/// </param>
/// <param name="CancelledAt">
/// When the flight was cancelled: by the superadministrator as the provider would, or by an account that dismissed a
/// proposal nobody had imported.
/// </param>
/// <param name="DismissedBySystem">
/// A row was dismissed without an account: the progress worker closed a pair nobody imported once it vanished, or
/// «Terminar demo» closed it at once.
/// </param>
public sealed record DemoFlightFacts(DateTimeOffset AppearAt, DateTimeOffset OnBlockAt, DateTimeOffset ScheduledOffBlockAt,
    bool Imported, DateTimeOffset? MarkedTakeoffAt, DateTimeOffset? PushbackAt, DateTimeOffset? HandedOffAt,
    DateTimeOffset? FinishRequestedAt, DateTimeOffset? CancelledAt, bool DismissedBySystem);

/// <summary>
/// The clock of a demo flight (ADR-0041). The server owns every instant and no client derives one: the progress worker
/// and every read resolve the same facts with this record, and the screens only decide where to draw the aircraft.
/// <see cref="TouchdownAt"/> is the wheels on the runway and <see cref="TakeoffAt"/> the lift-off.
/// The trigger schedules the on-block after the flight appears; whatever the rows say besides, the instants come in
/// order: <see cref="AppearAt"/> ≤ <see cref="TouchdownAt"/> ≤ <see cref="OnBlockAt"/> ≤ <see cref="OffBlockAt"/>,
/// <see cref="TakeoffAt"/> is the off-block plus <see cref="TaxiOut"/> and <see cref="VanishAt"/> the take-off plus
/// <see cref="DepartureVisible"/>, so a screen can fit every leg of the aircraft to them. <see cref="OffBlockAt"/>,
/// <see cref="TakeoffAt"/> and <see cref="VanishAt"/> are null while the aircraft waits at its stand for the agent; a
/// cancelled flight keeps only <see cref="VanishAt"/>, the instant it was cancelled, which may come before the landing.
/// </summary>
public sealed record DemoFlightTimeline(DateTimeOffset AppearAt, DateTimeOffset TouchdownAt, DateTimeOffset OnBlockAt,
    DateTimeOffset ScheduledOffBlockAt, DateTimeOffset? OffBlockAt, DateTimeOffset? TakeoffAt, DateTimeOffset? VanishAt,
    DemoFlightState State)
{
    /// <summary>The share of the time between appearing and parking that the aircraft spends on the ground.</summary>
    public const decimal TaxiInShare = 0.45m;

    public static readonly TimeSpan MinTaxiIn = TimeSpan.FromSeconds(90);

    public static readonly TimeSpan MaxTaxiIn = TimeSpan.FromMinutes(5);

    /// <summary>From the off-block to the lift-off.</summary>
    public static readonly TimeSpan TaxiOut = TimeSpan.FromMinutes(5);

    /// <summary>How long the aircraft stays in sight after the lift-off.</summary>
    public static readonly TimeSpan DepartureVisible = TimeSpan.FromMinutes(10);

    /// <summary>How long an imported aircraft waits for its agent past its schedule before it leaves by itself.</summary>
    public static readonly TimeSpan MaxHold = TimeSpan.FromHours(2);

    /// <summary>
    /// The taxi from the runway to the stand: 45 % of the time the aircraft has to park, at least 90 seconds and at
    /// most 5 minutes, in whole milliseconds (the precision instants are stored with). It never exceeds the span
    /// itself, so the touchdown is never before the aircraft appears.
    /// </summary>
    public static TimeSpan TaxiIn(TimeSpan span)
    {
        if (span <= TimeSpan.Zero) return TimeSpan.Zero;
        var ticks = (long)(span.Ticks * TaxiInShare);
        var share = TimeSpan.FromTicks(ticks - ticks % TimeSpan.TicksPerMillisecond);
        var taxi = share < MinTaxiIn ? MinTaxiIn : share > MaxTaxiIn ? MaxTaxiIn : share;
        return taxi < span ? taxi : span;
    }

    /// <summary>
    /// The instants of the flight as they stand at <paramref name="now"/>. A cancelled flight vanishes at the cancel
    /// instant and has no departure. Otherwise it is finished once its take-off is marked, a row was dismissed without
    /// an account or it is gone, and active until then. Once known, an instant never moves as time passes.
    /// </summary>
    public static DemoFlightTimeline Resolve(DemoFlightFacts facts, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(facts);
        var touchdownAt = facts.OnBlockAt - TaxiIn(facts.OnBlockAt - facts.AppearAt);
        if (facts.CancelledAt is { } cancelledAt)
            return new DemoFlightTimeline(facts.AppearAt, touchdownAt, facts.OnBlockAt, facts.ScheduledOffBlockAt, null, null,
                cancelledAt, DemoFlightState.Cancelled);

        var offBlockAt = OffBlock(facts, now);
        // The taxi to the runway always lasts TaxiOut: the take-off the worker marked is read back as it is, and one
        // that no writer could produce (sooner than a taxi after the on-block) is read as the earliest possible.
        var takeoffAt = offBlockAt + TaxiOut;
        var vanishAt = takeoffAt + DepartureVisible;
        var finished = facts.MarkedTakeoffAt is not null || facts.DismissedBySystem || now >= vanishAt;
        return new DemoFlightTimeline(facts.AppearAt, touchdownAt, facts.OnBlockAt, facts.ScheduledOffBlockAt, offBlockAt,
            takeoffAt, vanishAt, finished ? DemoFlightState.Finished : DemoFlightState.Active);
    }

    /// <summary>
    /// Where the aircraft is at <paramref name="now"/>. What already happened last decides: a cancelled flight is gone
    /// from its cancel instant, even before it would have landed. Any other flight has its instants in order, so its
    /// phase only moves forward as time passes and never skips the taxi to the runway.
    /// </summary>
    public DemoFlightPhase PhaseAt(DateTimeOffset now)
    {
        // An instant that is still null has not been reached: its comparison is false.
        if (now >= VanishAt) return DemoFlightPhase.Gone;
        if (now >= TakeoffAt) return DemoFlightPhase.Departed;
        if (now < TouchdownAt) return DemoFlightPhase.Approach;
        if (now < OnBlockAt) return DemoFlightPhase.TaxiIn;
        return now >= OffBlockAt ? DemoFlightPhase.TaxiOut : DemoFlightPhase.Parked;
    }

    /// <summary>
    /// When the aircraft leaves its stand, by the first rule that applies: the take-off already marked, minus the taxi;
    /// the push-back the tablet recorded; the hand-off of the operation; «Terminar demo»; an imported flight waits
    /// (null) until <see cref="MaxHold"/> after its schedule; a flight nobody imported leaves on schedule. Never before
    /// the on-block: whatever says the aircraft left earlier (the tablet, the superadministrator or a take-off marked too
    /// soon) takes effect when it parks.
    /// </summary>
    private static DateTimeOffset? OffBlock(DemoFlightFacts facts, DateTimeOffset now)
    {
        var leavesAt = (facts.MarkedTakeoffAt - TaxiOut) ?? facts.PushbackAt ?? facts.HandedOffAt ?? facts.FinishRequestedAt;
        if (leavesAt is null)
        {
            var holdEndsAt = facts.ScheduledOffBlockAt + MaxHold;
            if (!facts.Imported) leavesAt = facts.ScheduledOffBlockAt;
            else if (now >= holdEndsAt) leavesAt = holdEndsAt;
            else return null;
        }
        return leavesAt.Value < facts.OnBlockAt ? facts.OnBlockAt : leavesAt.Value;
    }
}
