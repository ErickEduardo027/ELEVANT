using Elevant.Application.Abstractions.Commercial;
using Elevant.Infrastructure.Persistence;
using Elevant.Infrastructure.Persistence.Seed;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

internal sealed class EfCommercialCatalogStore(ElevantDbContext context) : ICommercialCatalogStore
{
    public async Task<PublicCommercialCatalog> GetPublicAsync(
        CancellationToken cancellationToken = default)
    {
        var serviceRows = await context.ServiceDefinitions.AsNoTracking()
            .Where(PublicCommercialServiceVisibility.PublishedActive)
            .OrderBy(service => service.DisplayOrder).ThenBy(service => service.Name)
            .Select(service => new { service.Code, Data = new PublicServiceData(service.PublicId, service.Name,
                service.Description ?? string.Empty, service.ImageUrl, service.VideoUrl,
                service.DisplayOrder) })
            .ToArrayAsync(cancellationToken);
        var services = serviceRows.Select(row => row.Data with
        {
            ImageUrl = CommercialServiceMediaDefaults.Resolve(row.Code, row.Data.ImageUrl),
        }).ToArray();
        var airlineRows = await context.CommercialAirlineProfiles.AsNoTracking()
            .Where(profile => profile.IsPublished)
            .OrderBy(profile => profile.DisplayName)
            .Select(profile => new { profile.SourceName, Data = new PublicAirlineData(profile.PublicId, profile.DisplayName,
                profile.Region, profile.LegalName, profile.CountryCode,
                profile.IataCode, profile.IcaoCode,
                profile.LogoObjectKey, profile.VerifiedAt != null && profile.VerifiedByAccountId != null) })
            .ToArrayAsync(cancellationToken);
        var airlines = airlineRows.Select(row => row.Data with
        {
            LogoUrl = row.Data.LogoUrl ?? AviamAirlineReference.LogoPaths.GetValueOrDefault(row.SourceName),
        }).ToArray();
        return new PublicCommercialCatalog(services, airlines);
    }
}
