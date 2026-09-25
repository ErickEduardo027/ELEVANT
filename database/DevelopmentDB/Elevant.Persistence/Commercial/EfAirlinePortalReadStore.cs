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
                station.Id,
                station.PublicId,
                station.Code,
                station.Name,
                station.IanaTimeZone,
            })
            .Distinct()
            .OrderBy(station => station.Code)
            .ToArrayAsync(cancellationToken);

        // This is a current-operations preview, not a historical-access policy.
        // Both the tenant and currently contracted stations are enforced in SQL.
        var stationIds = stationRows.Select(station => station.Id).ToArray();
        var throughDate = onDate.AddDays(7);
        var operations = await (
                from turnaround in context.Turnarounds.AsNoTracking()
                join operation in context.GroundOperations.AsNoTracking()
                    on turnaround.Id equals operation.TurnaroundId
                join station in context.Stations.AsNoTracking()
                    on turnaround.StationId equals station.Id
                where turnaround.AirlineId == airline.Id &&
                      stationIds.Contains(turnaround.StationId) &&
                      turnaround.OperationDate >= onDate &&
                      turnaround.OperationDate <= throughDate
                orderby turnaround.OperationDate, turnaround.OperationCode, turnaround.PublicId
                select new
                {
                    TurnaroundId = turnaround.Id,
                    operation.PublicId,
                    turnaround.OperationCode,
                    StationId = station.PublicId,
                    StationCode = station.Code,
                    turnaround.OperationDate,
                    operation.CurrentStatus,
                    operation.PlannedStartAt,
                    operation.PlannedEndAt,
                })
                .Take(50)
                .ToArrayAsync(cancellationToken);

        var turnaroundIds = operations.Select(operation => operation.TurnaroundId).ToArray();
        var legs = await context.FlightLegs.AsNoTracking()
                .Where(leg => turnaroundIds.Contains(leg.TurnaroundId))
                .Select(leg => new { leg.TurnaroundId, leg.Direction, leg.FlightNumber })
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
                station.IanaTimeZone)).ToArray(),
            operations.Select(operation => new AirlinePortalOperationData(
                operation.PublicId,
                operation.OperationCode,
                operation.StationId,
                operation.StationCode,
                operation.OperationDate,
                operation.CurrentStatus.ToString(),
                legs.FirstOrDefault(leg => leg.TurnaroundId == operation.TurnaroundId &&
                    leg.Direction == FlightDirection.Arrival)?.FlightNumber,
                legs.FirstOrDefault(leg => leg.TurnaroundId == operation.TurnaroundId &&
                    leg.Direction == FlightDirection.Departure)?.FlightNumber,
                operation.PlannedStartAt,
                operation.PlannedEndAt)).ToArray());
    }
}
