using Elevant.Application.Abstractions.Commercial;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
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
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var packageRows = await context.Set<ServicePackageVersion>().AsNoTracking()
            .Where(package => package.Status == TariffVersionStatus.Published &&
                package.ValidFrom <= today && (package.ValidTo == null || package.ValidTo >= today))
            .OrderBy(package => package.Name).Take(100)
            .Select(package => new { package.Id, package.PublicId, package.Code,
                package.Name, package.VersionNumber, package.CurrencyCode })
            .ToArrayAsync(cancellationToken);
        var packageIds = packageRows.Select(package => package.Id).ToArray();
        var componentRows = await (from component in context.Set<ServicePackageComponent>().AsNoTracking()
            join service in context.ServiceDefinitions.AsNoTracking()
                .Where(PublicCommercialServiceVisibility.PublishedActive)
                on component.ServiceDefinitionId equals service.Id
            where packageIds.Contains(component.PackageVersionId)
            orderby service.Code
            select new { component.PackageVersionId,
                Data = new PublicPackageComponentData(service.PublicId, service.Code,
                    service.Name, component.BillingUnit, component.IncludedQuantity) })
            .ToArrayAsync(cancellationToken);
        var componentCounts = await context.Set<ServicePackageComponent>().AsNoTracking()
            .Where(component => packageIds.Contains(component.PackageVersionId))
            .GroupBy(component => component.PackageVersionId)
            .Select(group => new { PackageVersionId = group.Key, Count = group.Count() })
            .ToDictionaryAsync(item => item.PackageVersionId, item => item.Count, cancellationToken);
        var packages = packageRows.Where(package =>
                componentCounts.GetValueOrDefault(package.Id) > 0 &&
                componentCounts[package.Id] == componentRows.Count(item => item.PackageVersionId == package.Id))
            .Select(package => new PublicPackageData(package.PublicId, package.Code,
                package.Name, package.VersionNumber, package.CurrencyCode,
                componentRows.Where(item => item.PackageVersionId == package.Id)
                    .Select(item => item.Data).ToArray())).ToArray();
        return new PublicCommercialCatalog(services, airlines, packages);
    }
}
