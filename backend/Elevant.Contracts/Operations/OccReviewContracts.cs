using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace Elevant.Contracts.Operations;

public sealed record OccReviewQueueItemResponse(
    Guid OperationId, Guid SubmissionId, int RevisionNumber, string Status,
    string OperationCode, DateOnly OperationDate, string AirlineName,
    string AgentName, DateTimeOffset SubmittedAt, int ServiceCount, int IncidentCount);

public sealed record OccReviewQueueResponse(
    Guid StationId, string StationCode, string StationName, string IanaTimeZone,
    IReadOnlyList<OccReviewQueueItemResponse> Operations, bool HasMore);

public sealed record OccReviewSubmissionHistoryItemResponse(
    Guid SubmissionId, int RevisionNumber, string Status,
    DateTimeOffset SubmittedAt, string? Outcome, DateTimeOffset? DecidedAt);

public sealed record OccReviewSubmissionHistoryResponse(
    Guid OperationId, IReadOnlyList<OccReviewSubmissionHistoryItemResponse> Submissions,
    bool HasMore);

public sealed record OccReviewServiceResponse(
    Guid Id, string Code, string Name, string Status,
    decimal ContractedQuantity, decimal ExecutedQuantity, string Unit);

public sealed record OccReviewChecklistAnswerResponse(
    string Section, string Code, string Label, string Value, string? Note);

public sealed record OccReviewIncidentResponse(
    Guid Id, string Type, string Severity, string Status,
    string Description, DateTimeOffset OccurredAt);

public sealed record OccReviewDecisionResponse(
    string Outcome, string? Reason, DateTimeOffset DecidedAt);

public sealed record OccReviewDetailResponse(
    Guid OperationId, Guid SubmissionId, int RevisionNumber, string Status,
    string OperationCode, DateOnly OperationDate, Guid StationId, string StationCode,
    string IanaTimeZone, string AirlineName, string AgentName,
    DateTimeOffset? PlannedStartAt, DateTimeOffset? PlannedEndAt,
    DateTimeOffset? ActualStartAt, DateTimeOffset? ActualEndAt,
    DateTimeOffset SubmittedAt, string? AgentNote, string ChecklistStatus,
    IReadOnlyList<OccReviewChecklistAnswerResponse> ChecklistAnswers,
    IReadOnlyList<OccReviewServiceResponse> Services,
    IReadOnlyList<OccReviewIncidentResponse> Incidents,
    OccReviewDecisionResponse? Decision,
    string ReviewVersion);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record DecideOccReviewRequest
{
    public Guid SubmissionId { get; init; }

    [MaxLength(16)]
    public string? Outcome { get; init; }

    [MaxLength(2000)]
    public string? Reason { get; init; }
}

public sealed record DecideOccReviewResponse(
    Guid OperationId, Guid SubmissionId, string Status, string Outcome,
    DateTimeOffset DecidedAt, string? Reason);
