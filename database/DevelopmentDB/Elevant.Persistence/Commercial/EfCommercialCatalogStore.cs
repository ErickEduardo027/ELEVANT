using Elevant.Application.Abstractions.Commercial;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

internal sealed class EfCommercialCatalogStore(ElevantDbContext context) : ICommercialCatalogStore
{
    public async Task<PublicCommercialCatalog> GetPublicAsync(
        CancellationToken cancellationToken = default)
    {
        var services = await context.ServiceDefinitions.AsNoTracking()
            .Where(PublicCommercialServiceVisibility.PublishedActive)
            .OrderBy(service => service.DisplayOrder).ThenBy(service => service.Name)
            .Select(service => new PublicServiceData(service.PublicId, service.Name,
                service.Description ?? string.Empty, service.ImageUrl, service.VideoUrl,
                service.DisplayOrder))
            .ToArrayAsync(cancellationToken);
        var airlines = await context.CommercialAirlineProfiles.AsNoTracking()
            .Where(profile => profile.IsPublished)
            .OrderBy(profile => profile.DisplayName)
            .Select(profile => new PublicAirlineData(profile.PublicId, profile.DisplayName,
                profile.Region, profile.LegalName, profile.CountryCode,
                profile.IataCode, profile.IcaoCode,
                profile.LogoObjectKey, profile.VerifiedAt != null))
            .ToArrayAsync(cancellationToken);
        return new PublicCommercialCatalog(services, airlines);
    }
}
