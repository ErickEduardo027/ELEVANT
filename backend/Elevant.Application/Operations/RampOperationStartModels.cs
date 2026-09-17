namespace Elevant.Application.Operations;

public sealed record RampOperationStartWriteRequest(
    Guid ActorAccountId,
    IReadOnlyCollection<Guid> AllowedStationIds,
    Guid OperationId,
    Guid InstallationId,
    Guid IdempotencyKey,
    Guid CorrelationId,
    string? RequestId);

public sealed record RampOperationStartData(
    Guid ReceiptId,
    RampGroundOperationData Operation);

public enum RampOperationStartWriteFailure
{
    Forbidden,
    NotFound,
    Conflict,
    IdempotencyKeyConflict,
}

public sealed record RampOperationStartWriteResult(
    RampOperationStartData? Start,
    RampOperationStartWriteFailure? Failure,
    Guid? CommitReceiptId)
{
    public bool IsSuccess => Start is not null && Failure is null;

    public static RampOperationStartWriteResult Success(
        RampOperationStartData start,
        Guid commitReceiptId) =>
        new(start, null, commitReceiptId);

    public static RampOperationStartWriteResult Failed(
        RampOperationStartWriteFailure failure,
        Guid? commitReceiptId = null) =>
        new(null, failure, commitReceiptId);
}
