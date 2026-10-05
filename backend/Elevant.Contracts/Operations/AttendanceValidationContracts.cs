using System.Text.Json.Serialization;

namespace Elevant.Contracts.Operations;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ValidateAttendanceRequest
{
    [JsonRequired]
    public int ExpectedOccRevision { get; init; }

    [JsonRequired]
    public int ExpectedRampAgentRevision { get; init; }

    [JsonRequired]
    public required string StartSource { get; init; }

    [JsonRequired]
    public required string EndSource { get; init; }

    public string? Reason { get; init; }
}

public sealed record AttendanceValidationDecisionResponse(
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

public sealed record AttendanceValidationWriteResponse(
    AttendanceValidationDecisionResponse Decision,
    bool Replayed);

public sealed record HumanResourcesAttendanceRowResponse(
    Guid OperationId,
    Guid AssignmentId,
    Guid StationId,
    DateOnly OperationDate,
    string OperationCode,
    string AgentName,
    AttendanceDraftContributionResponse? Occ,
    AttendanceDraftContributionResponse? RampAgent,
    AttendanceValidationDecisionResponse? LatestDecision,
    bool IsDecisionCurrent);

public sealed record HumanResourcesAttendancePageResponse(
    Guid StationId,
    DateOnly From,
    DateOnly To,
    int Page,
    int Limit,
    bool HasMore,
    IReadOnlyList<HumanResourcesAttendanceRowResponse> Items);
