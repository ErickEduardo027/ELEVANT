using System.Data;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>
/// Builds the ramp agent's read-only work queue from the authenticated account profile.
/// Every assignment and station boundary is enforced by the database query.
/// </summary>
internal sealed class EfRampOperationsReadStore(ElevantDbContext context)
    : IRampOperationsReadStore
{
    private const int MaximumOperations = 100;

    public async Task<RampOperationsReadResult> GetActiveAssignedOperationsAsync(
        Guid accountId,
        IReadOnlyCollection<Guid> allowedStationIds,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(allowedStationIds);

        var stationIds = allowedStationIds
            .Where(id => id != Guid.Empty)
            .Distinct()
            .ToArray();
        if (stationIds.Length == 0)
        {
            return RampOperationsReadResult.Success([]);
        }

        var strategy = context.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync(
                IsolationLevel.Serializable,
                cancellationToken);
            var result = await GetActiveAssignedOperationsInsideTransactionAsync(
                accountId,
                stationIds,
                cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return result;
        });
    }

    private async Task<RampOperationsReadResult> GetActiveAssignedOperationsInsideTransactionAsync(
        Guid accountId,
        Guid[] stationIds,
        CancellationToken cancellationToken)
    {

        var agentProfiles = await (
                from account in context.Users.AsNoTracking()
                join agent in context.RampAgents.AsNoTracking()
                    on account.PersonId equals agent.PersonId
                where account.PublicId == accountId && agent.IsActive
                select new
                {
                    agent.Id,
                    agent.PublicId,
                })
            .Take(2)
            .ToArrayAsync(cancellationToken);
        if (agentProfiles.Length != 1)
        {
            return RampOperationsReadResult.Failed(
                RampOperationsReadFailure.AgentProfileUnavailable);
        }

        var agentProfile = agentProfiles[0];
        var operations = await (
                from assignment in context.OperationAgentAssignments.AsNoTracking()
                join operation in context.GroundOperations.AsNoTracking()
                    on assignment.GroundOperationId equals operation.Id
                join turnaround in context.Turnarounds.AsNoTracking()
                    on operation.TurnaroundId equals turnaround.Id
                join station in context.Stations.AsNoTracking()
                    on turnaround.StationId equals station.Id
                join airline in context.Airlines.AsNoTracking()
                    on turnaround.AirlineId equals airline.Id
                join aircraftCandidate in context.AircraftTypes.AsNoTracking()
                    on turnaround.AircraftTypeId equals aircraftCandidate.Id into aircraftTypes
                from aircraft in aircraftTypes.DefaultIfEmpty()
                join positionCandidate in context.OperationalPositions.AsNoTracking()
                    on assignment.OperationalPositionId equals positionCandidate.Id into positions
                from position in positions.DefaultIfEmpty()
                where assignment.RampAgentId == agentProfile.Id &&
                      assignment.ReleasedAt == null &&
                      station.IsActive &&
                      stationIds.Contains(station.PublicId) &&
                      context.Set<RampAgentStationScope>().AsNoTracking().Any(scope =>
                          scope.RampAgentId == agentProfile.Id &&
                          scope.StationId == station.Id &&
                          scope.ValidFrom <= turnaround.OperationDate &&
                          (scope.ValidTo == null ||
                           scope.ValidTo >= turnaround.OperationDate)) &&
                      context.Set<StandAssignment>().AsNoTracking()
                          .Where(standAssignment =>
                              standAssignment.TurnaroundId == turnaround.Id &&
                              standAssignment.AssignedTo == null)
                          .All(standAssignment => context.Stands.AsNoTracking().Any(stand =>
                              stand.Id == standAssignment.StandId &&
                              stand.IsActive &&
                              stand.StationId == station.Id &&
                              (stand.TerminalId == null ||
                               context.Terminals.AsNoTracking().Any(terminal =>
                                   terminal.Id == stand.TerminalId &&
                                   terminal.IsActive &&
                                   terminal.StationId == station.Id &&
                                   context.Set<RampAgentTerminalScope>()
                                       .AsNoTracking()
                                       .Any(scope =>
                                           scope.RampAgentId == agentProfile.Id &&
                                           scope.TerminalId == terminal.Id &&
                                           scope.ValidFrom <= turnaround.OperationDate &&
                                           (scope.ValidTo == null ||
                                            scope.ValidTo >= turnaround.OperationDate))))))
                orderby operation.PlannedStartAt == null,
                    operation.PlannedStartAt,
                    turnaround.OperationDate,
                    turnaround.OperationCode,
                    turnaround.PublicId
                select new
                {
                    Assignment = new RampAgentAssignmentData(
                        assignment.PublicId,
                        agentProfile.PublicId,
                        position == null
                            ? null
                            : new RampOperationalPositionData(
                                position.PublicId,
                                position.Code,
                                position.Name),
                        assignment.AssignmentRole,
                        assignment.AssignedAt),
                    OperationInternalId = operation.Id,
                    Operation = new RampGroundOperationData(
                        operation.PublicId,
                        operation.CurrentStatus.ToString(),
                        operation.PlannedStartAt,
                        operation.PlannedEndAt,
                        operation.ActualStartAt,
                        operation.ActualEndAt),
                    TurnaroundInternalId = turnaround.Id,
                    turnaround.PublicId,
                    turnaround.OperationCode,
                    turnaround.OperationDate,
                    TurnaroundStatus = turnaround.CurrentStatus,
                    Station = new RampStationData(
                        station.PublicId,
                        station.Code,
                        station.Name,
                        station.IanaTimeZone),
                    Airline = new RampAirlineData(
                        airline.PublicId,
                        airline.IataCode,
                        airline.IcaoCode,
                        airline.Name),
                    Aircraft = aircraft == null
                        ? null
                        : new RampAircraftData(
                            aircraft.PublicId,
                            aircraft.IcaoCode,
                            aircraft.IataCode,
                            aircraft.Manufacturer,
                            aircraft.Model,
                            turnaround.AircraftRegistration),
                })
            .Take(MaximumOperations)
            .ToArrayAsync(cancellationToken);
        if (operations.Length == 0)
        {
            return RampOperationsReadResult.Success([]);
        }

        var turnaroundIds = operations
            .Select(item => item.TurnaroundInternalId)
            .Distinct()
            .ToArray();
        var operationIds = operations
            .Select(item => item.OperationInternalId)
            .Distinct()
            .ToArray();

        var stands = await (
                from assignment in context.Set<StandAssignment>().AsNoTracking()
                join turnaround in context.Turnarounds.AsNoTracking()
                    on assignment.TurnaroundId equals turnaround.Id
                join station in context.Stations.AsNoTracking()
                    on turnaround.StationId equals station.Id
                join stand in context.Stands.AsNoTracking()
                    on assignment.StandId equals stand.Id
                join terminalCandidate in context.Terminals.AsNoTracking()
                    on stand.TerminalId equals terminalCandidate.Id into terminals
                from terminal in terminals.DefaultIfEmpty()
                where turnaroundIds.Contains(assignment.TurnaroundId) &&
                      assignment.AssignedTo == null &&
                      station.IsActive &&
                      stationIds.Contains(station.PublicId) &&
                      stand.IsActive &&
                      stand.StationId == station.Id &&
                      (terminal == null ||
                       (terminal.IsActive && terminal.StationId == station.Id))
                select new
                {
                    assignment.TurnaroundId,
                    Stand = new RampStandData(
                        stand.PublicId,
                        stand.Code,
                        terminal == null
                            ? null
                            : new RampTerminalData(
                                terminal.PublicId,
                                terminal.Code,
                                terminal.Name)),
                })
            .ToDictionaryAsync(
                item => item.TurnaroundId,
                item => item.Stand,
                cancellationToken);

        var legs = await (
                from leg in context.FlightLegs.AsNoTracking()
                join origin in context.Airports.AsNoTracking()
                    on leg.OriginAirportId equals origin.Id
                join destination in context.Airports.AsNoTracking()
                    on leg.DestinationAirportId equals destination.Id
                where turnaroundIds.Contains(leg.TurnaroundId)
                orderby leg.ScheduledAt, leg.PublicId
                select new FlightLegProjection(
                    leg.TurnaroundId,
                    leg.Direction,
                    new RampFlightLegData(
                        leg.PublicId,
                        leg.FlightNumber,
                        new RampAirportData(
                            origin.PublicId,
                            origin.IataCode,
                            origin.IcaoCode,
                            origin.Name),
                        new RampAirportData(
                            destination.PublicId,
                            destination.IataCode,
                            destination.IcaoCode,
                            destination.Name),
                        leg.ScheduledAt,
                        leg.EstimatedAt,
                        leg.ActualAt)))
            .ToArrayAsync(cancellationToken);

        var services = await (
                from service in context.OperationServices.AsNoTracking()
                join definition in context.ServiceDefinitions.AsNoTracking()
                    on service.ServiceDefinitionId equals definition.Id
                where operationIds.Contains(service.GroundOperationId)
                orderby service.LineNumber, service.PublicId
                select new OperationServiceProjection(
                    service.GroundOperationId,
                    new RampOperationServiceData(
                        service.PublicId,
                        service.LineNumber,
                        definition.PublicId,
                        definition.Code,
                        definition.Name,
                        service.ContractedQuantity,
                        service.ExecutedQuantity,
                        service.BillingUnitSnapshot,
                        service.CurrentStatus.ToString())))
            .ToArrayAsync(cancellationToken);

        var legsByTurnaround = legs.ToLookup(item => item.TurnaroundId);
        var servicesByOperation = services.ToLookup(
            item => item.GroundOperationId,
            item => item.Service);
        var result = operations.Select(item =>
        {
            var turnaroundLegs = legsByTurnaround[item.TurnaroundInternalId];
            return new RampAssignedOperationData(
                item.Assignment,
                item.Operation,
                new RampTurnaroundData(
                    item.PublicId,
                    item.OperationCode,
                    item.OperationDate,
                    item.TurnaroundStatus.ToString(),
                    item.Station,
                    item.Airline,
                    item.Aircraft,
                    stands.GetValueOrDefault(item.TurnaroundInternalId),
                    turnaroundLegs.SingleOrDefault(
                        leg => leg.Direction == FlightDirection.Arrival)?.Leg,
                    turnaroundLegs.SingleOrDefault(
                        leg => leg.Direction == FlightDirection.Departure)?.Leg),
                servicesByOperation[item.OperationInternalId].ToArray());
        }).ToArray();

        return RampOperationsReadResult.Success(result);
    }

    private sealed record FlightLegProjection(
        long TurnaroundId,
        FlightDirection Direction,
        RampFlightLegData Leg);

    private sealed record OperationServiceProjection(
        long GroundOperationId,
        RampOperationServiceData Service);
}
