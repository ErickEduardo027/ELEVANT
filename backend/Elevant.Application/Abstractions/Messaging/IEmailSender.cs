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

    /// <summary>Sends the message; a failure throws <see cref="EmailSendException"/> with its normalized reason.</summary>
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

/// <summary>An email of the outbox; <c>LastError</c> is the normalized reason (<see cref="EmailDeliveryReasons"/>) of a failed or discarded one.</summary>
public sealed record EmailDeliveryData(Guid Id, string Recipient, string Purpose, string Status, int Attempts,
    DateTimeOffset CreatedAt, DateTimeOffset? SentAt, string? LastError);

/// <summary>
/// Page of the superadmin outbox (1-N22). <paramref name="Status"/> is <c>All</c> or a delivery status;
/// the newest emails come first.
/// </summary>
public sealed record EmailOutboxQuery(string Status, int Page, int Limit)
{
    public const string All = "All";

    public static IReadOnlyList<string> Statuses { get; } = [All, "Pending", "Sent", "Failed", "Discarded"];

    public bool IsValid => Statuses.Contains(Status) && Page >= 1 && Limit is >= 1 and <= 50 &&
        (long)(Page - 1) * Limit <= int.MaxValue;
}

/// <summary>
/// What an email is about: <paramref name="Kind"/> is <c>contract</c>, <c>invoice</c>, <c>payment</c>,
/// <c>account</c> or <c>request</c>; <paramref name="Label"/> is the document code or the person, and
/// <paramref name="Context"/> the airline or organization.
/// </summary>
public sealed record EmailReferenceData(string Kind, Guid? Id, string Label, string? Context);

/// <summary>An email of the superadmin outbox; <c>Reason</c> is the normalized reason (<see cref="EmailDeliveryReasons"/>) of a failed or discarded one.</summary>
public sealed record EmailOutboxEntryData(Guid Id, string Recipient, string Purpose, string Status, int Attempts,
    DateTimeOffset CreatedAt, DateTimeOffset? SentAt, DateTimeOffset UpdatedAt, string? Reason, EmailReferenceData? Reference);

public sealed record EmailOutboxPageData(int Page, int Limit, bool HasMore, IReadOnlyList<EmailOutboxEntryData> Entries);

/// <summary>The email outbox the dispatcher drains and the superadmin can probe.</summary>
public interface IEmailOutboxStore
{
    Task<IReadOnlyList<OutboxEmail>> ClaimDueAsync(int maximum, CancellationToken cancellationToken = default);

    Task MarkSentAsync(long id, CancellationToken cancellationToken = default);

    /// <summary>Records a failure with its normalized reason; the message is retried later until it gives up.</summary>
    Task MarkFailedAsync(long id, string reason, CancellationToken cancellationToken = default);

    /// <summary>
    /// Discards the pending emails whose link or code expired (1-N09): the body is cleared and the
    /// reason kept. It runs also without SMTP. With <paramref name="scrubHistory"/> it removes the
    /// login code from the subjects stored before the code left the subject.
    /// </summary>
    Task<int> DiscardExpiredAsync(bool scrubHistory, CancellationToken cancellationToken = default);

    /// <summary>Superadmin smoke test: queues a test email. Null when the actor is not the superadmin.</summary>
    Task<Guid?> EnqueueTestAsync(Guid actorId, string recipient, CancellationToken cancellationToken = default);

    /// <summary>Latest deliveries for the superadmin (without bodies). Null when not allowed.</summary>
    Task<IReadOnlyList<EmailDeliveryData>?> ListRecentAsync(Guid actorId, int limit,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// The superadmin outbox with the reason of each email and the document or account it is about
    /// (1-N22). Null when the actor is not the superadmin.
    /// </summary>
    Task<EmailOutboxPageData?> ListOutboxAsync(Guid actorId, EmailOutboxQuery query,
        CancellationToken cancellationToken = default);
}
