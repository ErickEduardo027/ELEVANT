using System.Text.Json.Serialization;

namespace Elevant.Contracts.Operations;

/// <summary>
/// One step of an incident's life: its report (<c>FromStatus</c> null), each change OCC made and the approval's
/// resolution (3-G).
/// </summary>
public sealed record OccIncidentEventResponse(string? FromStatus, string ToStatus, string Note, DateTimeOffset OccurredAt,
    string Actor);

/// <summary>
/// An incident as OCC manages it (3-G): who reported it (<c>ReportedByKind</c> Agent or Occ), its resolution, its
/// version (also the ETag of the next change), the states OCC may move it to and its history.
/// </summary>
public sealed record OccIncidentResponse(Guid Id, string Type, string Severity, string Status, string Description,
    DateTimeOffset OccurredAt, DateTimeOffset ReportedAt, string? DelayCode, string ReportedBy, string ReportedByKind,
    string? ResolutionNote, DateTimeOffset? ResolvedAt, string? ResolvedBy, string Version,
    IReadOnlyList<string> AllowedStatuses, IReadOnlyList<OccIncidentEventResponse> History);

/// <summary>The live incidents of one operation and whether OCC may still report on it (3-G).</summary>
public sealed record OccIncidentListResponse(Guid OperationId, string OperationCode, string OperationStatus,
    string IanaTimeZone, bool CanReport, IReadOnlyList<OccIncidentResponse> Incidents);

/// <summary>
/// An incident OCC reports on an operation still open (3-G): the tablet's types and severities, a description of 8 to
/// 2000 characters, the time it occurred in UTC and, for a deviation, its IATA delay code.
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ReportOccIncidentRequest
{
    public string? IncidentType { get; init; }

    public string? Severity { get; init; }

    public string? Description { get; init; }

    public DateTimeOffset? OccurredAt { get; init; }

    public string? DelayCode { get; init; }
}

/// <summary>A change of an incident's state (InReview, Resolved or Closed) with its note of 8 to 2000 characters.</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ChangeOccIncidentStatusRequest
{
    public string? Status { get; init; }

    public string? Note { get; init; }
}
