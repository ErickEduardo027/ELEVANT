using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations;

/// <summary>Defines the lifecycle states in which OCC may create an initial assignment.</summary>
public static class OccPlanningAssignmentPolicy
{
    public static bool CanAssign(
        TurnaroundStatus turnaroundStatus,
        GroundOperationStatus operationStatus,
        DateTimeOffset? plannedStartAt,
        DateTimeOffset? plannedEndAt) =>
        turnaroundStatus is TurnaroundStatus.Scheduled or TurnaroundStatus.Confirmed &&
        operationStatus == GroundOperationStatus.Planned &&
        plannedStartAt.HasValue &&
        plannedEndAt.HasValue &&
        plannedStartAt.Value < plannedEndAt.Value;
}
