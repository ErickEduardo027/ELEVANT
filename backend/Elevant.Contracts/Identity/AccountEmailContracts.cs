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
