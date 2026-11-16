namespace Elevant.Application.Operations.ProgramOccShift;

/// <summary>
/// Outcome of «Programar turno»; <paramref name="Code"/> is the Problem Details code of a conflict the screen acts on
/// (<c>shift_day_taken</c>: the agent already has a shift that day, OCC adjusts it, 3-E).
/// </summary>
public sealed record ProgramOccShiftResult(Guid? ShiftId, bool Replayed, OccPlanningFailure? Failure, string? Code = null)
{
    public bool IsSuccess => ShiftId.HasValue && Failure is null;
    public static ProgramOccShiftResult Success(Guid id, bool replayed) => new(id, replayed, null);
    public static ProgramOccShiftResult Failed(OccPlanningFailure failure, string? code = null) => new(null, false, failure, code);
}
