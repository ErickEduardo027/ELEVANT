namespace Elevant.Application.Operations;

/// <summary>
/// «Iniciar» as the store runs it. <c>StartedAt</c> is the tapped start (3-I), validated against the assignment and
/// clamped to the server's clock; null records the server's time and keeps the receipt hash of the first version.
/// </summary>
public sealed record RampOperationStartWriteRequest(
    Guid ActorAccountId,
    IReadOnlyCollection<Guid> AllowedStationIds,
    Guid OperationId,
    Guid InstallationId,
    Guid IdempotencyKey,
    Guid CorrelationId,
    string? RequestId,
    DateTimeOffset? StartedAt = null);

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

/// <summary>
/// The start of a ramp operation; <paramref name="Code"/> names the rule a refusal broke when the tablet can explain it
/// (<c>contract_not_in_force</c>, 3-N04). A replay of the device receipt answers the same code, except a contract
/// refusal: it is not stored (no <paramref name="CommitReceiptId"/>), so the same key evaluates the contract again.
/// </summary>
public sealed record RampOperationStartWriteResult(
    RampOperationStartData? Start,
    RampOperationStartWriteFailure? Failure,
    Guid? CommitReceiptId,
    string? Code = null)
{
    public bool IsSuccess => Start is not null && Failure is null;

    public static RampOperationStartWriteResult Success(
        RampOperationStartData start,
        Guid commitReceiptId) =>
        new(start, null, commitReceiptId);

    public static RampOperationStartWriteResult Failed(
        RampOperationStartWriteFailure failure,
        Guid? commitReceiptId = null,
        string? code = null) =>
        new(null, failure, commitReceiptId, code);
}
