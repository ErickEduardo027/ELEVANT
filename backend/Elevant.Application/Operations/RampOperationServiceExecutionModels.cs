using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations;

public sealed record RampOperationServiceTransitionWriteRequest(
    Guid ActorAccountId,
    IReadOnlyCollection<Guid> AllowedStationIds,
    Guid OperationId,
    Guid ServiceId,
    ServiceExecutionStatus TargetStatus,
    decimal? ExecutedQuantity,
    string? Note,
    Guid InstallationId,
    Guid IdempotencyKey,
    Guid CorrelationId,
    string? RequestId);

public sealed record RampOperationServiceExecutionData(
    Guid Id,
    string Status,
    decimal ContractedQuantity,
    decimal ExecutedQuantity,
    string BillingUnit);

public sealed record RampOperationServiceTransitionData(
    Guid ReceiptId,
    RampOperationServiceExecutionData Service);

public enum RampOperationServiceTransitionWriteFailure
{
    Forbidden,
    NotFound,
    Conflict,
    IdempotencyKeyConflict,
}

public sealed record RampOperationServiceTransitionWriteResult(
    RampOperationServiceTransitionData? Transition,
    RampOperationServiceTransitionWriteFailure? Failure,
    Guid? CommitReceiptId)
{
    public bool IsSuccess => Transition is not null && Failure is null;

    public static RampOperationServiceTransitionWriteResult Success(
        RampOperationServiceTransitionData transition,
        Guid commitReceiptId) =>
        new(transition, null, commitReceiptId);

    public static RampOperationServiceTransitionWriteResult Failed(
        RampOperationServiceTransitionWriteFailure failure,
        Guid? commitReceiptId = null) =>
        new(null, failure, commitReceiptId);
}
