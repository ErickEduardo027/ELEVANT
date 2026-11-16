using Elevant.Application.Abstractions.Operations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>
/// The ICAO code of a station's airport (ADR-0043, contracts 1.4): the active station joined to its airport, read without
/// tracking. Nothing is written, and the columns it reads already exist.
/// </summary>
internal sealed class EfOccStationAirportStore(ElevantDbContext context) : IOccStationAirportStore
{
    public async Task<string?> FindIcaoCodeAsync(Guid stationId, CancellationToken cancellationToken = default)
    {
        var icaoCode = await (from station in context.Stations.AsNoTracking()
                              join airport in context.Airports.AsNoTracking() on station.AirportId equals airport.Id
                              where station.PublicId == stationId && station.IsActive
                              select airport.IcaoCode)
            .SingleOrDefaultAsync(cancellationToken);
        return icaoCode?.Trim().ToUpperInvariant();
    }
}
