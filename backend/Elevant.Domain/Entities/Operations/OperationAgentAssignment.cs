namespace Elevant.Domain.Entities.Operations;

public sealed class OperationAgentAssignment : AuditableEntity
{
    public long GroundOperationId { get; set; }

    public long RampAgentId { get; set; }

    public long? OperationalPositionId { get; set; }

    public string AssignmentRole { get; set; } = string.Empty;

    public DateTimeOffset AssignedAt { get; set; }

    public DateTimeOffset? ReleasedAt { get; set; }

    public long? AssignedByAccountId { get; set; }
}
