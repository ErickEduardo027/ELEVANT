using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity.CreateSession;

namespace Elevant.Application.Identity.RefreshSession;

public enum RefreshSessionFailure
{
    Invalid,
    AlreadyRotated,
    TokenUnavailable,
}

public sealed record RefreshSessionResult(SessionDetails? Session, RefreshSessionFailure? Failure)
{
    public bool IsSuccess => Session is not null;
}

/// <summary>
/// Exchanges a refresh token for a new access token and a new refresh token, re-checking the
/// account exactly as a login does: status, memberships, scopes and security stamp (ADR-0021).
/// The new access token keeps when the session began, the start of the refresh family
/// (<c>auth_time</c>, ADR-0046). No session has an absolute cap, not even a ramp account's on a
/// shared tablet: it ends at logout, when a replaced token is reused, after 30 days without use
/// or when one of these checks fails.
/// </summary>
public sealed class RefreshSessionHandler(
    IRefreshTokenStore refreshTokens,
    IActorContextResolver actorContextResolver,
    IAccessTokenIssuer accessTokenIssuer,
    TimeProvider timeProvider)
{
    public const int MaximumTokenLength = 128;

    public async Task<RefreshSessionResult> HandleAsync(string? refreshToken, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(refreshToken) || refreshToken.Length > MaximumTokenLength)
            return new(null, RefreshSessionFailure.Invalid);
        var rotation = await refreshTokens.RotateAsync(refreshToken, cancellationToken);
        if (!rotation.IsSuccess)
            return new(null, rotation.Failure == RefreshTokenFailure.AlreadyRotated
                ? RefreshSessionFailure.AlreadyRotated : RefreshSessionFailure.Invalid);

        var accountId = rotation.AccountId!.Value;
        var actor = await actorContextResolver.ResolveAsync(accountId, cancellationToken);
        if (!ActorContextValidator.IsValid(actor, accountId))
        {
            await refreshTokens.RevokeFamilyAsync(rotation.Token!.Value, cancellationToken);
            return new(null, RefreshSessionFailure.Invalid);
        }

        var accessToken = await accessTokenIssuer.IssueAsync(actor!, rotation.SessionStartedAt, cancellationToken);
        if (accessToken is null || string.IsNullOrWhiteSpace(accessToken.Value) ||
            accessToken.ExpiresAt <= timeProvider.GetUtcNow())
            return new(null, RefreshSessionFailure.TokenUnavailable);
        return new(new SessionDetails(actor!, accessToken, rotation.Token), null);
    }

    /// <summary>Logout: revokes every token of the session's family.</summary>
    public Task LogoutAsync(string? refreshToken, CancellationToken cancellationToken = default) =>
        string.IsNullOrWhiteSpace(refreshToken) || refreshToken.Length > MaximumTokenLength
            ? Task.CompletedTask
            : refreshTokens.RevokeFamilyAsync(refreshToken, cancellationToken);
}
