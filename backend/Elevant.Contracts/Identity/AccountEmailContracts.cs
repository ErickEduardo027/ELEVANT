namespace Elevant.Contracts.Identity;

/// <summary>A portal login that continues with the 6-digit code sent to the account's email (ADR-0022).</summary>
public sealed record LoginChallengeResponse(Guid ChallengeId, string EmailHint, DateTimeOffset ExpiresAt)
{
    public string Code => "code_required";
}

public sealed record VerifyLoginCodeRequest(Guid ChallengeId, string Code)
{
    public override string ToString() => $"{nameof(VerifyLoginCodeRequest)} {{ Code = [REDACTED] }}";
}

public sealed record ResendLoginCodeRequest(Guid ChallengeId);

/// <summary>Sets the password from an activation or reset link; the token comes from the link.</summary>
public sealed record SetPasswordWithTokenRequest(string Token, string NewPassword)
{
    public override string ToString() => $"{nameof(SetPasswordWithTokenRequest)} {{ Token = [REDACTED], NewPassword = [REDACTED] }}";
}

public sealed record PasswordResetRequest(string Email);

public sealed record SendTestEmailRequest(string To);

public sealed record EmailDeliveryResponse(Guid Id, string Recipient, string Purpose, string Status, int Attempts,
    DateTimeOffset CreatedAt, DateTimeOffset? SentAt, string? LastError);

public sealed record EmailDeliveriesResponse(bool SmtpConfigured, IReadOnlyList<EmailDeliveryResponse> Deliveries);

/// <summary>
/// What an outbox email is about (1-N22): <c>Kind</c> is <c>contract</c>, <c>invoice</c>, <c>payment</c>,
/// <c>account</c> or <c>request</c>; <c>Label</c> is the document code or the person and <c>Context</c>
/// the airline or organization.
/// </summary>
public sealed record EmailReferenceResponse(string Kind, Guid? Id, string Label, string? Context);

/// <summary>
/// An email of the superadmin outbox, without its body. <c>Reason</c> is the normalized code of a
/// failed or discarded email (expired, superseded, invitation_closed, smtp_rejected,
/// smtp_authentication, smtp_unavailable, attachment_unavailable or send_failed).
/// </summary>
public sealed record EmailOutboxEntryResponse(Guid Id, string Recipient, string Purpose, string Status, int Attempts,
    DateTimeOffset CreatedAt, DateTimeOffset? SentAt, DateTimeOffset UpdatedAt, string? Reason,
    EmailReferenceResponse? Reference);

/// <summary>A page of the superadmin outbox, newest first, and whether SMTP is configured (1-N22).</summary>
public sealed record EmailOutboxPageResponse(bool SmtpConfigured, int Page, int Limit, bool HasMore,
    IReadOnlyList<EmailOutboxEntryResponse> Entries);
