using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace Elevant.Contracts.Operations;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ReportRampIncidentRequest
{
    public ReportRampIncidentRequest(
        string incidentType,
        string severity,
        string description,
        DateTimeOffset occurredAt)
    {
        IncidentType = incidentType;
        Severity = severity;
        Description = description;
        OccurredAt = occurredAt;
    }

    [Required(AllowEmptyStrings = false)]
    [RegularExpression("^(Operational|Safety|Equipment|Documentation|Deviation)$")]
    public string IncidentType { get; init; }

    [Required(AllowEmptyStrings = false)]
    [RegularExpression("^(Low|Medium|High|Critical)$")]
    public string Severity { get; init; }

    [Required(AllowEmptyStrings = false)]
    [StringLength(2000, MinimumLength = 8)]
    public string Description { get; init; }

    [Required]
    public DateTimeOffset OccurredAt { get; init; }

    /// <summary>IATA delay code (two digits); required for a Deviation, absent otherwise (ADR-0031).</summary>
    [RegularExpression("^[0-9]{2}$")]
    public string? DelayCode { get; init; }
}

public sealed record RampIncidentResponse(
    Guid Id,
    string IncidentType,
    string Severity,
    string Status,
    string Description,
    DateTimeOffset OccurredAt,
    DateTimeOffset ReportedAt,
    string? DelayCode);

public sealed record GetRampIncidentsResponse(
    Guid OperationId,
    IReadOnlyList<RampIncidentResponse> Incidents);

public sealed record RampIncidentReceiptResponse(
    Guid ReceiptId,
    Guid OperationId,
    Guid IncidentId,
    string Status,
    DateTimeOffset OccurredAt,
    DateTimeOffset ReportedAt);
