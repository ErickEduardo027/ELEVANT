namespace Elevant.Domain.Entities.Reference;

public sealed class Airport : AuditableEntity
{
    public string IataCode { get; set; } = string.Empty;

    public string IcaoCode { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public string City { get; set; } = string.Empty;

    public string CountryCode { get; set; } = string.Empty;
}
