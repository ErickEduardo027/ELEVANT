using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

/// <summary>
/// Which accounts hold a current scope on every one of a set of stations: granted, not revoked and on
/// an active station, the same rule the actor resolver applies. A multi-station source (a contract
/// version) is only for whoever covers all its stations (1-N19).
/// </summary>
internal static class StationScopeCoverage
{
    public static async Task<long[]> CoveringAsync(ElevantDbContext context, IReadOnlyCollection<long> accountIds,
        IReadOnlyCollection<long> stationIds, DateTimeOffset at, CancellationToken cancellationToken)
    {
        var accounts = accountIds.Distinct().ToArray();
        var stations = stationIds.Distinct().ToArray();
        if (accounts.Length == 0 || stations.Length == 0) return [];
        var scopes = await (from scope in context.AccountStationScopes.AsNoTracking()
                            join station in context.Stations.AsNoTracking() on scope.StationId equals station.Id
                            where accounts.Contains(scope.AccountId) && stations.Contains(scope.StationId) &&
                                  scope.GrantedAt <= at && scope.RevokedAt == null && station.IsActive
                            select new { scope.AccountId, scope.StationId })
            .Distinct().ToArrayAsync(cancellationToken);
        return scopes.GroupBy(item => item.AccountId)
            .Where(group => group.Select(item => item.StationId).Distinct().Count() == stations.Length)
            .Select(group => group.Key).Order().ToArray();
    }
}
