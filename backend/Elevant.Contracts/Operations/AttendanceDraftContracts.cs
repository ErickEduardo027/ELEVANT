using System.Text.Json.Serialization;

namespace Elevant.Contracts.Operations;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SaveAttendanceDraftRequest
{
    [JsonRequired]
    public int ExpectedRevision { get; init; }

    public DateTimeOffset? ObservedStartAt { get; init; }

    public DateTimeOffset? ObservedEndAt { get; init; }

    public string? IncidentNote { get; init; }
}

public sealed record AttendanceDraftContributionResponse(
    int Revision,
    Guid AuthorAccountId,
    DateTimeOffset RecordedAt,
    [property: JsonRequired] DateTimeOffset? ObservedStartAt,
    [property: JsonRequired] DateTimeOffset? ObservedEndAt,
    [property: JsonRequired] string? IncidentNote);

public sealed record AttendanceDraftSnapshotResponse(
    Guid OperationId,
    Guid AssignmentId,
    Guid StationId,
    [property: JsonRequired] AttendanceDraftContributionResponse? Occ,
    [property: JsonRequired] AttendanceDraftContributionResponse? RampAgent);

public sealed record AttendanceDraftWriteResponse(
    AttendanceDraftContributionResponse Contribution,
    bool Replayed);

/// <summary>
/// An assignment whose attendance OCC records (3-F): an open one (<c>releasedAt</c> null) or one a handover released after
/// the operation started, whose agent worked until then.
/// </summary>
public sealed record OccAttendanceAssignmentResponse(
    Guid AssignmentId,
    Guid AgentId,
    string DisplayName,
    string EmployeeNumber,
    DateTimeOffset AssignedAt,
    [property: JsonRequired] DateTimeOffset? ReleasedAt);

/// <summary>The assignments of the turnaround's operation whose attendance OCC records, oldest first (3-F).</summary>
public sealed record OccAttendanceAssignmentsResponse(
    Guid TurnaroundId,
    Guid OperationId,
    IReadOnlyList<OccAttendanceAssignmentResponse> Assignments);
