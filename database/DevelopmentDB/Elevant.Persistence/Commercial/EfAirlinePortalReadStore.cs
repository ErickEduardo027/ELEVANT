using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Commercial;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

/// <summary>Applies tenant and contract-station predicates in SQL for portal bootstrap.</summary>
internal sealed class EfAirlinePortalReadStore(ElevantDbContext context) : IAirlinePortalReadStore
{
    public async Task<AirlinePortalBootstrapData?> GetBootstrapAsync(
        Guid organizationId,
        DateOnly onDate,
        CancellationToken cancellationToken = default)
    {
        var airline = await (
            from organization in context.Organizations.AsNoTracking()
            join candidate in context.Airlines.AsNoTracking()
                on organization.Id equals candidate.OrganizationId
            where organization.PublicId == organizationId &&
                  organization.Type == OrganizationType.AirlineCustomer &&
                  organization.Status == OrganizationStatus.Active &&
                  candidate.IsActive
            select new
            {
                candidate.Id,
                candidate.PublicId,
                OrganizationId = organization.PublicId,
                candidate.IataCode,
                candidate.IcaoCode,
                candidate.Name,
            }).SingleOrDefaultAsync(cancellationToken);
        if (airline is null)
        {
            return null;
        }

        var stationRows = await (
            from contract in context.Contracts.AsNoTracking()
            join version in context.ContractVersions.AsNoTracking()
                on contract.Id equals version.ContractId
            join link in context.Set<ContractVersionStation>().AsNoTracking()
                on version.Id equals link.ContractVersionId
            join station in context.Stations.AsNoTracking()
                on link.StationId equals station.Id
            where contract.AirlineId == airline.Id &&
                  contract.Status == ContractStatus.Active &&
                  version.Status == ContractVersionStatus.Approved &&
                  version.ValidFrom <= onDate &&
                  (version.ValidTo == null || version.ValidTo >= onDate) &&
                  station.IsActive
            select new
            {
                station.PublicId,
                station.Code,
                station.Name,
                station.IanaTimeZone,
            })
            .Distinct()
            .OrderBy(station => station.Code)
            .ToArrayAsync(cancellationToken);

        return new AirlinePortalBootstrapData(
            airline.PublicId,
            airline.OrganizationId,
            airline.IataCode,
            airline.IcaoCode,
            airline.Name,
            stationRows.Select(station => new AirlinePortalStationData(
                station.PublicId,
                station.Code,
                station.Name,
                station.IanaTimeZone)).ToArray());
    }
}
