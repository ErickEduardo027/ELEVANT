namespace Elevant.Application.Operations.CreateManualTurnaround;

public sealed record CreateManualTurnaroundResult(
    Guid? TurnaroundId,
    string? OperationCode,
    bool Replayed,
    OccPlanningFailure? Failure)
{
    public bool IsSuccess => TurnaroundId.HasValue && OperationCode is not null && Failure is null;

    public static CreateManualTurnaroundResult Success(
        Guid turnaroundId, string operationCode, bool replayed) =>
        new(turnaroundId, operationCode, replayed, null);

    public static CreateManualTurnaroundResult Failed(OccPlanningFailure failure) =>
        new(null, null, false, failure);
}
