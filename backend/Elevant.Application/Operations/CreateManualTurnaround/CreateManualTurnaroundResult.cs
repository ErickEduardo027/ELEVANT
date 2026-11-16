namespace Elevant.Application.Operations.CreateManualTurnaround;

/// <summary>The created turnaround, or the failure and the stable Problem Details code the screens explain.</summary>
public sealed record CreateManualTurnaroundResult(
    Guid? TurnaroundId,
    string? OperationCode,
    bool Replayed,
    OccPlanningFailure? Failure,
    string? Code = null)
{
    public bool IsSuccess => TurnaroundId.HasValue && OperationCode is not null && Failure is null;

    public static CreateManualTurnaroundResult Success(
        Guid turnaroundId, string operationCode, bool replayed) =>
        new(turnaroundId, operationCode, replayed, null);

    public static CreateManualTurnaroundResult Failed(OccPlanningFailure failure, string? code = null) =>
        new(null, null, false, failure, code);
}
