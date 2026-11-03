using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>«Contratos listos para operar» for OCC (ADR-0027), from <see cref="ApplicableContracts"/>.</summary>
internal sealed class EfOccReadyContractsStore(ElevantDbContext context, IActorContextResolver actors)
    : IOccReadyContractsStore
{
    public async Task<OccReadyContractsData?> ListAsync(Guid actorId, Guid stationId, DateOnly date,
        CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor is null || !actor.HasPermission("operations.planning.read") ||
            !actor.Memberships.Any(membership => membership.Kind == MembershipKind.InternalStaff &&
                membership.OrganizationType == OrganizationType.AviamOperator) ||
            !actor.StationScopes.Any(scope => scope.StationId == stationId))
            return null;
        var station = await context.Stations.AsNoTracking().Where(item => item.PublicId == stationId && item.IsActive)
            .Select(item => new { item.Id, item.Code }).SingleOrDefaultAsync(cancellationToken);
        if (station is null) return null;

        var rows = await (from row in ApplicableContracts.For(context, null, station.Id, date)
                          join airline in context.Airlines.AsNoTracking() on row.AirlineId equals airline.Id
                          join version in context.ContractVersions.AsNoTracking() on row.VersionId equals version.Id
                          where airline.IsActive
                          select new { Row = row, airline.PublicId, airline.Name, airline.IataCode, version.RenewalMode })
            .ToArrayAsync(cancellationToken);
        var versionIds = rows.Select(item => item.Row.VersionId).ToArray();
        var services = (await (from rate in context.ContractServiceRates.AsNoTracking()
                               join service in context.ServiceDefinitions.AsNoTracking() on rate.ServiceDefinitionId equals service.Id
                               where versionIds.Contains(rate.ContractVersionId) && service.IsActive
                               orderby service.Code
                               select new { rate.ContractVersionId, service.Code, service.Name, rate.BillingUnit })
                .ToArrayAsync(cancellationToken))
            .ToLookup(item => item.ContractVersionId);
        var airlineIds = rows.Select(item => item.Row.AirlineId).Distinct().ToArray();
        var flights = (await context.Turnarounds.AsNoTracking()
                .Where(item => item.StationId == station.Id && item.OperationDate == date && airlineIds.Contains(item.AirlineId) &&
                    item.CurrentStatus != TurnaroundStatus.Cancelled)
                .Select(item => item.AirlineId).ToArrayAsync(cancellationToken))
            .GroupBy(id => id).ToDictionary(group => group.Key, group => group.Count());

        // An airline with two versions covering the same date is a data conflict; OCC sees neither.
        var contracts = rows.GroupBy(item => item.Row.AirlineId).Where(group => group.Count() == 1).Select(group => group.Single())
            .OrderBy(item => item.Name)
            .Select(item => new OccReadyContractData(item.Row.ContractPublicId, item.Row.ContractCode, item.PublicId, item.Name,
                item.IataCode, item.Row.VersionPublicId, item.Row.VersionNumber, item.Row.ValidFrom, item.Row.ValidTo,
                item.RenewalMode?.ToString(),
                services[item.Row.VersionId].Select(service => new OccReadyContractService(service.Code, service.Name,
                    service.BillingUnit)).ToArray(),
                flights.GetValueOrDefault(item.Row.AirlineId)))
            .ToArray();
        return new OccReadyContractsData(stationId, station.Code, date, contracts);
    }
}
