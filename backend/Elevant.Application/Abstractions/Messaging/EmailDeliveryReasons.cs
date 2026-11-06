namespace Elevant.Application.Abstractions.Messaging;

/// <summary>
/// Normalized reason of an email that was not sent (1-N09, 1-N22). The outbox stores one of these
/// codes, never the provider's exception text, and the screens explain each one in Spanish.
/// </summary>
public static class EmailDeliveryReasons
{
    /// <summary>The link or code expired before the email could be sent; it was discarded.</summary>
    public const string Expired = "expired";

    /// <summary>A newer link or code replaced the one this email carried; it was discarded.</summary>
    public const string Superseded = "superseded";

    /// <summary>The superadministrator closed the invitation with a temporary password (1-N12).</summary>
    public const string InvitationClosed = "invitation_closed";

    /// <summary>The mail server refused the message or its recipient.</summary>
    public const string SmtpRejected = "smtp_rejected";

    /// <summary>The mail server refused the credentials of the no-reply account.</summary>
    public const string SmtpAuthentication = "smtp_authentication";

    /// <summary>The mail server could not be reached or did not answer in time.</summary>
    public const string SmtpUnavailable = "smtp_unavailable";

    /// <summary>The document the email attaches no longer exists.</summary>
    public const string AttachmentUnavailable = "attachment_unavailable";

    /// <summary>Any other failure; also the reading of an older free-text reason.</summary>
    public const string SendFailed = "send_failed";

    private static readonly HashSet<string> Known = new(StringComparer.Ordinal)
    {
        Expired, Superseded, InvitationClosed, SmtpRejected, SmtpAuthentication, SmtpUnavailable, AttachmentUnavailable,
        SendFailed,
    };

    public static IReadOnlyCollection<string> All => Known;

    /// <summary>The stored reason as a known code: an older free-text reason reads as <see cref="SendFailed"/>.</summary>
    public static string? Normalize(string? stored) =>
        string.IsNullOrWhiteSpace(stored) ? null : Known.Contains(stored) ? stored : SendFailed;
}

/// <summary>A send the provider refused or could not complete, with its normalized <see cref="Reason"/>.</summary>
public sealed class EmailSendException : Exception
{
    /// <summary>One of <see cref="EmailDeliveryReasons"/>.</summary>
    public string Reason { get; }

    public EmailSendException() : this(EmailDeliveryReasons.SendFailed, "The email could not be sent.", null) { }

    public EmailSendException(string message) : this(EmailDeliveryReasons.SendFailed, message, null) { }

    public EmailSendException(string message, Exception innerException)
        : this(EmailDeliveryReasons.SendFailed, message, innerException) { }

    private EmailSendException(string reason, string message, Exception? innerException)
        : base(message, innerException) => Reason = reason;

    /// <summary>A failure with a known reason; the message never carries the email body.</summary>
    public static EmailSendException For(string reason, Exception? innerException = null) =>
        new(EmailDeliveryReasons.Normalize(reason) ?? EmailDeliveryReasons.SendFailed,
            $"The email could not be sent ({reason}).", innerException);
}
