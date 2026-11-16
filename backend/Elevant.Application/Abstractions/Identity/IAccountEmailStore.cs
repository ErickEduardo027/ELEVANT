namespace Elevant.Application.Abstractions.Identity;

/// <summary>A login waiting for the code sent by email; the code itself never leaves the email.</summary>
public sealed record LoginChallenge(Guid ChallengeId, string EmailHint, DateTimeOffset ExpiresAt);

public enum AccountEmailFailure
{
    /// <summary>Unknown, used, expired or locked after too many attempts. Deliberately vague.</summary>
    Invalid,

    /// <summary>The new password does not meet the password policy.</summary>
    WeakPassword,
}

public sealed record AccountEmailResult(Guid? AccountId, AccountEmailFailure? Failure)
{
    public bool IsSuccess => Failure is null;
}

/// <summary>
/// One-time email secrets of portal accounts (ADR-0022): the 6-digit login code, the activation
/// link and the password-reset link. Every secret is stored hashed, expires and is used once.
/// </summary>
public interface IAccountEmailStore
{
    /// <summary>Sends a fresh login code, replacing any earlier one. Null when the account cannot sign in.</summary>
    Task<LoginChallenge?> IssueLoginCodeAsync(Guid accountId, CancellationToken cancellationToken = default);

    /// <summary>Replaces the code of a pending challenge; null when the challenge is no longer usable.</summary>
    Task<LoginChallenge?> ResendLoginCodeAsync(Guid challengeId, CancellationToken cancellationToken = default);

    /// <summary>The account of a matching, unexpired, unused code; five wrong attempts lock the challenge.</summary>
    Task<AccountEmailResult> VerifyLoginCodeAsync(Guid challengeId, string code, CancellationToken cancellationToken = default);

    /// <summary>Confirms the email and sets the first password from an activation link.</summary>
    Task<AccountEmailResult> ActivateAsync(string token, string newPassword, CancellationToken cancellationToken = default);

    /// <summary>Sends a reset link when a portal account has this email; silent otherwise.</summary>
    Task RequestPasswordResetAsync(string email, CancellationToken cancellationToken = default);

    /// <summary>Sets a new password from a reset link and ends every open session.</summary>
    Task<AccountEmailResult> ResetPasswordAsync(string token, string newPassword, CancellationToken cancellationToken = default);
}
