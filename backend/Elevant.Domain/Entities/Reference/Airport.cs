namespace Elevant.Domain.Entities.Reference;

public sealed class Airport : AuditableEntity
{
    public string IataCode { get; set; } = string.Empty;

    public string IcaoCode { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public string City { get; set; } = string.Empty;

    public string CountryCode { get; set; } = string.Empty;

    /// <summary>IANA time zone; filled from provider flight data when first seen (ADR-0028).</summary>
    public string? IanaTimeZone { get; set; }

    /// <summary>WGS84 reference point; filled from provider flight data when first seen.</summary>
    public decimal? Latitude { get; set; }

    public decimal? Longitude { get; set; }
}
