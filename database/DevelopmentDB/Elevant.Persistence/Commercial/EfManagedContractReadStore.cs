using Elevant.Application.Abstractions.Commercial;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

internal sealed class EfManagedContractReadStore(
    ElevantDbContext context, CommercialPermissionGuard permissions) : IManagedContractReadStore
{
    public async Task<ManagedContractPageData?> ListAsync(Guid actorId, int page, int limit,
        CancellationToken cancellationToken = default)
    {
        if (page < 1 || limit is < 1 or > 50 || (long)(page - 1) * limit > int.MaxValue)
            throw new ArgumentOutOfRangeException(nameof(page));
        if (!await permissions.HasAsync(actorId, "contracts.agreements.read", cancellationToken))
            return null;

        var rows = await (from contract in context.Contracts.AsNoTracking()
            join airline in context.Airlines.AsNoTracking() on contract.AirlineId equals airline.Id
            where context.ContractVersions.Any(version => version.ContractId == contract.Id &&
                (version.Status == ContractVersionStatus.Approved ||
                 version.Status == ContractVersionStatus.Superseded))
            orderby contract.ContractCode, contract.Id
            select new { contract.Id, contract.PublicId, contract.ContractCode,
                contract.Status, contract.SignedOn, contract.TerminatedOn,
                Airline = airline.Name, AirlineCode = airline.IataCode ?? airline.IcaoCode })
            .Skip((page - 1) * limit).Take(limit + 1).ToArrayAsync(cancellationToken);
        var selected = rows.Take(limit).ToArray();
        var contractIds = selected.Select(item => item.Id).ToArray();
        var versions = await context.ContractVersions.AsNoTracking()
            .Where(version => contractIds.Contains(version.ContractId) &&
                (version.Status == ContractVersionStatus.Approved ||
                 version.Status == ContractVersionStatus.Superseded))
            .OrderByDescending(version => version.VersionNumber)
            .Select(version => new { version.Id, version.PublicId, version.ContractId,
                version.VersionNumber, version.Status, version.ValidFrom, version.ValidTo,
                version.CurrencyCode, version.Terms })
            .ToArrayAsync(cancellationToken);
        var versionIds = versions.Select(version => version.Id).ToArray();
        var stations = await (from link in context.Set<ContractVersionStation>().AsNoTracking()
            join station in context.Stations.AsNoTracking() on link.StationId equals station.Id
            where versionIds.Contains(link.ContractVersionId)
            orderby station.Code
            select new { link.ContractVersionId, station.PublicId, station.Code, station.Name })
            .ToArrayAsync(cancellationToken);
        var rates = await (from rate in context.ContractServiceRates.AsNoTracking()
            join service in context.ServiceDefinitions.AsNoTracking()
                on rate.ServiceDefinitionId equals service.Id
            where versionIds.Contains(rate.ContractVersionId)
            orderby service.Code
            select new { rate.ContractVersionId, rate.PublicId, service.Code, service.Name,
                rate.BillingUnit, rate.UnitPrice, rate.MinimumQuantity })
            .ToArrayAsync(cancellationToken);

        return new ManagedContractPageData(page, limit, rows.Length > limit,
            selected.Select(contract => new ManagedContractData(
                contract.PublicId, contract.ContractCode, contract.Airline,
                contract.AirlineCode, contract.Status.ToString(), contract.SignedOn,
                contract.TerminatedOn,
                versions.Where(version => version.ContractId == contract.Id)
                    .Select(version => new ManagedContractVersionData(
                        version.PublicId, version.VersionNumber, version.Status.ToString(), version.ValidFrom,
                        version.ValidTo, version.CurrencyCode, version.Terms,
                        stations.Where(station => station.ContractVersionId == version.Id)
                            .Select(station => new ManagedContractStationData(
                                station.PublicId, station.Code, station.Name)).ToArray(),
                        rates.Where(rate => rate.ContractVersionId == version.Id)
                            .Select(rate => new ManagedContractRateData(rate.PublicId,
                                rate.Code, rate.Name, rate.BillingUnit,
                                rate.UnitPrice, rate.MinimumQuantity)).ToArray()))
                    .ToArray())).ToArray());
    }
}
