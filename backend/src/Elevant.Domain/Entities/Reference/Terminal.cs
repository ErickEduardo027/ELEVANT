namespace Elevant.Domain.Entities.Reference;

public sealed class Terminal : AuditableEntity
{
    public long StationId { get; set; }

    public string Code { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public bool IsActive { get; set; }
}
