namespace Elevant.Domain.Entities.Operations;

/// <summary>Immutable text message in the conversation of one ground operation.</summary>
public sealed class OperationMessage : AuditableEntity
{
    public long GroundOperationId { get; set; }

    public long SenderAccountId { get; set; }

    public long? MobileDeviceId { get; set; }

    public Guid ClientMessageId { get; set; }

    public string SenderRole { get; set; } = string.Empty;

    public string Content { get; set; } = string.Empty;

    public DateTimeOffset SentAt { get; set; }
}
