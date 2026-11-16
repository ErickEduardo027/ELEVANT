using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Operations;

public sealed class Incident : AuditableEntity
{
    public long GroundOperationId { get; set; }

    /// <summary>The ramp agent who reported it from the tablet; null when OCC reported it (3-G).</summary>
    public long? ReportedByRampAgentId { get; set; }

    /// <summary>The OCC account that reported it (3-G); null when the ramp agent did. One of the two is always set.</summary>
    public long? ReportedByAccountId { get; set; }

    public string IncidentType { get; set; } = string.Empty;

    public IncidentSeverity Severity { get; set; }

    public IncidentStatus Status { get; set; }

    public string Description { get; set; } = string.Empty;

    public DateTimeOffset OccurredAt { get; set; }

    public DateTimeOffset ReportedAt { get; set; }

    public DateTimeOffset? ResolvedAt { get; set; }

    public long? ResolvedByAccountId { get; set; }

    public string? ResolutionNote { get; set; }

    /// <summary>IATA delay code of a deviation (ADR-0031); null for other incident types.</summary>
    public string? DelayCode { get; set; }
}
