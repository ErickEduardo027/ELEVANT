namespace Elevant.Domain.Entities.Operations;

public sealed class OperationEquipmentAssignment : AuditableEntity
{
    public long GroundOperationId { get; set; }

    public long EquipmentAssetId { get; set; }

    public DateTimeOffset AssignedAt { get; set; }

    public DateTimeOffset? ReleasedAt { get; set; }

    public long? AssignedByAccountId { get; set; }
}
