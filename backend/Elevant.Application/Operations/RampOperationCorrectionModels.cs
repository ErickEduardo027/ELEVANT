namespace Elevant.Application.Operations;

public sealed record RampOperationCorrectionWriteRequest(
    Guid ActorAccountId,
    IReadOnlyCollection<Guid> AllowedStationIds,
    Guid OperationId,
    Guid InstallationId,
    Guid IdempotencyKey,
    Guid CorrelationId,
    string? RequestId);

public sealed record RampOperationCorrectionData(
    Guid ReceiptId,
    Guid OperationId,
    Guid PreviousSubmissionId,
    Guid ChecklistId,
    int RevisionNumber,
    string Status,
    string ReturnReason);

public sealed record RampOperationCorrectionWriteResult(
    RampOperationCorrectionData? Correction,
    RampOperationsFailure? Failure,
    Guid? CommitReceiptId)
{
    public bool IsSuccess => Correction is not null && Failure is null;

    public static RampOperationCorrectionWriteResult Success(
        RampOperationCorrectionData correction, Guid receiptId) =>
        new(correction, null, receiptId);

    public static RampOperationCorrectionWriteResult Failed(
        RampOperationsFailure failure, Guid? receiptId = null) =>
        new(null, failure, receiptId);
}
