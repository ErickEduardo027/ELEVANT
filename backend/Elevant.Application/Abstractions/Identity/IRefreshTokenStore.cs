namespace Elevant.Application.Abstractions.Identity;

/// <summary>A newly issued refresh token; <see cref="Value"/> is shown once and never stored.</summary>
public sealed record IssuedRefreshToken(string Value, DateTimeOffset IdleExpiresAt)
{
    public override string ToString() => $"{nameof(IssuedRefreshToken)} {{ Value = [REDACTED] }}";
}

public enum RefreshTokenFailure
{
    /// <summary>Unknown, revoked, expired by inactivity, or the security stamp changed.</summary>
    Invalid,

    /// <summary>
    /// Another tab rotated this token a moment ago: not an attack. The caller re-reads its
    /// storage instead of logging out.
    /// </summary>
    AlreadyRotated,
}

/// <summary>
/// Outcome of a rotation. <paramref name="SessionStartedAt"/> is when the token's family began: the sign-in that every
/// renewal of the session keeps (<c>auth_time</c>, ADR-0046); null when the rotation failed.
/// </summary>
public sealed record RefreshTokenRotation(Guid? AccountId, IssuedRefreshToken? Token, RefreshTokenFailure? Failure,
    DateTimeOffset? SessionStartedAt = null)
{
    public bool IsSuccess => Failure is null;

    public override string ToString() => $"{nameof(RefreshTokenRotation)} {{ Failure = {Failure} }}";
}

/// <summary>Rotating refresh tokens that keep an internal session alive until logout (ADR-0021).</summary>
public interface IRefreshTokenStore
{
    /// <summary>Starts a new family for a login.</summary>
    Task<IssuedRefreshToken?> IssueAsync(Guid accountId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Replaces the presented token with a new one of the same family and reports when the family
    /// began. A replaced token presented again (outside a short grace window) revokes the family.
    /// </summary>
    Task<RefreshTokenRotation> RotateAsync(string token, CancellationToken cancellationToken = default);

    /// <summary>Revokes the family of the token (logout). Unknown tokens are ignored.</summary>
    Task RevokeFamilyAsync(string token, CancellationToken cancellationToken = default);
}
