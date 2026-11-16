namespace Elevant.Domain.Entities.Operations;

/// <summary>Immutable OCC or ramp-agent observation at one assignment revision.</summary>
public sealed class OperationAttendanceContributionRevision : AuditableEntity
{
    public long OperationAgentAssignmentId { get; set; }

    public string Lane { get; set; } = string.Empty;

    public int RevisionNumber { get; set; }

    public long AuthorAccountId { get; set; }

    public Guid? InstallationId { get; set; }

    public Guid IdempotencyKey { get; set; }

    public string PayloadSha256 { get; set; } = string.Empty;

    public DateTimeOffset? ObservedStartAt { get; set; }

    public DateTimeOffset? ObservedEndAt { get; set; }

    public string? IncidentNote { get; set; }

    public DateTimeOffset RecordedAt { get; set; }
}
