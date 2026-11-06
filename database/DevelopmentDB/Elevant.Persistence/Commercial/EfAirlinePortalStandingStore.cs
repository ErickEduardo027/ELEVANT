using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Commercial;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

/// <summary>
/// The airline's standing for its portal (2-N32, 2-N35), with the tenant applied in SQL. Historical
/// stations come from every version Finance approved (the scope its treasury already keeps), current ones
/// from the versions that govern today (2-C), and the pending reasons from the signatures and the permit
/// dossier, so a suspended or expired contract never shows as «0 estaciones» and a contract waiting for
/// its signatures never shows as «Borrador».
/// </summary>
internal sealed class EfAirlinePortalStandingStore(ElevantDbContext context) : IAirlinePortalStandingStore
{
    public async Task<AirlinePortalStandingData?> GetStandingAsync(Guid organizationId, DateOnly onDate,
        CancellationToken cancellationToken = default)
    {
        var airline = await (from organization in context.Organizations.AsNoTracking()
                             join candidate in context.Airlines.AsNoTracking() on organization.Id equals candidate.OrganizationId
                             where organization.PublicId == organizationId &&
                                   organization.Type == OrganizationType.AirlineCustomer &&
                                   organization.Status == OrganizationStatus.Active && candidate.IsActive
                             select new { candidate.Id, OrganizationId = organization.PublicId })
            .SingleOrDefaultAsync(cancellationToken);
        if (airline is null) return null;

        var history = await (from contract in context.Contracts.AsNoTracking()
                             join version in context.ContractVersions.AsNoTracking() on contract.Id equals version.ContractId
                             join link in context.Set<ContractVersionStation>().AsNoTracking()
                                 on version.Id equals link.ContractVersionId
                             join station in context.Stations.AsNoTracking() on link.StationId equals station.Id
                             where contract.AirlineId == airline.Id && station.IsActive &&
                                   (version.Status == ContractVersionStatus.Approved ||
                                    version.Status == ContractVersionStatus.Superseded)
                             select new { station.Id, station.PublicId, station.Code, station.Name, station.IanaTimeZone })
            .Distinct().ToArrayAsync(cancellationToken);
        // The same rule as the bootstrap: an active contract with a version that governs today (2-C).
        var current = await (from contract in context.Contracts.AsNoTracking()
                             join version in GoverningContractVersions.Of(context) on contract.Id equals version.ContractId
                             join link in context.Set<ContractVersionStation>().AsNoTracking()
                                 on version.Id equals link.ContractVersionId
                             where contract.AirlineId == airline.Id && contract.Status == ContractStatus.Active &&
                                   version.ValidFrom <= onDate && (version.ValidTo == null || version.ValidTo >= onDate)
                             select link.StationId).Distinct().ToArrayAsync(cancellationToken);

        // The contracts the portal lists: those with a version Finance approved.
        var contracts = await context.Contracts.AsNoTracking()
            .Where(contract => contract.AirlineId == airline.Id &&
                context.ContractVersions.Any(version => version.ContractId == contract.Id &&
                    (version.Status == ContractVersionStatus.Approved || version.Status == ContractVersionStatus.Superseded)))
            .OrderBy(contract => contract.ContractCode).ThenBy(contract => contract.Id)
            .Select(contract => new { contract.Id, contract.PublicId, contract.ContractCode, contract.Status })
            .ToArrayAsync(cancellationToken);
        var contractIds = contracts.Select(contract => contract.Id).ToArray();
        var awaiting = await GoverningContractVersions.AwaitingSignatures(context).AsNoTracking()
            .Where(version => contractIds.Contains(version.ContractId))
            .OrderBy(version => version.VersionNumber)
            .Select(version => new { version.ContractId, version.PublicId }).ToArrayAsync(cancellationToken);
        var usablePermit = await ContractActivation.HasUsablePermitAsync(context, airline.Id, onDate, cancellationToken);

        var stations = history.OrderBy(station => station.Code, StringComparer.Ordinal)
            .Select(station => new AirlinePortalStandingStationData(station.PublicId, station.Code, station.Name,
                station.IanaTimeZone, current.Contains(station.Id))).ToArray();
        var rows = contracts.Select(contract =>
        {
            var versions = awaiting.Where(version => version.ContractId == contract.Id).Select(version => version.PublicId).ToArray();
            return new AirlinePortalStandingContractData(contract.PublicId, contract.ContractCode, contract.Status.ToString(),
                AirlinePortalStandings.PendingReason(contract.Status, versions.Length > 0, usablePermit), versions);
        }).ToArray();
        return new AirlinePortalStandingData(airline.OrganizationId,
            AirlinePortalStandings.Overall(contracts.Select(contract => contract.Status).ToArray()),
            !stations.Any(station => station.Current), stations, rows);
    }
}
