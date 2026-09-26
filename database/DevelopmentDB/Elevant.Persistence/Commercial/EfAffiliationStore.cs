using Elevant.Application.Abstractions.Commercial;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

/// <summary>Returns active catalog choices without commercial or tenant data.</summary>
internal sealed class EfAffiliationStore(ElevantDbContext context) : IAffiliationStore
{
    public async Task<AffiliationOptionsData> GetOptionsAsync(
        CancellationToken cancellationToken = default)
    {
        var stations = await context.Stations.AsNoTracking()
            .Where(station => station.IsActive)
            .OrderBy(station => station.Code)
            .Take(50)
            .Select(station => new AffiliationStationOptionData(
                station.PublicId, station.Code, station.Name))
            .ToArrayAsync(cancellationToken);

        var services = await context.ServiceDefinitions.AsNoTracking()
            .Where(service => service.IsActive)
            .OrderBy(service => service.Code)
            .Take(100)
            .Select(service => new AffiliationServiceOptionData(
                service.PublicId, service.Code, service.Name,
                service.DefaultBillingUnit))
            .ToArrayAsync(cancellationToken);

        return new AffiliationOptionsData(stations, services);
    }
}
