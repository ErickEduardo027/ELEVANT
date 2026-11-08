namespace Elevant.Application.Operations.GetOccAgentShift;

/// <summary>The agent's shift on the flight's day; <paramref name="Code"/> is <c>shift_not_found</c> when there is none.</summary>
public sealed record GetOccAgentShiftResult(OccAgentShiftData? Shift, OccPlanningFailure? Failure, string? Code = null)
{
    public bool IsSuccess => Shift is not null && Failure is null;
    public static GetOccAgentShiftResult Success(OccAgentShiftData shift) => new(shift, null);
    public static GetOccAgentShiftResult Failed(OccPlanningFailure failure, string? code = null) => new(null, failure, code);
}
