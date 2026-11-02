using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Infrastructure;

/// <summary>
/// An email waiting to be sent (ADR-0022). It is written in the transaction of what caused it and
/// sent later by the dispatcher; once sent, the body is cleared so codes and links do not linger.
/// </summary>
public sealed class EmailOutboxMessage : AuditableEntity
{
    public string Recipient { get; set; } = string.Empty;

    public string Subject { get; set; } = string.Empty;

    public string? HtmlBody { get; set; }

    public string? TextBody { get; set; }

    public EmailPurpose Purpose { get; set; }

    public EmailDeliveryStatus Status { get; set; }

    public int Attempts { get; set; }

    public DateTimeOffset NextAttemptAt { get; set; }

    public DateTimeOffset? SentAt { get; set; }

    /// <summary>Short, non-sensitive reason of the last failure.</summary>
    public string? LastError { get; set; }
}
