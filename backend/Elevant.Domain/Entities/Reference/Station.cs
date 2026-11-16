namespace Elevant.Domain.Entities.Reference;

public sealed class Station : AuditableEntity
{
    public long AirportId { get; set; }

    public string Code { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public string IanaTimeZone { get; set; } = string.Empty;

    public bool IsActive { get; set; }
}
