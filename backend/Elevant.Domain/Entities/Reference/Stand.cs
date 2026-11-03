namespace Elevant.Domain.Entities.Reference;

public sealed class Stand : AuditableEntity
{
    public long StationId { get; set; }

    public long? TerminalId { get; set; }

    public string Code { get; set; } = string.Empty;

    public string? StandType { get; set; }

    public bool IsActive { get; set; }

    /// <summary>WGS84 location OCC places on the map (ADR-0027); null until someone places it.</summary>
    public decimal? Latitude { get; set; }

    public decimal? Longitude { get; set; }

    public DateTimeOffset? LocatedAt { get; set; }
}
