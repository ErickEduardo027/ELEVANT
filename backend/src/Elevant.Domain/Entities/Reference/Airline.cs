namespace Elevant.Domain.Entities.Reference;

public sealed class Airline : AuditableEntity
{
    public long OrganizationId { get; set; }

    public string IataCode { get; set; } = string.Empty;

    public string IcaoCode { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public bool IsActive { get; set; }
}
