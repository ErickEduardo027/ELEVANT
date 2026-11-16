using Elevant.Application.Identity;

namespace Elevant.Application.Abstractions.Identity;

/// <summary>Issues a signed access token for a validated effective actor.</summary>
public interface IAccessTokenIssuer
{
    /// <summary>
    /// Returns a signed token, or <see langword="null"/> when a token cannot be issued safely.
    /// </summary>
    Task<IssuedAccessToken?> IssueAsync(
        ActorContext actor,
        CancellationToken cancellationToken = default);
}
