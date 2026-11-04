using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Reference;

public sealed class AircraftType : AuditableEntity
{
    public string IcaoCode { get; set; } = string.Empty;

    public string? IataCode { get; set; }

    public string Manufacturer { get; set; } = string.Empty;

    public string Model { get; set; } = string.Empty;

    public bool IsActive { get; set; }

    /// <summary>Narrow-body or wide-body, for stand limits (ADR-0030); null when unknown.</summary>
    public AircraftSizeCategory? SizeCategory { get; set; }
}
