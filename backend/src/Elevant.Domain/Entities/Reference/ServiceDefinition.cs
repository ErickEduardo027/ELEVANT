namespace Elevant.Domain.Entities.Reference;

public sealed class ServiceDefinition : AuditableEntity
{
    public string Code { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public string? Description { get; set; }

    public string DefaultBillingUnit { get; set; } = string.Empty;

    public bool IsActive { get; set; }
}
