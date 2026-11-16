namespace Elevant.Application.Operations.GetOccPlanningSnapshot;

public sealed record GetOccPlanningSnapshotResult(
    OccPlanningSnapshotData? Snapshot,
    OccPlanningFailure? Failure)
{
    public bool IsSuccess => Snapshot is not null && Failure is null;

    public static GetOccPlanningSnapshotResult Success(OccPlanningSnapshotData snapshot) =>
        new(snapshot, null);

    public static GetOccPlanningSnapshotResult Failed(OccPlanningFailure failure) =>
        new(null, failure);
}
