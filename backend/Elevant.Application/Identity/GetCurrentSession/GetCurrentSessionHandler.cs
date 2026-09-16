using Elevant.Application.Abstractions.Identity;

namespace Elevant.Application.Identity.GetCurrentSession;

/// <summary>Re-resolves the authenticated actor so current server-side scope remains authoritative.</summary>
public sealed class GetCurrentSessionHandler(IActorContextResolver actorContextResolver)
{
    public async Task<GetCurrentSessionResult> HandleAsync(
        GetCurrentSessionQuery query,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);

        if (query.AccountId == Guid.Empty)
        {
            return GetCurrentSessionResult.InvalidSession();
        }

        var actor = await actorContextResolver.ResolveAsync(query.AccountId, cancellationToken);
        return ActorContextValidator.IsValid(actor, query.AccountId)
            ? GetCurrentSessionResult.Succeeded(actor!)
            : GetCurrentSessionResult.InvalidSession();
    }
}
