namespace Elevant.Domain.Entities.Operations;

/// <summary>
/// How far one account has read an operation's chat (ADR-0029). It only moves forward; it gives
/// the unread count per conversation and the «visto» shown to the other participants.
/// </summary>
public sealed class OperationMessageRead : AuditableEntity
{
    public long AccountId { get; set; }

    public long GroundOperationId { get; set; }

    public long LastReadMessageId { get; set; }

    public DateTimeOffset ReadAt { get; set; }
}
