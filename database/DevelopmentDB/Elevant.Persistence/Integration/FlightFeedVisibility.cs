using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Operations;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Integration;

/// <summary>
/// Which airlines' proposals OCC's review of the flight feed shows (2-B, 2-N16, ADR-0033): those with a contract in force
/// at the station that day, and the charter candidates. An airline whose contract at the station is suspended or expired,
/// without another one in force that day, is hidden: its proposals appear nowhere and its import is refused. The review
/// (<see cref="EfOccFlightFeedStore"/>) and the map's flights (<see cref="EfOccMapFlightStore"/>) apply this one rule.
/// </summary>
internal static class FlightFeedVisibility
{
    /// <summary>
    /// The airlines with a contract in force at the station that day and those whose contract there is suspended or
    /// expired without another in force (2-N16). Everyone else is a charter candidate.
    /// </summary>
    public static async Task<(HashSet<long> Contracted, HashSet<long> NotInForce)> ClassifyAsync(ElevantDbContext context,
        long stationId, DateOnly date, CancellationToken cancellationToken)
    {
        var contracted = await ContractedAsync(context, stationId, date, cancellationToken);
        var notInForce = (await NotInForceAirlines(context, stationId).ToArrayAsync(cancellationToken))
            .Where(id => !contracted.Contains(id)).ToHashSet();
        return (contracted, notInForce);
    }

    /// <summary>Airlines with a suspended or expired contract whose versions cover the station.</summary>
    public static IQueryable<long> NotInForceAirlines(ElevantDbContext context, long stationId) =>
        (from contract in context.Contracts.AsNoTracking()
         where (contract.Status == ContractStatus.Suspended || contract.Status == ContractStatus.Expired) &&
               context.ContractVersions.Any(version => version.ContractId == contract.Id &&
                   context.Set<ContractVersionStation>().Any(link => link.ContractVersionId == version.Id &&
                       link.StationId == stationId))
         select contract.AirlineId).Distinct();

    /// <summary>The airlines that can fly as a charter (ADR-0033): active, with an active organization.</summary>
    public static IQueryable<long> CharterCandidates(ElevantDbContext context) =>
        from airline in context.Airlines.AsNoTracking()
        where airline.IsActive && context.Organizations.Any(organization => organization.Id == airline.OrganizationId &&
            organization.Status == OrganizationStatus.Active)
        select airline.Id;

    /// <summary>
    /// Whether the review shows an airline's proposals of one of <paramref name="dates"/> at the station: the airline has a
    /// contract in force there that day, or it is not hidden and it is a charter candidate. Every date the answer is asked
    /// about must be in <paramref name="dates"/>.
    /// </summary>
    public static async Task<Func<long, DateOnly, bool>> ShownAsync(ElevantDbContext context, long stationId,
        IReadOnlyCollection<DateOnly> dates, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(dates);
        var contracted = new Dictionary<DateOnly, HashSet<long>>();
        foreach (var date in dates.Distinct())
            contracted[date] = await ContractedAsync(context, stationId, date, cancellationToken);
        if (contracted.Count == 0) return static (_, _) => false;
        var notInForce = (await NotInForceAirlines(context, stationId).ToArrayAsync(cancellationToken)).ToHashSet();
        var candidates = (await CharterCandidates(context).ToArrayAsync(cancellationToken)).ToHashSet();
        return (airlineId, date) =>
        {
            if (!contracted.TryGetValue(date, out var withContract))
                throw new ArgumentOutOfRangeException(nameof(date), date, "The date was not read.");
            // Not contracted that day: shown as a charter candidate unless its contract at the station is not in force.
            return withContract.Contains(airlineId) || (!notInForce.Contains(airlineId) && candidates.Contains(airlineId));
        };
    }

    private static async Task<HashSet<long>> ContractedAsync(ElevantDbContext context, long stationId, DateOnly date,
        CancellationToken cancellationToken) =>
        (await ApplicableContracts.For(context, null, stationId, date).Select(row => row.AirlineId).Distinct()
            .ToArrayAsync(cancellationToken)).ToHashSet();
}
