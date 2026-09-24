namespace Elevant.Domain.Entities.Operations;

/// <summary>Account-targeted, durable operational event with an individual read receipt.</summary>
public sealed class OperationalNotification : AuditableEntity
{
    public long RecipientAccountId { get; set; }

    public long StationId { get; set; }

    public long GroundOperationId { get; set; }

    public Guid SourceId { get; set; }

    public string Kind { get; set; } = string.Empty;

    public DateTimeOffset OccurredAt { get; set; }

    public DateTimeOffset? ReadAt { get; set; }
}
