using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations;

/// <summary>
/// Defines the lifecycle states in which OCC may create an initial assignment. A recorded arrival (turnaround
/// InProgress) only means the aircraft is on blocks: while its operation is still Planned, OCC assigns an agent, or
/// another one after releasing the first (3-C). A completed, cancelled or diverted flight takes nobody.
/// </summary>
public static class OccPlanningAssignmentPolicy
{
    public static bool CanAssign(
        TurnaroundStatus turnaroundStatus,
        GroundOperationStatus operationStatus,
        DateTimeOffset? plannedStartAt,
        DateTimeOffset? plannedEndAt) =>
        turnaroundStatus is TurnaroundStatus.Scheduled or TurnaroundStatus.Confirmed or TurnaroundStatus.InProgress &&
        operationStatus == GroundOperationStatus.Planned &&
        plannedStartAt.HasValue &&
        plannedEndAt.HasValue &&
        plannedStartAt.Value < plannedEndAt.Value;
}
