namespace Elevant.Application.Operations;

public enum AttendanceDraftLane
{
    Occ = 1,
    RampAgent = 2,
}

public enum AttendanceDraftFailure
{
    Invalid,
    Unauthorized,
    Forbidden,
    NotFound,
    Conflict,
}

public sealed record AttendanceDraftContributionData(
    int Revision,
    Guid AuthorAccountId,
    DateTimeOffset RecordedAt,
    DateTimeOffset? ObservedStartAt,
    DateTimeOffset? ObservedEndAt,
    string? IncidentNote);

public sealed record AttendanceDraftSnapshotData(
    Guid OperationId,
    Guid AssignmentId,
    Guid StationId,
    AttendanceDraftContributionData? Occ,
    AttendanceDraftContributionData? RampAgent);

public sealed record AttendanceDraftReadResult(
    AttendanceDraftSnapshotData? Snapshot,
    AttendanceDraftFailure? Failure)
{
    public bool IsSuccess => Snapshot is not null && Failure is null;

    public static AttendanceDraftReadResult Success(AttendanceDraftSnapshotData snapshot) =>
        new(snapshot, null);

    public static AttendanceDraftReadResult Failed(AttendanceDraftFailure failure) =>
        new(null, failure);
}

public sealed record AttendanceDraftWriteRequest(
    Guid ActorAccountId,
    Guid OperationId,
    Guid AssignmentId,
    AttendanceDraftLane Lane,
    int ExpectedRevision,
    DateTimeOffset? ObservedStartAt,
    DateTimeOffset? ObservedEndAt,
    string? IncidentNote,
    Guid IdempotencyKey,
    Guid? InstallationId,
    string? RequestId);

public sealed record AttendanceDraftWriteResult(
    AttendanceDraftContributionData? Contribution,
    bool Replayed,
    AttendanceDraftFailure? Failure)
{
    public bool IsSuccess => Contribution is not null && Failure is null;

    public static AttendanceDraftWriteResult Success(
        AttendanceDraftContributionData contribution,
        bool replayed = false) => new(contribution, replayed, null);

    public static AttendanceDraftWriteResult Failed(AttendanceDraftFailure failure) =>
        new(null, false, failure);
}
