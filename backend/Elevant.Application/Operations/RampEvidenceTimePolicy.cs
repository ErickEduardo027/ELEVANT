using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations;

/// <summary>
/// The span in which a time the tablet captured is evidence of an operation (3-N25): from its start, or the recorded
/// arrival when the aircraft arrived first, to its close. Both ends are inclusive.
/// </summary>
public sealed record RampEvidenceWindow(DateTimeOffset Opens, DateTimeOffset Closes)
{
    public bool Contains(DateTimeOffset at) => at >= Opens && at <= Closes;
}

/// <summary>
/// The one rule of «when is a tablet time valid» (phase 3, block C): the start, the service transitions, the
/// milestones, the walk-around damages and the incidents all go through it. The tablet stamps the moment of the tap
/// (corrected by the server clock, 3-N18) and may send it hours later from its offline queue; the server keeps it if
/// it fits the operation and stores it clamped to its own clock, so no stored time is in the future.
/// </summary>
public static class RampEvidenceTimePolicy
{
    /// <summary>Clock skew tolerated between the tablet and the server.</summary>
    public static readonly TimeSpan ClockTolerance = RampExecutionPolicy.FutureTolerance;

    /// <summary>How long a start may wait in the tablet's offline queue before it reaches the server.</summary>
    public static readonly TimeSpan MaxOfflineDelay = RampExecutionPolicy.MaxOfflineDelay;

    public const string BlockOn = "BLOCK_ON";
    public const string Pushback = "PUSHBACK";

    /// <summary>
    /// The start the agent tapped: not before the assignment it starts (nor more than a day ago, the offline queue's
    /// limit) and not in the future, both with the clock tolerance.
    /// </summary>
    public static bool CheckStart(DateTimeOffset startedAt, DateTimeOffset assignedAt, DateTimeOffset now)
    {
        var floor = assignedAt > now - MaxOfflineDelay ? assignedAt : now - MaxOfflineDelay;
        return startedAt >= floor - ClockTolerance && startedAt <= now + ClockTolerance;
    }

    /// <summary>
    /// When the evidence window closes: the hand-off while OCC reviews it (late evidence captured before it, 3-N06),
    /// the first hand-off during a correction round (3-N09: the facts of the flight do not move to the resubmission),
    /// otherwise it is still open. <c>firstSubmittedAt</c> is when the operation was handed to OCC the first time, if
    /// it ever was.
    /// </summary>
    public static DateTimeOffset? ClosedAt(GroundOperationStatus status, DateTimeOffset? actualEndAt,
        DateTimeOffset? firstSubmittedAt) =>
        status == GroundOperationStatus.PendingReview && actualEndAt is not null ? actualEndAt : firstSubmittedAt;

    /// <summary>
    /// The window of milestones, damages and incidents: from the start or the recorded arrival, whichever came first,
    /// to the close (or now), with the clock tolerance on both ends and never beyond now plus the tolerance. There is
    /// no fixed 24-hour limit: the start already was.
    /// </summary>
    public static RampEvidenceWindow WindowFor(DateTimeOffset actualStartAt, DateTimeOffset? arrivalActualAt,
        DateTimeOffset? closedAt, DateTimeOffset now)
    {
        var opens = (arrivalActualAt is { } arrival && arrival < actualStartAt ? arrival : actualStartAt) - ClockTolerance;
        var latest = now + ClockTolerance;
        var closes = closedAt is { } close && close + ClockTolerance < latest ? close + ClockTolerance : latest;
        return new RampEvidenceWindow(opens, closes);
    }

    /// <summary>A milestone, damage or incident time: inside the window, or the code it breaks.</summary>
    public static string? CheckEvidence(DateTimeOffset at, RampEvidenceWindow window) =>
        window.Contains(at) ? null : RampProblemCodes.TimeOutsideOperationWindow;

    /// <summary>
    /// A service transition's time: inside the window's opening and now (a correction round may record the current
    /// time), and never before the service's last transition. Null when it is valid, otherwise the code it breaks.
    /// </summary>
    public static string? CheckServiceTime(DateTimeOffset at, DateTimeOffset opens, DateTimeOffset? lastEventAt,
        DateTimeOffset now) =>
        at < opens || at > now + ClockTolerance ? RampProblemCodes.TimeOutsideOperationWindow
        : lastEventAt is { } last && at < last ? RampProblemCodes.ServiceTimeOutOfOrder
        : null;

    /// <summary>
    /// Block-on never comes after push-back (3-N25): the pair measures the ground time that decides the surcharges.
    /// The other milestones are not ordered; their typos are OCC's to correct in the review. <c>recorded</c> holds the
    /// operation's other recorded milestones, by code.
    /// </summary>
    public static bool IsInOrder(string code, DateTimeOffset at, IReadOnlyDictionary<string, DateTimeOffset> recorded) =>
        code switch
        {
            BlockOn => !recorded.TryGetValue(Pushback, out var pushback) || at <= pushback,
            Pushback => !recorded.TryGetValue(BlockOn, out var blockOn) || blockOn <= at,
            _ => true,
        };

    /// <summary>The stored time: the tolerance admits a tablet slightly ahead, but nothing is stored in the future.</summary>
    public static DateTimeOffset Clamp(DateTimeOffset at, DateTimeOffset now) => at > now ? now : at;
}
