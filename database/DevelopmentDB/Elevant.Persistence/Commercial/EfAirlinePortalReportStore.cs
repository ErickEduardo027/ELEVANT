using System.Text.Json;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Operations;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

/// <summary>
/// The reads of the airline portal's reports (ADR-0048, «Reportes nuevos»). The tenant (the airline of the
/// organization) and the stations a contract approved for it covered on the operation's date are enforced in SQL, as
/// <see cref="EfAirlinePortalReadStore"/> does for the operations of the portal.
/// </summary>
internal sealed class EfAirlinePortalReportStore(ElevantDbContext context) : IAirlinePortalReportStore
{
    private Task<AirlineKey?> AirlineAsync(Guid organizationId, CancellationToken cancellationToken) =>
        (from organization in context.Organizations.AsNoTracking()
         join airline in context.Airlines.AsNoTracking() on organization.Id equals airline.OrganizationId
         where organization.PublicId == organizationId && organization.Type == OrganizationType.AirlineCustomer &&
               organization.Status == OrganizationStatus.Active && airline.IsActive
         select new AirlineKey(airline.Id, airline.Name)).SingleOrDefaultAsync(cancellationToken);

    private sealed record AirlineKey(long Id, string Name);

    public async Task<AirlinePortalReportProfile?> ProfileAsync(Guid organizationId,
        CancellationToken cancellationToken = default)
    {
        if (organizationId == Guid.Empty) return null;
        var airline = await AirlineAsync(organizationId, cancellationToken);
        if (airline is null) return null;
        var stations = await (from contract in context.Contracts.AsNoTracking()
                              join version in context.ContractVersions.AsNoTracking() on contract.Id equals version.ContractId
                              join link in context.Set<ContractVersionStation>().AsNoTracking()
                                  on version.Id equals link.ContractVersionId
                              join station in context.Stations.AsNoTracking() on link.StationId equals station.Id
                              where contract.AirlineId == airline.Id &&
                                    (version.Status == ContractVersionStatus.Approved ||
                                     version.Status == ContractVersionStatus.Superseded)
                              select new { station.PublicId, station.Code, station.Name })
            .Distinct().ToArrayAsync(cancellationToken);
        return new AirlinePortalReportProfile(airline.Name, stations.OrderBy(station => station.Code, StringComparer.Ordinal)
            .Select(station => new AirlinePortalReportStation(station.PublicId, station.Code, station.Name)).ToArray())
        {
            AirlineId = await context.Airlines.AsNoTracking().Where(item => item.Id == airline.Id).Select(item => item.PublicId)
                .SingleAsync(cancellationToken),
        };
    }

    public async Task<AirlineCustomerData?> CustomerAsync(Guid airlineId, CancellationToken cancellationToken = default)
    {
        var row = await (from airline in context.Airlines.AsNoTracking()
                         join organization in context.Organizations.AsNoTracking() on airline.OrganizationId equals organization.Id
                         where airline.PublicId == airlineId
                         select new { airline.Name, airline.IataCode, airline.IcaoCode, organization.TaxRegistration,
                             organization.TaxRegistrationCountryCode })
            .SingleOrDefaultAsync(cancellationToken);
        return row is null ? null : new AirlineCustomerData(row.Name, row.IataCode ?? row.IcaoCode,
            row.TaxRegistration is { Length: > 0 } number
                ? Elevant.Domain.Validation.TaxRegistrations.Display(number, row.TaxRegistrationCountryCode ?? "DO") : null);
    }

    public async Task<IReadOnlyList<AirlinePortalReportOperation>?> OperationsAsync(Guid organizationId, DateOnly start,
        DateOnly end, Guid? stationId, GroundOperationStatus? status, CancellationToken cancellationToken = default)
    {
        if (organizationId == Guid.Empty || end < start) return null;
        var airline = await AirlineAsync(organizationId, cancellationToken);
        if (airline is null) return null;
        var airlineId = airline.Id;
        var rows = await (
            from turnaround in context.Turnarounds.AsNoTracking()
            join operation in context.GroundOperations.AsNoTracking() on turnaround.Id equals operation.TurnaroundId
            join station in context.Stations.AsNoTracking() on turnaround.StationId equals station.Id
            where turnaround.AirlineId == airlineId &&
                  turnaround.OperationDate >= start && turnaround.OperationDate <= end &&
                  (stationId == null || station.PublicId == stationId) &&
                  (status == null || operation.CurrentStatus == status) &&
                  (from contract in context.Contracts.AsNoTracking()
                   join version in context.ContractVersions.AsNoTracking() on contract.Id equals version.ContractId
                   join link in context.Set<ContractVersionStation>().AsNoTracking() on version.Id equals link.ContractVersionId
                   where contract.AirlineId == airlineId && link.StationId == turnaround.StationId &&
                         (version.Status == ContractVersionStatus.Approved || version.Status == ContractVersionStatus.Superseded) &&
                         version.ValidFrom <= turnaround.OperationDate &&
                         (version.ValidTo == null || version.ValidTo >= turnaround.OperationDate)
                   select contract.Id).Any()
            orderby turnaround.OperationDate, turnaround.OperationCode, operation.Id
            select new
            {
                TurnaroundId = turnaround.Id, OperationId = operation.Id, turnaround.OperationDate, turnaround.OperationCode,
                StationCode = station.Code, operation.CurrentStatus,
            }).Take(25_001).ToArrayAsync(cancellationToken);
        var turnaroundIds = rows.Select(row => row.TurnaroundId).ToArray();
        var legs = (await context.FlightLegs.AsNoTracking().Where(leg => turnaroundIds.Contains(leg.TurnaroundId))
                .Select(leg => new { leg.TurnaroundId, leg.Direction, leg.FlightNumber }).ToArrayAsync(cancellationToken))
            .ToLookup(leg => leg.TurnaroundId);
        var approvedIds = rows.Where(row => row.CurrentStatus == GroundOperationStatus.Approved)
            .Select(row => row.OperationId).ToArray();
        var approvals = (await (from submission in context.OperationSubmissions.AsNoTracking()
                                join decision in context.ReviewDecisions.AsNoTracking()
                                    on submission.Id equals decision.OperationSubmissionId
                                where approvedIds.Contains(submission.GroundOperationId) &&
                                      submission.Status == SubmissionStatus.Approved &&
                                      decision.Outcome == ReviewOutcome.Approved
                                select new
                                {
                                    submission.GroundOperationId, submission.RevisionNumber,
                                    EvidenceJson = decision.ApprovedEvidenceJson ?? submission.EvidenceJson, decision.DecidedAt,
                                }).ToArrayAsync(cancellationToken))
            .GroupBy(item => item.GroundOperationId)
            .ToDictionary(group => group.Key, group => group.OrderByDescending(item => item.RevisionNumber).First());
        return rows.Select(row =>
        {
            var own = legs[row.TurnaroundId].ToArray();
            IReadOnlyList<AirlinePortalReportService> services = [];
            DateTimeOffset? approvedAt = null;
            if (approvals.TryGetValue(row.OperationId, out var approval) && approval.EvidenceJson is not null)
            {
                approvedAt = approval.DecidedAt;
                try
                {
                    services = OperationSubmissionEvidence.Parse(approval.EvidenceJson).Services
                        .Select(service => new AirlinePortalReportService(service.Code, service.Name, service.Status,
                            service.ExecutedQuantity, service.Unit))
                        .ToArray();
                }
                catch (JsonException) { }
                catch (InvalidOperationException) { }
            }
            return new AirlinePortalReportOperation(row.OperationDate, row.OperationCode,
                own.FirstOrDefault(leg => leg.Direction == FlightDirection.Arrival)?.FlightNumber,
                own.FirstOrDefault(leg => leg.Direction == FlightDirection.Departure)?.FlightNumber,
                row.StationCode, row.CurrentStatus, approvedAt, services);
        }).ToArray();
    }
}
