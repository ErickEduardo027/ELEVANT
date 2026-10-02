namespace Elevant.Application.Operations.ProgramOccShift;

public sealed record ProgramOccShiftResult(Guid? ShiftId, bool Replayed, OccPlanningFailure? Failure)
{
    public bool IsSuccess => ShiftId.HasValue && Failure is null;
    public static ProgramOccShiftResult Success(Guid id, bool replayed) => new(id, replayed, null);
    public static ProgramOccShiftResult Failed(OccPlanningFailure failure) => new(null, false, failure);
}
