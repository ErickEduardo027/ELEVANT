using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations;

/// <summary>
/// A service transition as the store runs it. <c>OccurredAt</c> is the tapped time (3-I), validated against the
/// operation's window and the service's last transition and clamped to the server's clock; null records the server's
/// time and keeps the receipt hash of the first version.
/// </summary>
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
    string? RequestId,
    DateTimeOffset? OccurredAt = null);

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

/// <summary>
/// Outcome of a service transition. <c>Code</c> is the rule a refusal broke when the tablet can explain it
/// (<c>time_outside_operation_window</c>, <c>service_time_out_of_order</c>, 3-I); a replay of the device receipt
/// answers the same code.
/// </summary>
public sealed record RampOperationServiceTransitionWriteResult(
    RampOperationServiceTransitionData? Transition,
    RampOperationServiceTransitionWriteFailure? Failure,
    Guid? CommitReceiptId,
    string? Code = null)
{
    public bool IsSuccess => Transition is not null && Failure is null;

    public static RampOperationServiceTransitionWriteResult Success(
        RampOperationServiceTransitionData transition,
        Guid commitReceiptId) =>
        new(transition, null, commitReceiptId);

    public static RampOperationServiceTransitionWriteResult Failed(
        RampOperationServiceTransitionWriteFailure failure,
        Guid? commitReceiptId = null,
        string? code = null) =>
        new(null, failure, commitReceiptId, code);
}
