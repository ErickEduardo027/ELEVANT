using Elevant.Application.Identity;

namespace Elevant.Application.Abstractions.Identity;

/// <summary>Resolves the server-authoritative roles and scopes for an account.</summary>
public interface IActorContextResolver
{
    /// <summary>
    /// Returns an effective actor built from current server-side state, or
    /// <see langword="null"/> when the account is not currently authorized to act.
    /// </summary>
    Task<ActorContext?> ResolveAsync(
        Guid accountId,
        CancellationToken cancellationToken = default);
}
