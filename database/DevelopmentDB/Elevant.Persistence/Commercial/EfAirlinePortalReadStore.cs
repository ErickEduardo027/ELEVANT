using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Commercial;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Operations;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

/// <summary>Applies tenant and contract-station predicates in SQL for portal bootstrap.</summary>
internal sealed class EfAirlinePortalReadStore(ElevantDbContext context) : IAirlinePortalReadStore
{
    public async Task<AirlineOperationalRequestPageData?> GetRequestsAsync(
        Guid organizationId, int page, int limit,
        CancellationToken cancellationToken = default)
    {
        if (page is < 1 or > 10_000 || limit is < 1 or > 50)
            throw new ArgumentOutOfRangeException(nameof(page));

        var airlineId = await (
            from organization in context.Organizations.AsNoTracking()
            join airline in context.Airlines.AsNoTracking()
                on organization.Id equals airline.OrganizationId
            where organization.PublicId == organizationId &&
                  organization.Type == OrganizationType.AirlineCustomer &&
                  organization.Status == OrganizationStatus.Active && airline.IsActive
            select (long?)airline.Id).SingleOrDefaultAsync(cancellationToken);
        if (airlineId is null) return null;

        var rows = await (
            from request in context.Set<OperationalServiceRequest>().AsNoTracking()
            join station in context.Stations.AsNoTracking()
                on request.StationId equals station.Id
            where request.AirlineId == airlineId &&
                  (request.TurnaroundId == null || context.Turnarounds.Any(turnaround =>
                      turnaround.Id == request.TurnaroundId &&
                      turnaround.AirlineId == airlineId &&
                      turnaround.StationId == request.StationId))
            orderby request.RequestedAt descending, request.PublicId
            select new
            {
                request.PublicId, request.TurnaroundId,
                StationId = station.PublicId, StationCode = station.Code,
                request.RequestedServiceName, request.Description,
                request.Status, request.RequestedAt, request.NeededAt,
                request.ResolvedAt,
            }).Skip((page - 1) * limit).Take(limit + 1)
            .ToArrayAsync(cancellationToken);
        var selected = rows.Take(limit).ToArray();
        var turnaroundIds = selected.Where(row => row.TurnaroundId.HasValue)
            .Select(row => row.TurnaroundId!.Value).ToArray();
        var operations = await (
            from turnaround in context.Turnarounds.AsNoTracking()
            join operation in context.GroundOperations.AsNoTracking()
                on turnaround.Id equals operation.TurnaroundId
            where turnaroundIds.Contains(turnaround.Id)
            select new { TurnaroundId = turnaround.Id,
                OperationId = operation.PublicId, turnaround.OperationCode })
            .ToArrayAsync(cancellationToken);

        return new AirlineOperationalRequestPageData(
            selected.Select(row =>
            {
                var operation = operations.FirstOrDefault(item => item.TurnaroundId == row.TurnaroundId);
                return new AirlineOperationalRequestData(
                    row.PublicId, row.StationId, row.StationCode,
                    row.RequestedServiceName, row.Description,
                    row.Status.ToString(), row.RequestedAt, row.NeededAt,
                    operation?.OperationId, operation?.OperationCode,
                    row.ResolvedAt);
            }).ToArray(), rows.Length > limit);
    }

    public async Task<AirlinePortalOperationData?> GetOperationAsync(
        Guid organizationId, Guid operationId,
        CancellationToken cancellationToken = default)
    {
        var row = await (
            from organization in context.Organizations.AsNoTracking()
            join airline in context.Airlines.AsNoTracking()
                on organization.Id equals airline.OrganizationId
            join turnaround in context.Turnarounds.AsNoTracking()
                on airline.Id equals turnaround.AirlineId
            join operation in context.GroundOperations.AsNoTracking()
                on turnaround.Id equals operation.TurnaroundId
            join station in context.Stations.AsNoTracking()
                on turnaround.StationId equals station.Id
            where organization.PublicId == organizationId &&
                  organization.Type == OrganizationType.AirlineCustomer &&
                  organization.Status == OrganizationStatus.Active && airline.IsActive &&
                  operation.PublicId == operationId &&
                  (from contract in context.Contracts.AsNoTracking()
                   join version in context.ContractVersions.AsNoTracking()
                       on contract.Id equals version.ContractId
                   join link in context.Set<ContractVersionStation>().AsNoTracking()
                       on version.Id equals link.ContractVersionId
                   where contract.AirlineId == airline.Id &&
                         link.StationId == turnaround.StationId &&
                         (version.Status == ContractVersionStatus.Approved ||
                          version.Status == ContractVersionStatus.Superseded) &&
                         version.ValidFrom <= turnaround.OperationDate &&
                         (version.ValidTo == null || version.ValidTo >= turnaround.OperationDate)
                   select contract.Id).Any()
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
            }).SingleOrDefaultAsync(cancellationToken);
        if (row is null) return null;

        var legs = await context.FlightLegs.AsNoTracking()
            .Where(leg => leg.TurnaroundId == row.TurnaroundId)
            .Select(leg => new { leg.Direction, leg.FlightNumber })
            .ToArrayAsync(cancellationToken);
        return new AirlinePortalOperationData(row.PublicId, row.OperationCode,
            row.StationId, row.StationCode, row.OperationDate,
            row.CurrentStatus.ToString(),
            legs.FirstOrDefault(leg => leg.Direction == FlightDirection.Arrival)?.FlightNumber,
            legs.FirstOrDefault(leg => leg.Direction == FlightDirection.Departure)?.FlightNumber,
            row.PlannedStartAt, row.PlannedEndAt);
    }

    public async Task<AirlineApprovedOperationEvidenceData?> GetApprovedOperationEvidenceAsync(
        Guid organizationId, Guid operationId,
        CancellationToken cancellationToken = default)
    {
        if (organizationId == Guid.Empty || operationId == Guid.Empty) return null;
        var authorized = await (
            from organization in context.Organizations.AsNoTracking()
            join airline in context.Airlines.AsNoTracking()
                on organization.Id equals airline.OrganizationId
            join turnaround in context.Turnarounds.AsNoTracking()
                on airline.Id equals turnaround.AirlineId
            join operation in context.GroundOperations.AsNoTracking()
                on turnaround.Id equals operation.TurnaroundId
            where organization.PublicId == organizationId &&
                  organization.Type == OrganizationType.AirlineCustomer &&
                  organization.Status == OrganizationStatus.Active && airline.IsActive &&
                  operation.PublicId == operationId &&
                  (from contract in context.Contracts.AsNoTracking()
                   join version in context.ContractVersions.AsNoTracking()
                       on contract.Id equals version.ContractId
                   join link in context.Set<ContractVersionStation>().AsNoTracking()
                       on version.Id equals link.ContractVersionId
                   where contract.AirlineId == airline.Id &&
                         link.StationId == turnaround.StationId &&
                         (version.Status == ContractVersionStatus.Approved ||
                          version.Status == ContractVersionStatus.Superseded) &&
                         version.ValidFrom <= turnaround.OperationDate &&
                         (version.ValidTo == null || version.ValidTo >= turnaround.OperationDate)
                   select contract.Id).Any()
            select new
            {
                operation.Id,
                operation.CurrentStatus,
                operation.ActualStartAt,
                operation.ActualEndAt,
            }).SingleOrDefaultAsync(cancellationToken);
        if (authorized is null) return null;

        AirlineApprovedOperationEvidenceData Unavailable() => new(
            operationId, false, null, null, null, 0, []);
        if (authorized.CurrentStatus != GroundOperationStatus.Approved)
            return Unavailable();

        var approval = await (
            from submission in context.OperationSubmissions.AsNoTracking()
            join decision in context.ReviewDecisions.AsNoTracking()
                on submission.Id equals decision.OperationSubmissionId
            where submission.GroundOperationId == authorized.Id &&
                  submission.Status == SubmissionStatus.Approved &&
                  decision.Outcome == ReviewOutcome.Approved
            orderby submission.RevisionNumber descending
            select new { EvidenceJson = decision.ApprovedEvidenceJson ?? submission.EvidenceJson, decision.DecidedAt })
            .FirstOrDefaultAsync(cancellationToken);
        if (approval?.EvidenceJson is null) return Unavailable();

        var snapshot = OperationSubmissionEvidence.Parse(approval.EvidenceJson);
        return new AirlineApprovedOperationEvidenceData(
            operationId, true, approval.DecidedAt,
            authorized.ActualStartAt, authorized.ActualEndAt,
            snapshot.Incidents.Length,
            snapshot.Services.Select(service => new AirlineApprovedServiceData(
                service.Id, service.Code, service.Name, service.Status,
                service.ContractedQuantity, service.ExecutedQuantity,
                service.Unit)).ToArray());
    }

    public async Task<AirlineOperationPageData?> GetOperationsAsync(
        Guid organizationId, int page, int limit,
        CancellationToken cancellationToken = default)
    {
        if (page < 1 || limit is < 1 or > 50)
            throw new ArgumentOutOfRangeException(nameof(page));

        var airlineId = await (
            from organization in context.Organizations.AsNoTracking()
            join airline in context.Airlines.AsNoTracking()
                on organization.Id equals airline.OrganizationId
            where organization.PublicId == organizationId &&
                  organization.Type == OrganizationType.AirlineCustomer &&
                  organization.Status == OrganizationStatus.Active && airline.IsActive
            select (long?)airline.Id).SingleOrDefaultAsync(cancellationToken);
        if (airlineId is null) return null;

        var rows = await (
            from turnaround in context.Turnarounds.AsNoTracking()
            join operation in context.GroundOperations.AsNoTracking()
                on turnaround.Id equals operation.TurnaroundId
            join station in context.Stations.AsNoTracking()
                on turnaround.StationId equals station.Id
            where turnaround.AirlineId == airlineId &&
                  (from contract in context.Contracts.AsNoTracking()
                   join version in context.ContractVersions.AsNoTracking()
                       on contract.Id equals version.ContractId
                   join link in context.Set<ContractVersionStation>().AsNoTracking()
                       on version.Id equals link.ContractVersionId
                   where contract.AirlineId == airlineId &&
                         link.StationId == turnaround.StationId &&
                         (version.Status == ContractVersionStatus.Approved ||
                          version.Status == ContractVersionStatus.Superseded) &&
                         version.ValidFrom <= turnaround.OperationDate &&
                         (version.ValidTo == null || version.ValidTo >= turnaround.OperationDate)
                   select contract.Id).Any()
            orderby turnaround.OperationDate descending,
                turnaround.OperationCode, turnaround.PublicId
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
            .Skip((page - 1) * limit).Take(limit + 1)
            .ToArrayAsync(cancellationToken);
        var selected = rows.Take(limit).ToArray();
        var turnaroundIds = selected.Select(operation => operation.TurnaroundId).ToArray();
        var legs = await context.FlightLegs.AsNoTracking()
            .Where(leg => turnaroundIds.Contains(leg.TurnaroundId))
            .Select(leg => new { leg.TurnaroundId, leg.Direction, leg.FlightNumber })
            .ToArrayAsync(cancellationToken);

        return new AirlineOperationPageData(
            selected.Select(operation => new AirlinePortalOperationData(
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
                operation.PlannedEndAt)).ToArray(),
            rows.Length > limit);
    }

    public async Task<AirlineContractPageData?> GetContractsAsync(
        Guid organizationId, int page, int limit,
        CancellationToken cancellationToken = default)
    {
        if (page < 1 || limit is < 1 or > 50)
            throw new ArgumentOutOfRangeException(nameof(page));

        var airlineId = await (
            from organization in context.Organizations.AsNoTracking()
            join airline in context.Airlines.AsNoTracking()
                on organization.Id equals airline.OrganizationId
            where organization.PublicId == organizationId &&
                  organization.Type == OrganizationType.AirlineCustomer &&
                  organization.Status == OrganizationStatus.Active && airline.IsActive
            select (long?)airline.Id).SingleOrDefaultAsync(cancellationToken);
        if (airlineId is null) return null;

        var rows = await context.Contracts.AsNoTracking()
            .Where(contract => contract.AirlineId == airlineId &&
                context.ContractVersions.Any(version => version.ContractId == contract.Id &&
                    (version.Status == ContractVersionStatus.Approved ||
                     version.Status == ContractVersionStatus.Superseded)))
            .OrderBy(contract => contract.ContractCode).ThenBy(contract => contract.Id)
            .Skip((page - 1) * limit).Take(limit + 1)
            .Select(contract => new
            {
                contract.Id, contract.PublicId, contract.ContractCode,
                contract.Status, contract.SignedOn, contract.TerminatedOn,
            }).ToArrayAsync(cancellationToken);
        var selected = rows.Take(limit).ToArray();
        var contractIds = selected.Select(contract => contract.Id).ToArray();
        var versions = await context.ContractVersions.AsNoTracking()
            .Where(version => contractIds.Contains(version.ContractId) &&
                (version.Status == ContractVersionStatus.Approved ||
                 version.Status == ContractVersionStatus.Superseded))
            .OrderByDescending(version => version.VersionNumber)
            .Select(version => new
            {
                version.Id, version.PublicId, version.ContractId, version.VersionNumber,
                version.ValidFrom, version.ValidTo, version.CurrencyCode,
            }).ToArrayAsync(cancellationToken);
        var versionIds = versions.Select(version => version.Id).ToArray();
        var stations = await (
            from link in context.Set<ContractVersionStation>().AsNoTracking()
            join station in context.Stations.AsNoTracking()
                on link.StationId equals station.Id
            where versionIds.Contains(link.ContractVersionId)
            orderby station.Code
            select new
            {
                link.ContractVersionId, station.PublicId, station.Code, station.Name,
            }).ToArrayAsync(cancellationToken);
        var rates = await (
            from rate in context.ContractServiceRates.AsNoTracking()
            join service in context.ServiceDefinitions.AsNoTracking()
                on rate.ServiceDefinitionId equals service.Id
            where versionIds.Contains(rate.ContractVersionId)
            orderby service.Code
            select new
            {
                rate.ContractVersionId, rate.PublicId, service.Code, service.Name,
                rate.BillingUnit, rate.UnitPrice, rate.MinimumQuantity,
            }).ToArrayAsync(cancellationToken);

        return new AirlineContractPageData(
            selected.Select(contract => new AirlineContractData(
                contract.PublicId, contract.ContractCode, contract.Status.ToString(),
                contract.SignedOn, contract.TerminatedOn,
                versions.Where(version => version.ContractId == contract.Id)
                    .Select(version => new AirlineContractVersionData(
                        version.PublicId, version.VersionNumber, version.ValidFrom, version.ValidTo,
                        version.CurrencyCode,
                        stations.Where(station => station.ContractVersionId == version.Id)
                            .Select(station => new AirlineContractStationData(
                                station.PublicId, station.Code, station.Name)).ToArray(),
                        rates.Where(rate => rate.ContractVersionId == version.Id)
                            .Select(rate => new AirlineContractRateData(
                                rate.PublicId, rate.Code, rate.Name, rate.BillingUnit,
                                rate.UnitPrice, rate.MinimumQuantity)).ToArray()))
                    .ToArray())).ToArray(),
            rows.Length > limit);
    }

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

        // 2-C: the stations of the version that governs today; an approved version nobody signed covers none.
        var stationRows = await (
            from contract in context.Contracts.AsNoTracking()
            join version in GoverningContractVersions.Of(context)
                on contract.Id equals version.ContractId
            join link in context.Set<ContractVersionStation>().AsNoTracking()
                on version.Id equals link.ContractVersionId
            join station in context.Stations.AsNoTracking()
                on link.StationId equals station.Id
            where contract.AirlineId == airline.Id &&
                  contract.Status == ContractStatus.Active &&
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
            // An ICAO-only operator keeps the non-null field empty; the portal shows its ICAO code.
            airline.IataCode ?? string.Empty,
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
