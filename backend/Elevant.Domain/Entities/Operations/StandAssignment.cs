namespace Elevant.Domain.Entities.Operations;

public sealed class StandAssignment : AuditableEntity
{
    public long TurnaroundId { get; set; }

    public long StandId { get; set; }

    public DateTimeOffset AssignedFrom { get; set; }

    public DateTimeOffset? AssignedTo { get; set; }

    public long? AssignedByAccountId { get; set; }

    public string? Reason { get; set; }
}
