namespace Elevant.Contracts.Operations;

public sealed record RampOperationCorrectionResponse(
    Guid ReceiptId,
    Guid OperationId,
    Guid PreviousSubmissionId,
    Guid ChecklistId,
    int RevisionNumber,
    string Status,
    string ReturnReason);
