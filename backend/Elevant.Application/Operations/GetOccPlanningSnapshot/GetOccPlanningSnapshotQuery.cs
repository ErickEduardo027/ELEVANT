namespace Elevant.Application.Operations.GetOccPlanningSnapshot;

public sealed record GetOccPlanningSnapshotQuery(
    Guid AccountId,
    Guid? StationId,
    DateOnly? Date);
