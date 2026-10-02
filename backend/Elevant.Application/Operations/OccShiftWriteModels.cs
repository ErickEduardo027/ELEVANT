namespace Elevant.Application.Operations;

public sealed record OccShiftWriteRequest(
    Guid ActorAccountId,
    IReadOnlyCollection<Guid> AllowedStationIds,
    Guid TurnaroundId,
    Guid AgentId,
    TimeOnly StartsAtLocal,
    TimeOnly EndsAtLocal,
    Guid CorrelationId,
    string RequestId);

public enum OccShiftWriteFailure { NotFound, Conflict }

public sealed record OccShiftWriteResult(Guid? ShiftId, bool Replayed, OccShiftWriteFailure? Failure)
{
    public bool IsSuccess => ShiftId.HasValue && Failure is null;
    public static OccShiftWriteResult Created(Guid id) => new(id, false, null);
    public static OccShiftWriteResult Existing(Guid id) => new(id, true, null);
    public static OccShiftWriteResult Failed(OccShiftWriteFailure failure) => new(null, false, failure);
}
