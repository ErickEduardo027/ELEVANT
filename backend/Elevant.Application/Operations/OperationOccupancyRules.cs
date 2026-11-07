using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations;

/// <summary>
/// What occupies a ramp agent (AVIAM OCC rules): an agent never carries more than
/// <see cref="MaxSimultaneousOperations"/> operations whose windows overlap, and an operation holds its agent
/// while it is assigned, in progress or returned for correction. Planning, the stand reassignment and the
/// reschedule of a flight count with this one rule.
/// </summary>
public static class OperationOccupancyRules
{
    /// <summary>An agent never carries more than this many simultaneous operations.</summary>
    public const int MaxSimultaneousOperations = 3;

    /// <summary>The operation keeps its open agent assignments busy in its window.</summary>
    public static bool HoldsAgent(GroundOperationStatus status) =>
        status is GroundOperationStatus.Assigned or GroundOperationStatus.InProgress or GroundOperationStatus.Returned;
}
