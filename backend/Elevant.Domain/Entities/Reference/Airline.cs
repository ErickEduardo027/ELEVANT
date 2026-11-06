namespace Elevant.Domain.Entities.Reference;

public sealed class Airline : AuditableEntity
{
    public long OrganizationId { get; set; }

    /// <summary>Null for an operator without an IATA designator; the ICAO code is always present.</summary>
    public string? IataCode { get; set; }

    public string IcaoCode { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public bool IsActive { get; set; }
}
