namespace Elevant.Application.Operations.SubmitRampOperationChecklist;

public sealed record SubmitRampOperationChecklistCommand(
    Guid AccountId,
    Guid OperationId,
    Guid ChecklistId,
    IReadOnlyCollection<RampChecklistAnswerWriteData> Answers,
    Guid InstallationId,
    Guid IdempotencyKey,
    Guid CorrelationId,
    string? RequestId);
