namespace Elevant.Domain.Entities.Infrastructure;

/// <summary>Durable integration event waiting to be published.</summary>
public sealed class OutboxMessage : Entity<long>
{
    public Guid PublicId { get; set; }

    public DateTimeOffset OccurredAt { get; set; }

    public string EventType { get; set; } = string.Empty;

    public string PayloadJson { get; set; } = string.Empty;

    public DateTimeOffset? ProcessedAt { get; set; }

    public int AttemptCount { get; set; }

    public string? LastError { get; set; }
}
