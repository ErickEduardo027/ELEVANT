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
    string Description, DateTimeOffset OccurredAt, string? DelayCode = null);

/// <summary>A charge on a service; source is Agent, Automatic or Occ (ADR-0034).</summary>
public sealed record OccReviewChargeResponse(
    Guid MarkId, Guid ServiceId, string ServiceCode, Guid ChargeId, string Code, string Name, string Source,
    DateTimeOffset AppliedAt, string? Reason);

/// <summary>A charge OCC may add, with the services of the operation it applies to.</summary>
public sealed record OccReviewChargeOptionResponse(
    Guid ChargeId, string Code, string Name, bool AppliesToAllServices, IReadOnlyList<Guid> ServiceIds);

public sealed record OccReviewMilestoneResponse(string Code, DateTimeOffset ActualAt);

/// <summary>Ground time against Finance's allowance and arrival delay, as frozen at hand-off.</summary>
public sealed record OccReviewTimingResponse(
    decimal? GroundMinutes, int? AllowedGroundMinutes, decimal? ArrivalDelayMinutes, string? AircraftCategory);

/// <summary>A service in exception OCC excluded from billing in the review, with its reason (3-N11).</summary>
public sealed record OccReviewBillingExclusionResponse(Guid ServiceId, string Reason, DateTimeOffset ExcludedAt);

/// <summary>
/// What OCC closes the operation with (ADR-0034). The charge options leave out what each service's contract excludes
/// (3-N29); <c>BillingExclusions</c> lists the services in exception OCC excluded from billing (3-N11).
/// </summary>
public sealed record OccReviewCloseResponse(
    IReadOnlyList<OccReviewMilestoneResponse> Milestones,
    IReadOnlyList<OccReviewChargeResponse> Charges,
    IReadOnlyList<OccReviewChargeOptionResponse> ChargeOptions,
    OccReviewTimingResponse Timing,
    bool CanAdjustCharges,
    int DamageCount,
    IReadOnlyList<OccReviewBillingExclusionResponse>? BillingExclusions = null);

public sealed record OccReviewDecisionResponse(
    string Outcome, string? Reason, DateTimeOffset DecidedAt);

/// <summary>The approval OCC reopened as this revision (3-H): which one, why, when and who.</summary>
public sealed record OccReviewReopeningResponse(int FromRevisionNumber, string Reason, DateTimeOffset ReopenedAt,
    string ReopenedBy);

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
    string ReviewVersion,
    OccReviewCloseResponse? Close = null,
    string? ServiceOrderState = null,
    OccReviewReopeningResponse? Reopening = null);

/// <summary>OCC adds a charge to a service of the operation under review, with a reason.</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record AddOccReviewChargeRequest
{
    public Guid SubmissionId { get; init; }

    public Guid ServiceId { get; init; }

    public Guid ChargeId { get; init; }

    [MaxLength(500)]
    public string? Reason { get; init; }
}

/// <summary>OCC removes a charge from the operation under review, with a reason.</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record RemoveOccReviewChargeRequest
{
    public Guid SubmissionId { get; init; }

    [MaxLength(500)]
    public string? Reason { get; init; }
}

/// <summary>The new review version: send it as If-Match on the next adjustment or decision.</summary>
public sealed record OccReviewChargeAdjustResponse(string ReviewVersion);

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

/// <summary>OCC excludes a service in exception from billing, or includes it again, with a reason (3-N11).</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SetOccReviewServiceBillingExclusionRequest
{
    public Guid SubmissionId { get; init; }

    public bool Excluded { get; init; }

    [MaxLength(500)]
    public string? Reason { get; init; }
}

/// <summary>OCC reopens an approval nothing was invoiced from yet, with its reason (3-H).</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ReopenOccReviewRequest
{
    public Guid SubmissionId { get; init; }

    [MaxLength(2000)]
    public string? Reason { get; init; }
}

/// <summary>The pending revision a reopening created; its review version is also the ETag.</summary>
public sealed record OccReviewReopenResponse(Guid OperationId, Guid SubmissionId, int RevisionNumber, string Status,
    string ReviewVersion);
