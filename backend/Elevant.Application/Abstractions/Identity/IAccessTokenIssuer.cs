using Elevant.Application.Identity;

namespace Elevant.Application.Abstractions.Identity;

/// <summary>Issues a signed access token for a validated effective actor.</summary>
public interface IAccessTokenIssuer
{
    /// <summary>
    /// Returns a signed token that starts a session (a sign-in), or <see langword="null"/> when a token cannot be issued
    /// safely.
    /// </summary>
    Task<IssuedAccessToken?> IssueAsync(
        ActorContext actor,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Returns a signed token of a session that began at <paramref name="sessionStartedAt"/>: a renewal keeps the
    /// start of its sign-in (<c>auth_time</c>, ADR-0046). Null starts the session now. An issuer that does not record
    /// the session start issues the token as for a sign-in.
    /// </summary>
    Task<IssuedAccessToken?> IssueAsync(
        ActorContext actor,
        DateTimeOffset? sessionStartedAt,
        CancellationToken cancellationToken = default) =>
        IssueAsync(actor, cancellationToken);
}
