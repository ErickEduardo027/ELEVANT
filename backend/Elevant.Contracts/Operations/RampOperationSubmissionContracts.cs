using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace Elevant.Contracts.Operations;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SubmitRampOperationRequest
{
    [MaxLength(2000)]
    public string? AgentNote { get; init; }
}

public sealed record RampOperationSubmissionResponse(
    Guid ReceiptId,
    Guid OperationId,
    Guid SubmissionId,
    Guid ChecklistId,
    int RevisionNumber,
    string Status,
    DateTimeOffset SubmittedAt,
    DateTimeOffset ActualEndAt,
    string? AgentNote);
