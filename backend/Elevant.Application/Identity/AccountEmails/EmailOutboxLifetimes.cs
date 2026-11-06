using Elevant.Domain.Enumerations;

namespace Elevant.Application.Identity.AccountEmails;

/// <summary>
/// How long a queued email is still worth sending (1-N09). An activation link, a login code or a
/// reset link is useless once its token expires, so the outbox discards it instead of sending it
/// late, also while SMTP is not configured. Emails without a one-time secret (signed contracts,
/// invoices, receipts, request decisions and the test) never expire in the queue.
/// </summary>
public static class EmailOutboxLifetimes
{
    /// <summary>The lifetime of the secret the email carries, or null when it does not expire.</summary>
    public static TimeSpan? For(EmailPurpose purpose) => purpose switch
    {
        EmailPurpose.Activation => AccountEmailOptions.ActivationLifetime,
        EmailPurpose.LoginCode => AccountEmailOptions.LoginCodeLifetime,
        EmailPurpose.PasswordReset => AccountEmailOptions.PasswordResetLifetime,
        _ => null,
    };

    /// <summary>Every purpose whose queued email expires, with its lifetime.</summary>
    public static IReadOnlyList<(EmailPurpose Purpose, TimeSpan Lifetime)> Expiring { get; } =
        Enum.GetValues<EmailPurpose>().Where(purpose => For(purpose) is not null)
            .Select(purpose => (purpose, For(purpose)!.Value)).ToArray();

    /// <summary>True when an email created at <paramref name="createdAt"/> is past the lifetime of its secret.</summary>
    public static bool IsExpired(EmailPurpose purpose, DateTimeOffset createdAt, DateTimeOffset now) =>
        For(purpose) is { } lifetime && createdAt + lifetime <= now;
}
