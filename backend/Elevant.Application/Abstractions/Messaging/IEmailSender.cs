namespace Elevant.Application.Abstractions.Messaging;

/// <summary>An email ready to send. Bodies may carry one-time codes: never log them.</summary>
public sealed record EmailMessage(string To, string Subject, string HtmlBody, string TextBody,
    IReadOnlyList<EmailAttachment>? Attachments = null)
{
    public override string ToString() => $"{nameof(EmailMessage)} {{ Subject = {Subject}, Body = [REDACTED] }}";
}

/// <summary>Delivers email through the configured provider (SMTP in ELEVANT, ADR-0022).</summary>
public interface IEmailSender
{
    /// <summary>False when no provider is configured: emails then stay pending in the outbox.</summary>
    bool IsConfigured { get; }

    Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default);
}

/// <summary>A file sent with an email (e.g. the signed contract PDF).</summary>
public sealed record EmailAttachment(string FileName, string ContentType, byte[] Content)
{
    public override string ToString() => $"{nameof(EmailAttachment)} {{ FileName = {FileName}, Length = {Content.Length} }}";
}

/// <summary>
/// Builds an outbox attachment from its reference when the email is sent (ADR-0025), so the
/// outbox never stores the file. Null when the reference no longer points to anything.
/// </summary>
public interface IEmailAttachmentResolver
{
    Task<EmailAttachment?> ResolveAsync(string reference, CancellationToken cancellationToken = default);
}

public sealed record OutboxEmail(long Id, string To, string Subject, string HtmlBody, string TextBody,
    string? AttachmentReference = null)
{
    public override string ToString() => $"{nameof(OutboxEmail)} {{ Id = {Id}, Body = [REDACTED] }}";
}

public sealed record EmailDeliveryData(Guid Id, string Recipient, string Purpose, string Status, int Attempts,
    DateTimeOffset CreatedAt, DateTimeOffset? SentAt, string? LastError);

/// <summary>The email outbox the dispatcher drains and the superadmin can probe.</summary>
public interface IEmailOutboxStore
{
    Task<IReadOnlyList<OutboxEmail>> ClaimDueAsync(int maximum, CancellationToken cancellationToken = default);

    Task MarkSentAsync(long id, CancellationToken cancellationToken = default);

    /// <summary>Records a failure; the message is retried later until it gives up.</summary>
    Task MarkFailedAsync(long id, string reason, CancellationToken cancellationToken = default);

    /// <summary>Superadmin smoke test: queues a test email. Null when the actor is not the superadmin.</summary>
    Task<Guid?> EnqueueTestAsync(Guid actorId, string recipient, CancellationToken cancellationToken = default);

    /// <summary>Latest deliveries for the superadmin (without bodies). Null when not allowed.</summary>
    Task<IReadOnlyList<EmailDeliveryData>?> ListRecentAsync(Guid actorId, int limit,
        CancellationToken cancellationToken = default);
}
