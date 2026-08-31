using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Operations;

public sealed class OperationMilestone : AuditableEntity
{
    public long GroundOperationId { get; set; }

    public string Code { get; set; } = string.Empty;

    public DateTimeOffset? PlannedAt { get; set; }

    public DateTimeOffset? EstimatedAt { get; set; }

    public DateTimeOffset? ActualAt { get; set; }

    public MilestoneStatus Status { get; set; }

    public OperationalDataSource Source { get; set; }
}
