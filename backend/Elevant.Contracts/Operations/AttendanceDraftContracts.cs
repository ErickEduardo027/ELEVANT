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
