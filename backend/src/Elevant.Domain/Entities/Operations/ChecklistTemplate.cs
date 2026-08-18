namespace Elevant.Domain.Entities.Operations;

public sealed class ChecklistTemplate : AuditableEntity
{
    public string Code { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public bool IsActive { get; set; }
}
