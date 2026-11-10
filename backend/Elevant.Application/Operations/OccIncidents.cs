using Elevant.Application.Abstractions.Operations;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations;

/// <summary>
/// How OCC manages the incidents of an operation (3-G): it reports its own, takes one into review, resolves it with a
/// note, closes it once resolved, or takes a resolved one back into review. A closed incident is final. Every change
/// carries a note (8 to 2000 characters) and is kept as a step of the incident's history; types and severities are
/// the tablet's (<see cref="RampIncidentPolicy"/>). OCC reports on an operation that is still open (neither approved
/// nor cancelled), at a time not in the future and not before the operation's window. Once the operation is approved
/// or cancelled its incidents are history: OCC only resolves or closes the ones still open, never takes one back into
/// review, so the approval's resolution stands until OCC reopens the review (3-H).
/// </summary>
public static class OccIncidentPolicy
{
    public const string ReadPermission = "operations.incidents.read";
    public const string UpdatePermission = "operations.incidents.update";
    public const int NoteMinimum = 8;
    public const int NoteMaximum = 2000;

    /// <summary>Clock skew tolerated between OCC's screen and the server, as on the tablet.</summary>
    public static readonly TimeSpan ClockTolerance = RampEvidenceTimePolicy.ClockTolerance;

    private static readonly IncidentStatus[] Statuses = Enum.GetValues<IncidentStatus>();

    public static bool CanTransition(IncidentStatus from, IncidentStatus to) => (from, to) switch
    {
        (IncidentStatus.Open, IncidentStatus.InReview) => true,
        (IncidentStatus.Open or IncidentStatus.InReview, IncidentStatus.Resolved) => true,
        (IncidentStatus.Resolved, IncidentStatus.Closed) => true,
        (IncidentStatus.Resolved, IncidentStatus.InReview) => true,
        _ => false,
    };

    /// <summary>
    /// <see cref="CanTransition(IncidentStatus, IncidentStatus)"/> on an operation in <paramref name="operation"/>:
    /// approved or cancelled, only the steps that close an incident remain (resolve it, close it).
    /// </summary>
    public static bool CanTransition(IncidentStatus from, IncidentStatus to, GroundOperationStatus operation) =>
        CanTransition(from, to) && (CanReport(operation) || to is IncidentStatus.Resolved or IncidentStatus.Closed);

    /// <summary>The states OCC may move an incident to from its current one.</summary>
    public static IReadOnlyList<IncidentStatus> NextStatuses(IncidentStatus from) =>
        Statuses.Where(to => CanTransition(from, to)).ToArray();

    /// <summary>The states OCC may move an incident to from its current one, on an operation in that state.</summary>
    public static IReadOnlyList<IncidentStatus> NextStatuses(IncidentStatus from, GroundOperationStatus operation) =>
        Statuses.Where(to => CanTransition(from, to, operation)).ToArray();

    /// <summary>A known incident state by its exact name, or null.</summary>
    public static IncidentStatus? ParseStatus(string? value) =>
        Statuses.Where(status => status.ToString() == value).Select(status => (IncidentStatus?)status).FirstOrDefault();

    /// <summary>A known severity by its exact name, or null.</summary>
    public static IncidentSeverity? ParseSeverity(string? value) =>
        Enum.GetValues<IncidentSeverity>().Where(severity => severity.ToString() == value)
            .Select(severity => (IncidentSeverity?)severity).FirstOrDefault();

    /// <summary>The note of a change, trimmed: 8 to 2000 characters without control characters; null otherwise.</summary>
    public static string? Note(string? note)
    {
        var trimmed = note?.Trim();
        return trimmed is { Length: >= NoteMinimum and <= NoteMaximum } &&
               !trimmed.Any(character => char.IsControl(character) && character is not ('\t' or '\n' or '\r'))
            ? trimmed : null;
    }

    /// <summary>OCC reports an incident on an operation still open: neither approved nor cancelled.</summary>
    public static bool CanReport(GroundOperationStatus status) =>
        status is not (GroundOperationStatus.Approved or GroundOperationStatus.Cancelled);

    /// <summary>
    /// The time an incident occurred, as OCC typed it in the station's local time: from the operation's window
    /// (<paramref name="opensAt"/>, its start, arrival or planned start) to now, both with the clock tolerance.
    /// </summary>
    public static bool IsValidOccurredAt(DateTimeOffset occurredAt, DateTimeOffset opensAt, DateTimeOffset now) =>
        occurredAt.Year >= 2000 && occurredAt >= opensAt - ClockTolerance && occurredAt <= now + ClockTolerance;
}

/// <summary>Problem Details codes of the OCC incident commands (3-G).</summary>
public static class OccIncidentCodes
{
    /// <summary>The incident cannot move from its state to the one asked (a closed incident is final).</summary>
    public const string TransitionInvalid = "incident_transition_invalid";

    /// <summary>The report is incomplete: an unknown type or severity, a short description or a missing delay code.</summary>
    public const string ReportInvalid = "incident_report_invalid";

    /// <summary>The time is in the future or before the operation's window.</summary>
    public const string OccurredAtInvalid = "incident_occurred_at_invalid";

    /// <summary>
    /// The operation is approved or cancelled: its incidents are history (no new report, none taken back into review).
    /// </summary>
    public const string OperationClosed = "operation_closed";

    /// <summary>The command cannot be read: the version in If-Match is not a strong ETag.</summary>
    public const string RequestInvalid = "invalid_incident_request";
}

/// <summary>One step of an incident's life: its report, each change OCC made and the approval's resolution.</summary>
public sealed record OccIncidentEventData(string? FromStatus, string ToStatus, string Note, DateTimeOffset OccurredAt,
    string Actor);

/// <summary>
/// An incident of an operation as OCC manages it: who reported it (<c>ReportedByKind</c> is Agent for the ramp agent,
/// Occ for an OCC account), its resolution, its version (the ETag of the next change), the states it may move to and
/// its history.
/// </summary>
public sealed record OccIncidentData(Guid Id, string Type, string Severity, string Status, string Description,
    DateTimeOffset OccurredAt, DateTimeOffset ReportedAt, string? DelayCode, string ReportedBy, string ReportedByKind,
    string? ResolutionNote, DateTimeOffset? ResolvedAt, string? ResolvedBy, string Version,
    IReadOnlyList<string> AllowedStatuses, IReadOnlyList<OccIncidentEventData> History);

/// <summary>The live incidents of one operation of OCC's stations, and whether OCC may still report on it.</summary>
public sealed record OccIncidentListData(Guid OperationId, string OperationCode, string OperationStatus,
    string IanaTimeZone, bool CanReport, IReadOnlyList<OccIncidentData> Incidents);

/// <summary>An incident OCC reports, with the time it occurred in UTC.</summary>
public sealed record OccIncidentReportInput(string? IncidentType, string? Severity, string? Description,
    DateTimeOffset? OccurredAt, string? DelayCode);

/// <summary>A change of an incident's state with its note and the version OCC saw.</summary>
public sealed record OccIncidentStatusInput(string? Status, string? Note, string? ExpectedVersion);

public interface IOccIncidentStore
{
    Task<MasterDataResult<OccIncidentListData>> ListAsync(Guid actorId, Guid operationId,
        CancellationToken cancellationToken = default);

    Task<MasterDataResult<OccIncidentData>> ReportAsync(Guid actorId, Guid operationId, OccIncidentReportInput input,
        Guid? idempotencyKey, CancellationToken cancellationToken = default);

    Task<MasterDataResult<OccIncidentData>> ChangeStatusAsync(Guid actorId, Guid incidentId, OccIncidentStatusInput input,
        Guid? idempotencyKey, CancellationToken cancellationToken = default);
}
