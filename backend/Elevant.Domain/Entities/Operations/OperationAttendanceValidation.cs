namespace Elevant.Domain.Entities.Operations;

/// <summary>An immutable G.H. decision over two specific attendance contribution revisions.</summary>
public sealed class OperationAttendanceValidation : AuditableEntity
{
    public long OperationAgentAssignmentId { get; set; }

    public long OccContributionRevisionId { get; set; }

    public long RampAgentContributionRevisionId { get; set; }

    public string StartSource { get; set; } = string.Empty;

    public string EndSource { get; set; } = string.Empty;

    public DateTimeOffset StartAt { get; set; }

    public DateTimeOffset EndAt { get; set; }

    public string? Reason { get; set; }

    public long ValidatedByAccountId { get; set; }

    public DateTimeOffset ValidatedAt { get; set; }

    public Guid IdempotencyKey { get; set; }

    public string PayloadSha256 { get; set; } = string.Empty;
}
