namespace Elevant.Domain.Entities.Reference;

public sealed class EquipmentType : AuditableEntity
{
    public string Code { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public bool RequiresQualification { get; set; }

    public bool IsActive { get; set; }
}
