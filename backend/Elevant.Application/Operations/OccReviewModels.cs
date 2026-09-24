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
    string Description, DateTimeOffset OccurredAt);

public sealed record OccReviewDecisionData(
    string Outcome, string? Reason, DateTimeOffset DecidedAt);

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
    string ConcurrencyToken);

public sealed record OccReviewDetailResult(OccReviewDetailData? Detail, OccReviewFailure? Failure)
{
    public bool IsSuccess => Detail is not null && Failure is null;
    public static OccReviewDetailResult Success(OccReviewDetailData value) => new(value, null);
    public static OccReviewDetailResult Failed(OccReviewFailure failure) => new(null, failure);
}

public sealed record OccReviewDecisionWriteRequest(
    Guid ActorAccountId,
    IReadOnlyCollection<Guid> AllowedStationIds,
    Guid OperationId,
    Guid SubmissionId,
    string ConcurrencyToken,
    string Outcome,
    string? Reason,
    Guid CorrelationId,
    string? RequestId);

public sealed record OccReviewDecisionWriteData(
    Guid OperationId,
    Guid SubmissionId,
    string Status,
    string Outcome,
    DateTimeOffset DecidedAt,
    string? Reason);

public sealed record OccReviewDecisionWriteResult(
    OccReviewDecisionWriteData? Decision,
    OccReviewFailure? Failure,
    Guid? CommitAuditId)
{
    public bool IsSuccess => Decision is not null && Failure is null;

    public static OccReviewDecisionWriteResult Success(
        OccReviewDecisionWriteData decision, Guid auditId) => new(decision, null, auditId);

    public static OccReviewDecisionWriteResult Failed(OccReviewFailure failure) => new(null, failure, null);
}
