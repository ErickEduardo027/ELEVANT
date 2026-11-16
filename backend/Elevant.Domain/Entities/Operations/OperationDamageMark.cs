namespace Elevant.Domain.Entities.Operations;

/// <summary>
/// A damage the agent marked on the aircraft silhouette during the 360° walk-around, with an
/// optional photo kept in private object storage. Position is normalized to the silhouette (0–1).
/// </summary>
public sealed class OperationDamageMark : AuditableEntity
{
    public long GroundOperationId { get; set; }

    public decimal PositionX { get; set; }

    public decimal PositionY { get; set; }

    public string Note { get; set; } = string.Empty;

    public long ReportedByRampAgentId { get; set; }

    public DateTimeOffset ReportedAt { get; set; }

    public string? PhotoObjectKey { get; set; }

    public string? PhotoContentType { get; set; }

    public int? PhotoLength { get; set; }

    public string? PhotoSha256 { get; set; }

    public DateTimeOffset? PhotoUploadedAt { get; set; }
}
