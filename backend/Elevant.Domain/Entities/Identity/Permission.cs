namespace Elevant.Domain.Entities.Identity;

public sealed class PermissionDefinition : Entity<long>
{
    public Guid PublicId { get; set; }

    public string Code { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public string? Description { get; set; }
}
