namespace Elevant.Application.Operations;

public enum OccReviewFailure
{
    Unauthorized,
    Forbidden,
    InvalidRequest,
    NotFound,
    Conflict,
    PreconditionFailed,
}

public sealed record OccReviewQueueItemData(
    Guid OperationId,
    Guid SubmissionId,
    int RevisionNumber,
    string Status,
    string OperationCode,
    DateOnly OperationDate,
    string AirlineName,
    string AgentName,
    DateTimeOffset SubmittedAt,
    int ServiceCount,
    int IncidentCount);

public sealed record OccReviewQueueData(
    Guid StationId,
    string StationCode,
    string StationName,
    string IanaTimeZone,
    IReadOnlyList<OccReviewQueueItemData> Operations,
    bool HasMore);

public sealed record OccReviewQueueResult(OccReviewQueueData? Queue, OccReviewFailure? Failure)
{
    public bool IsSuccess => Queue is not null && Failure is null;
    public static OccReviewQueueResult Success(OccReviewQueueData value) => new(value, null);
    public static OccReviewQueueResult Failed(OccReviewFailure failure) => new(null, failure);
}

public sealed record OccReviewSubmissionHistoryItemData(
    Guid SubmissionId, int RevisionNumber, string Status,
    DateTimeOffset SubmittedAt, string? Outcome, DateTimeOffset? DecidedAt);

public sealed record OccReviewSubmissionHistoryData(
    Guid OperationId, IReadOnlyList<OccReviewSubmissionHistoryItemData> Submissions,
    bool HasMore);

public sealed record OccReviewSubmissionHistoryResult(
    OccReviewSubmissionHistoryData? History, OccReviewFailure? Failure)
{
    public bool IsSuccess => History is not null && Failure is null;
    public static OccReviewSubmissionHistoryResult Success(
        OccReviewSubmissionHistoryData value) => new(value, null);
    public static OccReviewSubmissionHistoryResult Failed(
        OccReviewFailure failure) => new(null, failure);
}

public sealed record OccReviewServiceData(
    Guid Id, string Code, string Name, string Status,
    decimal ContractedQuantity, decimal ExecutedQuantity, string Unit);

public sealed record OccReviewChecklistAnswerData(
    string Section, string Code, string Label, string Value, string? Note);

public sealed record OccReviewIncidentData(
    Guid Id, string Type, string Severity, string Status,
    string Description, DateTimeOffset OccurredAt, string? DelayCode = null);

/// <summary>A charge on a service, with who marked it: the agent, ELEVANT on its own or OCC (ADR-0034).</summary>
public sealed record OccReviewChargeData(
    Guid MarkId, Guid ServiceId, string ServiceCode, Guid ChargeId, string Code, string Name, string Source,
    DateTimeOffset AppliedAt, string? Reason);

/// <summary>A charge OCC may add to a service of the operation under review.</summary>
public sealed record OccReviewChargeOptionData(Guid ChargeId, string Code, string Name, bool AppliesToAllServices,
    IReadOnlyList<Guid> ServiceIds);

public sealed record OccReviewMilestoneData(string Code, DateTimeOffset ActualAt);

/// <summary>Times the surcharges are measured on, frozen at hand-off.</summary>
public sealed record OccReviewTimingData(decimal? GroundMinutes, int? AllowedGroundMinutes, decimal? ArrivalDelayMinutes,
    string? AircraftCategory);

/// <summary>A service in exception OCC excluded from billing in the review, with its reason (3-N11).</summary>
public sealed record OccReviewBillingExclusionData(Guid ServiceId, string Reason, DateTimeOffset ExcludedAt);

/// <summary>
/// Everything OCC closes the operation with (ADR-0034). The charge options leave out what each service's contract
/// excludes (3-N29); the billing exclusions are the services in exception OCC excluded from billing (3-N11).
/// </summary>
public sealed record OccReviewCloseData(
    IReadOnlyList<OccReviewMilestoneData> Milestones,
    IReadOnlyList<OccReviewChargeData> Charges,
    IReadOnlyList<OccReviewChargeOptionData> ChargeOptions,
    OccReviewTimingData Timing,
    bool CanAdjustCharges,
    int DamageCount,
    IReadOnlyList<OccReviewBillingExclusionData>? BillingExclusions = null);

public sealed record OccReviewDecisionData(
    string Outcome, string? Reason, DateTimeOffset DecidedAt);

/// <summary>An approval OCC reopened as this revision (3-H): which revision, why, when and who.</summary>
public sealed record OccReviewReopeningData(int FromRevisionNumber, string Reason, DateTimeOffset ReopenedAt,
    string ReopenedBy);

/// <summary>State of the Service Order OCC approves (3-N02).</summary>
public static class ServiceOrderStates
{
    /// <summary>A version with the current content carries every required signature.</summary>
    public const string FullySigned = "Signed";

    /// <summary>OCC corrected a signed Service Order after the signature, with its reason.</summary>
    public const string Corrected = "Corrected";

    /// <summary>It was signed, but its content changed afterwards: it must be signed again.</summary>
    public const string Stale = "Stale";

    /// <summary>It was never fully signed.</summary>
    public const string NeverSigned = "Unsigned";
}
public sealed record OccReviewDetailData(
    Guid OperationId,
    Guid SubmissionId,
    int RevisionNumber,
    string Status,
    string OperationCode,
    DateOnly OperationDate,
    Guid StationId,
    string StationCode,
    string IanaTimeZone,
    string AirlineName,
    string AgentName,
    DateTimeOffset? PlannedStartAt,
    DateTimeOffset? PlannedEndAt,
    DateTimeOffset? ActualStartAt,
    DateTimeOffset? ActualEndAt,
    DateTimeOffset SubmittedAt,
    string? AgentNote,
    string ChecklistStatus,
    IReadOnlyList<OccReviewChecklistAnswerData> ChecklistAnswers,
    IReadOnlyList<OccReviewServiceData> Services,
    IReadOnlyList<OccReviewIncidentData> Incidents,
    OccReviewDecisionData? Decision,
    string ConcurrencyToken,
    OccReviewCloseData? Close = null,
    string? ServiceOrderState = null,
    OccReviewReopeningData? Reopening = null);

public sealed record OccReviewDetailResult(OccReviewDetailData? Detail, OccReviewFailure? Failure)
{
    public bool IsSuccess => Detail is not null && Failure is null;
    public static OccReviewDetailResult Success(OccReviewDetailData value) => new(value, null);
    public static OccReviewDetailResult Failed(OccReviewFailure failure) => new(null, failure);
}

/// <summary>
/// OCC's decision on the pending hand-off. <c>IdempotencyKey</c> is optional while older callers exist (expand): with
/// one, a retry replays the first answer.
/// </summary>
public sealed record OccReviewDecisionWriteRequest(
    Guid ActorAccountId,
    IReadOnlyCollection<Guid> AllowedStationIds,
    Guid OperationId,
    Guid SubmissionId,
    string ConcurrencyToken,
    string Outcome,
    string? Reason,
    Guid CorrelationId,
    string? RequestId,
    Guid? IdempotencyKey = null);

/// <summary>OCC adds a charge to a service, or removes one, while reviewing; the reason is audited (ADR-0034).</summary>
public sealed record OccReviewChargeAdjustRequest(
    Guid ActorAccountId,
    IReadOnlyCollection<Guid> AllowedStationIds,
    Guid OperationId,
    Guid SubmissionId,
    string ConcurrencyToken,
    Guid? ServiceId,
    Guid? ChargeId,
    Guid? MarkId,
    string Reason,
    Guid CorrelationId,
    string? RequestId,
    Guid? IdempotencyKey = null);

/// <summary>
/// The new review version of an adjustment, or why it was refused; <c>Code</c> is the Problem Details code of a
/// refusal (<c>charge_excluded_by_contract</c>, <c>review_closed</c>…).
/// </summary>
public sealed record OccReviewChargeAdjustResult(string? ConcurrencyToken, OccReviewFailure? Failure, string? Code = null)
{
    public bool IsSuccess => ConcurrencyToken is not null && Failure is null;

    public static OccReviewChargeAdjustResult Failed(OccReviewFailure failure, string? code = null) =>
        new(null, failure, code);
}

/// <summary>
/// OCC excludes a service in exception from billing in the review, or includes it again (3-N11), with a reason; the
/// review version moves like with any adjustment.
/// </summary>
public sealed record OccReviewBillingExclusionRequest(
    Guid ActorAccountId,
    IReadOnlyCollection<Guid> AllowedStationIds,
    Guid OperationId,
    Guid ServiceId,
    Guid SubmissionId,
    string ConcurrencyToken,
    bool Excluded,
    string Reason,
    Guid IdempotencyKey,
    Guid CorrelationId,
    string? RequestId);

/// <summary>OCC reopens an approval nothing was invoiced from yet as a new pending revision (3-H).</summary>
public sealed record OccReviewReopenRequest(
    Guid ActorAccountId,
    IReadOnlyCollection<Guid> AllowedStationIds,
    Guid OperationId,
    Guid SubmissionId,
    string ConcurrencyToken,
    string Reason,
    Guid IdempotencyKey,
    Guid CorrelationId,
    string? RequestId);

/// <summary>The revision a reopening created and the review version to decide it with.</summary>
public sealed record OccReviewReopenData(Guid OperationId, Guid SubmissionId, int RevisionNumber, string Status,
    string ReviewVersion);

public sealed record OccReviewReopenResult(OccReviewReopenData? Data, OccReviewFailure? Failure, string? Code = null,
    bool Replayed = false)
{
    public bool IsSuccess => Data is not null && Failure is null;

    public static OccReviewReopenResult Failed(OccReviewFailure failure, string? code = null) => new(null, failure, code);
}

public sealed record OccReviewDecisionWriteData(
    Guid OperationId,
    Guid SubmissionId,
    string Status,
    string Outcome,
    DateTimeOffset DecidedAt,
    string? Reason);

/// <summary>
/// A recorded decision, or why it was refused; <c>Code</c> is the Problem Details code of a refusal
/// (<c>service_order_unsigned</c>, <c>review_already_decided</c>…).
/// </summary>
public sealed record OccReviewDecisionWriteResult(
    OccReviewDecisionWriteData? Decision,
    OccReviewFailure? Failure,
    Guid? CommitAuditId,
    string? Code = null)
{
    public bool IsSuccess => Decision is not null && Failure is null;

    public static OccReviewDecisionWriteResult Success(
        OccReviewDecisionWriteData decision, Guid auditId) => new(decision, null, auditId);

    public static OccReviewDecisionWriteResult Failed(OccReviewFailure failure, string? code = null) =>
        new(null, failure, null, code);
}
