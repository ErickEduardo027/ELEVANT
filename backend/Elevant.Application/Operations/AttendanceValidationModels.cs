namespace Elevant.Application.Operations;

public enum AttendanceValidationFailure
{
    Invalid,
    Unauthorized,
    Forbidden,
    NotFound,
    Conflict,
}

public sealed record AttendanceValidationSelectionResult(
    DateTimeOffset? StartAt,
    DateTimeOffset? EndAt,
    string? Reason,
    AttendanceValidationFailure? Failure)
{
    public static AttendanceValidationSelectionResult Invalid() =>
        new(null, null, null, AttendanceValidationFailure.Invalid);
}

public sealed record AttendanceValidationCommand(
    Guid ActorAccountId,
    Guid StationId,
    Guid AssignmentId,
    int ExpectedOccRevision,
    int ExpectedRampAgentRevision,
    string StartSource,
    string EndSource,
    string? Reason,
    Guid IdempotencyKey,
    string? RequestId);

public sealed record AttendanceValidationDecisionData(
    Guid Id,
    Guid AssignmentId,
    int OccRevision,
    int RampAgentRevision,
    string StartSource,
    string EndSource,
    DateTimeOffset StartAt,
    DateTimeOffset EndAt,
    string? Reason,
    Guid ValidatedByAccountId,
    DateTimeOffset ValidatedAt);

public sealed record HumanResourcesAttendanceRow(
    Guid OperationId,
    Guid AssignmentId,
    Guid StationId,
    DateOnly OperationDate,
    string OperationCode,
    string AgentName,
    AttendanceDraftContributionData? Occ,
    AttendanceDraftContributionData? RampAgent,
    AttendanceValidationDecisionData? LatestDecision,
    bool IsDecisionCurrent);

public sealed record HumanResourcesAttendancePage(
    Guid StationId,
    DateOnly From,
    DateOnly To,
    int Page,
    int Limit,
    bool HasMore,
    IReadOnlyList<HumanResourcesAttendanceRow> Items);

public sealed record AttendanceValidationResult(
    AttendanceValidationDecisionData? Decision,
    bool Replayed,
    AttendanceValidationFailure? Failure)
{
    public static AttendanceValidationResult Success(
        AttendanceValidationDecisionData decision, bool replayed = false) =>
        new(decision, replayed, null);

    public static AttendanceValidationResult Failed(AttendanceValidationFailure failure) =>
        new(null, false, failure);
}
