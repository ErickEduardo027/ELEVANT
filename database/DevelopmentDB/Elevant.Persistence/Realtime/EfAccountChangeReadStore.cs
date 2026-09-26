using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Realtime;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Realtime;

/// <summary>Rechecks the actor and live station scope on every feed page.</summary>
internal sealed class EfAccountChangeReadStore(
    ElevantDbContext context,
    IActorContextResolver actors) : IAccountChangeReadStore
{
    public async Task<AccountChangePage?> ReadAsync(Guid accountId, long after, int limit,
        CancellationToken cancellationToken = default)
    {
        if (accountId == Guid.Empty || after < 0 || limit is < 1 or > 100)
            throw new ArgumentOutOfRangeException(nameof(limit));

        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        if (actor is null || actor.Roles.Count == 0 || actor.Memberships.Count == 0)
            return null;

        var accountInternalId = await context.Users.AsNoTracking()
            .Where(account => account.PublicId == accountId)
            .Select(account => account.Id)
            .SingleOrDefaultAsync(cancellationToken);
        if (accountInternalId <= 0)
            return null;

        var allowedStations = actor.StationScopes
            .Select(scope => scope.StationId)
            .ToArray();
        var rows = await context.AccountChanges.AsNoTracking()
            .Where(change => change.RecipientAccountId == accountInternalId &&
                change.Id > after &&
                (change.StationId == null || context.Stations.Any(station =>
                    station.Id == change.StationId &&
                    allowedStations.Contains(station.PublicId))))
            .OrderBy(change => change.Id)
            .Take(limit + 1)
            .Select(change => new AccountChangeData(
                change.PublicId, change.Id, change.Resource,
                change.ResourceId, change.OccurredAt))
            .ToArrayAsync(cancellationToken);
        return new AccountChangePage(rows.Take(limit).ToArray(), rows.Length > limit);
    }
}
