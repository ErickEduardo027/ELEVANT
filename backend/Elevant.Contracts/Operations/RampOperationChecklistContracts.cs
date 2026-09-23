using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace Elevant.Contracts.Operations;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SubmitRampOperationChecklistRequest
{
    public SubmitRampOperationChecklistRequest(
        Guid checklistId,
        IReadOnlyList<RampChecklistAnswerRequest> answers)
    {
        ChecklistId = checklistId;
        Answers = answers;
    }

    [Required]
    public Guid ChecklistId { get; init; }

    [Required]
    [MinLength(1)]
    [MaxLength(256)]
    public IReadOnlyList<RampChecklistAnswerRequest> Answers { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record RampChecklistAnswerRequest
{
    public RampChecklistAnswerRequest(Guid itemId, string value, string? note)
    {
        ItemId = itemId;
        Value = value;
        Note = note;
    }

    [Required]
    public Guid ItemId { get; init; }

    [Required(AllowEmptyStrings = false)]
    [RegularExpression("^(Ok|NotApplicable|NotOk)$")]
    public string Value { get; init; }

    [StringLength(1000)]
    public string? Note { get; init; }
}

public sealed record GetRampOperationChecklistResponse(
    Guid OperationId,
    RampChecklistResponse Checklist);

public sealed record RampChecklistResponse(
    Guid Id,
    string Status,
    DateTimeOffset? StartedAt,
    DateTimeOffset? SubmittedAt,
    RampChecklistTemplateResponse Template,
    IReadOnlyList<RampChecklistSectionResponse> Sections);

public sealed record RampChecklistTemplateResponse(
    string Code,
    string Name,
    int Version);

public sealed record RampChecklistSectionResponse(
    string Name,
    IReadOnlyList<RampChecklistItemResponse> Items);

public sealed record RampChecklistItemResponse(
    Guid Id,
    string Code,
    string Label,
    int SortOrder,
    bool IsRequired,
    bool RequiresNoteWhenNotOk,
    RampChecklistAnswerResponse? Answer);

public sealed record RampChecklistAnswerResponse(
    string Value,
    string? Note,
    DateTimeOffset AnsweredAt);

public sealed record RampChecklistSubmissionResponse(
    Guid ReceiptId,
    RampChecklistSubmissionSummaryResponse Checklist);

public sealed record RampChecklistSubmissionSummaryResponse(
    Guid Id,
    string Status,
    DateTimeOffset StartedAt,
    DateTimeOffset SubmittedAt,
    int AnswerCount);
