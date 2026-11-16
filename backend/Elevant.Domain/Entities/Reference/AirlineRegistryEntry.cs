namespace Elevant.Domain.Entities.Reference;

/// <summary>
/// An airline as a provider's flight data names it (ADR-0028), harvested for free from responses
/// already paid for. Airline checks read it before any public registry.
/// </summary>
public sealed class AirlineRegistryEntry : AuditableEntity
{
    /// <summary>Normalized «IATA|ICAO» pair, unique.</summary>
    public string RegistryKey { get; set; } = string.Empty;

    public string? IataCode { get; set; }

    public string? IcaoCode { get; set; }

    public string Name { get; set; } = string.Empty;

    public string Source { get; set; } = string.Empty;

    public DateTimeOffset FirstSeenAt { get; set; }

    public DateTimeOffset LastSeenAt { get; set; }
}
