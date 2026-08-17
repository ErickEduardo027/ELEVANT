namespace Elevant.Domain.Entities.Reference;

public sealed class AircraftType : AuditableEntity
{
    public string IcaoCode { get; set; } = string.Empty;

    public string? IataCode { get; set; }

    public string Manufacturer { get; set; } = string.Empty;

    public string Model { get; set; } = string.Empty;

    public bool IsActive { get; set; }
}
