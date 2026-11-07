using Elevant.Application.Abstractions.Integrations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.Persistence.Integration;

/// <summary>
/// What the simulated flight feed (2-B) reports at an airport: the time zone of its active station and the
/// active registered airlines, in a stable order so the same database always gives the same timetable.
/// Only read; the feed is a singleton, so each call opens its own scope.
/// </summary>
internal sealed class EfSimulatedFlightFeedCatalog(IServiceScopeFactory scopeFactory) : ISimulatedFlightFeedCatalog
{
    /// <summary>Most airlines one simulated answer carries.</summary>
    public const int MaxAirlines = 20;

    public async Task<SimulatedFeedScope?> FindAsync(string airportIataCode, CancellationToken cancellationToken = default)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var zone = await (from station in context.Stations.AsNoTracking()
                          join airport in context.Airports.AsNoTracking() on station.AirportId equals airport.Id
                          where station.IsActive && airport.IataCode == airportIataCode
                          select station.IanaTimeZone).SingleOrDefaultAsync(cancellationToken);
        if (zone is null) return null;
        var airlines = await context.Airlines.AsNoTracking().Where(airline => airline.IsActive)
            .OrderBy(airline => airline.IataCode ?? airline.IcaoCode).ThenBy(airline => airline.PublicId)
            .Take(MaxAirlines)
            .Select(airline => new { airline.Name, airline.IataCode, airline.IcaoCode })
            .ToArrayAsync(cancellationToken);
        return new SimulatedFeedScope(zone, airlines
            .Select(airline => new FeedAirline(airline.Name, airline.IataCode, airline.IcaoCode)).ToArray());
    }
}
