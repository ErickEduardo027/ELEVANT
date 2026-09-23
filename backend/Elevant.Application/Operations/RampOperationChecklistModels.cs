using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations;

public sealed record RampOperationChecklistReadRequest(
    Guid ActorAccountId,
    IReadOnlyCollection<Guid> AllowedStationIds,
    Guid OperationId);

public sealed record RampChecklistTemplateData(
    string Code,
    string Name,
    int Version);

public sealed record RampChecklistAnswerData(
    string Value,
    string? Note,
    DateTimeOffset AnsweredAt);

public sealed record RampChecklistItemData(
    Guid Id,
    string Code,
    string Label,
    int SortOrder,
    bool IsRequired,
    bool RequiresNoteWhenNotOk,
    RampChecklistAnswerData? Answer);

public sealed record RampChecklistSectionData(
    string Name,
    IReadOnlyList<RampChecklistItemData> Items);

public sealed record RampOperationChecklistData(
    Guid OperationId,
    Guid Id,
    string Status,
    DateTimeOffset? StartedAt,
    DateTimeOffset? SubmittedAt,
    RampChecklistTemplateData Template,
    IReadOnlyList<RampChecklistSectionData> Sections);

public enum RampOperationChecklistReadFailure
{
    AgentProfileUnavailable,
    NotFound,
    Conflict,
}

public sealed record RampOperationChecklistReadResult(
    RampOperationChecklistData? Checklist,
    RampOperationChecklistReadFailure? Failure)
{
    public bool IsSuccess => Checklist is not null && Failure is null;

    public static RampOperationChecklistReadResult Success(
        RampOperationChecklistData checklist)
    {
        ArgumentNullException.ThrowIfNull(checklist);
        return new(checklist, null);
    }

    public static RampOperationChecklistReadResult Failed(
        RampOperationChecklistReadFailure failure) =>
        new(null, failure);
}

public sealed record RampChecklistAnswerWriteData(
    Guid ItemId,
    ChecklistAnswerValue Value,
    string? Note);

public sealed record RampChecklistSubmissionWriteRequest(
    Guid ActorAccountId,
    IReadOnlyCollection<Guid> AllowedStationIds,
    Guid OperationId,
    Guid ChecklistId,
    IReadOnlyCollection<RampChecklistAnswerWriteData> Answers,
    Guid InstallationId,
    Guid IdempotencyKey,
    Guid CorrelationId,
    string? RequestId);

public sealed record RampChecklistSubmissionSummaryData(
    Guid Id,
    string Status,
    DateTimeOffset StartedAt,
    DateTimeOffset SubmittedAt,
    int AnswerCount);

public sealed record RampChecklistSubmissionData(
    Guid ReceiptId,
    RampChecklistSubmissionSummaryData Checklist);

public enum RampChecklistSubmissionWriteFailure
{
    Forbidden,
    NotFound,
    Conflict,
    IdempotencyKeyConflict,
}

public sealed record RampChecklistSubmissionWriteResult(
    RampChecklistSubmissionData? Submission,
    RampChecklistSubmissionWriteFailure? Failure,
    Guid? CommitReceiptId)
{
    public bool IsSuccess => Submission is not null && Failure is null;

    public static RampChecklistSubmissionWriteResult Success(
        RampChecklistSubmissionData submission,
        Guid commitReceiptId) =>
        new(submission, null, commitReceiptId);

    public static RampChecklistSubmissionWriteResult Failed(
        RampChecklistSubmissionWriteFailure failure,
        Guid? commitReceiptId = null) =>
        new(null, failure, commitReceiptId);
}

public sealed record RampChecklistItemRule(
    Guid ItemId,
    bool IsRequired,
    bool RequiresNoteWhenNotOk);
