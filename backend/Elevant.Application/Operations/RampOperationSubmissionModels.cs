namespace Elevant.Application.Operations;

public sealed record RampOperationSubmissionWriteRequest(
    Guid ActorAccountId,
    IReadOnlyCollection<Guid> AllowedStationIds,
    Guid OperationId,
    Guid InstallationId,
    Guid IdempotencyKey,
    string? AgentNote,
    Guid CorrelationId,
    string? RequestId);

public sealed record RampOperationSubmissionData(
    Guid ReceiptId,
    Guid OperationId,
    Guid SubmissionId,
    Guid ChecklistId,
    int RevisionNumber,
    string Status,
    DateTimeOffset SubmittedAt,
    DateTimeOffset ActualEndAt,
    string? AgentNote);

public sealed record RampOperationSubmissionWriteResult(
    RampOperationSubmissionData? Submission,
    RampOperationsFailure? Failure,
    Guid? CommitReceiptId)
{
    public bool IsSuccess => Submission is not null && Failure is null;

    public static RampOperationSubmissionWriteResult Success(
        RampOperationSubmissionData submission, Guid receiptId) =>
        new(submission, null, receiptId);

    public static RampOperationSubmissionWriteResult Failed(
        RampOperationsFailure failure, Guid? receiptId = null) =>
        new(null, failure, receiptId);
}
