using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations;

/// <summary>
/// What occupies a ramp agent and a stand (AVIAM OCC rules, 3-D): an agent never carries more than
/// <see cref="MaxSimultaneousOperations"/> operations whose windows overlap, and an operation holds its agent while it
/// is assigned, in progress or returned for correction. Once the agent handed it over (pending or in review) or OCC
/// approved it, the agent is free; the approved operation keeps its agent and stand of record (documents, attendance,
/// reports and the reopening read them), it only stops occupying them. The stand is free sooner, once the tablet
/// records the push-back (<see cref="HasLeftStand"/>). Planning, the stand reassignment, the handover and the
/// reschedule of a flight count with this one rule.
/// </summary>
public static class OperationOccupancyRules
{
    /// <summary>An agent never carries more than this many simultaneous operations.</summary>
    public const int MaxSimultaneousOperations = 3;

    /// <summary>The operation keeps its open agent assignments busy in its window.</summary>
    public static bool HoldsAgent(GroundOperationStatus status) =>
        status is GroundOperationStatus.Assigned or GroundOperationStatus.InProgress or GroundOperationStatus.Returned;

    /// <summary>
    /// The operation keeps its stand taken in its window: not while it is cancelled or approved, nor once its turnaround
    /// is completed, cancelled or diverted. A closed flight never blocks its stand, even without a planned window.
    /// </summary>
    public static bool HoldsStand(GroundOperationStatus operationStatus, TurnaroundStatus turnaroundStatus) =>
        operationStatus is not (GroundOperationStatus.Cancelled or GroundOperationStatus.Approved) &&
        turnaroundStatus is not (TurnaroundStatus.Completed or TurnaroundStatus.Cancelled or TurnaroundStatus.Diverted);

    /// <summary>
    /// The aircraft left its stand (owner decision 23, ADR-0041): the operation has the PUSHBACK milestone with an actual
    /// time. From then on the flight no longer occupies the stand, whatever its operation's status, and the stand is free
    /// for the next flight. It frees the occupancy, never the assignment: the flight keeps its stand of record (the
    /// documents, the tablet and the planning read it), and only OCC's «Liberar» closes it. A corrected push-back time
    /// keeps the stand free.
    /// </summary>
    public static bool HasLeftStand(DateTimeOffset? pushbackActualAt) => pushbackActualAt is not null;

    /// <summary>The agent pressed «Iniciar»: from then on the operation follows its agent until it ends (3-N03).</summary>
    public static bool HasStarted(DateTimeOffset? actualStartAt) => actualStartAt is not null;

    /// <summary>
    /// The agent already carries the most operations in the window, so another one would be one too many. An operation
    /// that holds the agent without a valid window counts as overlapping (it fails closed).
    /// </summary>
    public static bool AtCapacity(int overlapping) => overlapping >= MaxSimultaneousOperations;
}
