using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Common;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Integration;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>Builds read-only OCC projections while enforcing station scope in SQL.</summary>
internal sealed class EfOccPlanningReadStore(
    ElevantDbContext context,
    TimeProvider timeProvider) : IOccPlanningReadStore
{
    public Task<string?> GetStationTimeZoneAsync(
        Guid stationId,
        CancellationToken cancellationToken = default) =>
        context.Stations
            .AsNoTracking()
            .Where(station => station.PublicId == stationId && station.IsActive)
            .Select(station => station.IanaTimeZone)
            .SingleOrDefaultAsync(cancellationToken);

    public async Task<OccPlanningSnapshotData?> GetSnapshotAsync(
        Guid stationId,
        DateOnly operationDate,
        CancellationToken cancellationToken = default)
    {
        var station = await context.Stations
            .AsNoTracking()
            .Where(item => item.PublicId == stationId && item.IsActive)
            .Select(item => new
            {
                item.Id,
                item.PublicId,
                item.Code,
                item.Name,
                item.IanaTimeZone,
            })
            .SingleOrDefaultAsync(cancellationToken);
        if (station is null)
        {
            return null;
        }

        var responseTurnarounds = await ProjectTurnaroundsAsync(context, station.Id,
            context.Turnarounds.AsNoTracking().Where(turnaround => turnaround.StationId == station.Id &&
                turnaround.OperationDate == operationDate),
            cancellationToken);

        return new OccPlanningSnapshotData(
            new OccStationData(
                station.PublicId,
                station.Code,
                station.Name,
                station.IanaTimeZone),
            operationDate,
            responseTurnarounds);
    }

    /// <summary>
    /// Projects the turnarounds of one station as the planning snapshot shows them: airline, aircraft, stand, legs,
    /// operation, agents, equipment and services. The turnaround detail of 3-A reads one turnaround with it.
    /// </summary>
    internal static async Task<OccTurnaroundData[]> ProjectTurnaroundsAsync(ElevantDbContext context, long stationId,
        IQueryable<Turnaround> source, CancellationToken cancellationToken)
    {
        var turnarounds = await (
                from turnaround in source
                join airline in context.Airlines.AsNoTracking()
                    on turnaround.AirlineId equals airline.Id
                join aircraftCandidate in context.AircraftTypes.AsNoTracking()
                    on turnaround.AircraftTypeId equals aircraftCandidate.Id into aircrafts
                from aircraft in aircrafts.DefaultIfEmpty()
                join operationCandidate in context.GroundOperations.AsNoTracking()
                    on turnaround.Id equals operationCandidate.TurnaroundId into operations
                from operation in operations.DefaultIfEmpty()
                orderby operation.PlannedStartAt,
                    turnaround.OperationCode,
                    turnaround.PublicId
                select new
                {
                    InternalId = turnaround.Id,
                    turnaround.PublicId,
                    turnaround.OperationCode,
                    turnaround.OperationDate,
                    turnaround.CurrentStatus,
                    turnaround.ExternalProvider,
                    Airline = new OccAirlineData(
                        airline.PublicId,
                        airline.IataCode ?? string.Empty,
                        airline.IcaoCode,
                        airline.Name),
                    Aircraft = aircraft == null
                        ? null
                        : new OccAircraftData(
                            aircraft.PublicId,
                            aircraft.IcaoCode,
                            aircraft.IataCode,
                            aircraft.Manufacturer,
                            aircraft.Model,
                            turnaround.AircraftRegistration),
                    OperationInternalId = operation == null ? (long?)null : operation.Id,
                    Operation = operation == null
                        ? null
                        : new OccGroundOperationData(
                            operation.PublicId,
                            operation.CurrentStatus.ToString(),
                            operation.PlannedStartAt,
                            operation.PlannedEndAt,
                            operation.ActualStartAt,
                            operation.ActualEndAt),
                })
            .ToArrayAsync(cancellationToken);

        if (turnarounds.Length == 0)
        {
            return [];
        }

        var turnaroundIds = turnarounds.Select(item => item.InternalId).ToArray();
        var operationIds = turnarounds
            .Where(item => item.OperationInternalId.HasValue)
            .Select(item => item.OperationInternalId!.Value)
            .ToArray();

        var stands = await (
                from assignment in context.Set<StandAssignment>().AsNoTracking()
                join standItem in context.Stands.AsNoTracking()
                    on assignment.StandId equals standItem.Id
                join terminalCandidate in context.Terminals
                    .AsNoTracking()
                    .Where(item => item.StationId == stationId)
                    on standItem.TerminalId equals terminalCandidate.Id into terminals
                from terminal in terminals.DefaultIfEmpty()
                where turnaroundIds.Contains(assignment.TurnaroundId) &&
                      standItem.StationId == stationId &&
                      assignment.AssignedTo == null
                select new
                {
                    assignment.TurnaroundId,
                    Stand = new OccStandData(
                        standItem.PublicId,
                        standItem.Code,
                        terminal == null
                            ? null
                            : new OccTerminalData(
                                terminal.PublicId,
                                terminal.Code,
                                terminal.Name)),
                })
            .ToDictionaryAsync(item => item.TurnaroundId, item => item.Stand, cancellationToken);

        var legs = await (
                from leg in context.FlightLegs.AsNoTracking()
                join origin in context.Airports.AsNoTracking()
                    on leg.OriginAirportId equals origin.Id
                join destination in context.Airports.AsNoTracking()
                    on leg.DestinationAirportId equals destination.Id
                where turnaroundIds.Contains(leg.TurnaroundId)
                orderby leg.ScheduledAt, leg.PublicId
                select new
                {
                    leg.TurnaroundId,
                    leg.Direction,
                    Leg = new OccFlightLegData(
                        leg.PublicId,
                        leg.FlightNumber,
                        new OccAirportData(
                            origin.PublicId,
                            origin.IataCode,
                            origin.IcaoCode,
                            origin.Name),
                        new OccAirportData(
                            destination.PublicId,
                            destination.IataCode,
                            destination.IcaoCode,
                            destination.Name),
                        leg.ScheduledAt,
                        leg.EstimatedAt,
                        leg.ActualAt),
                })
            .ToArrayAsync(cancellationToken);

        var agents = operationIds.Length == 0
            ? []
            : await (
                    from assignment in context.OperationAgentAssignments.AsNoTracking()
                    join agent in context.RampAgents.AsNoTracking()
                        on assignment.RampAgentId equals agent.Id
                    join person in context.Persons.AsNoTracking()
                        on agent.PersonId equals person.Id
                    join positionCandidate in context.OperationalPositions.AsNoTracking()
                        on assignment.OperationalPositionId equals positionCandidate.Id into positions
                    from position in positions.DefaultIfEmpty()
                    where operationIds.Contains(assignment.GroundOperationId) &&
                          assignment.ReleasedAt == null
                    orderby person.FirstName, person.LastName, agent.PublicId
                    select new AssignedAgentProjection(
                        assignment.GroundOperationId,
                        new OccAssignedAgentData(
                            assignment.PublicId,
                            agent.PublicId,
                            (person.FirstName + " " + person.LastName).Trim(),
                            agent.EmployeeNumber,
                            position == null ? null : position.PublicId,
                            position == null ? null : position.Code,
                            position == null ? null : position.Name,
                            assignment.AssignmentRole,
                            assignment.AssignedAt)))
                .ToArrayAsync(cancellationToken);

        var equipment = operationIds.Length == 0
            ? []
            : await (
                    from assignment in context.OperationEquipmentAssignments.AsNoTracking()
                    join asset in context.EquipmentAssets.AsNoTracking()
                        on assignment.EquipmentAssetId equals asset.Id
                    join type in context.EquipmentTypes.AsNoTracking()
                        on asset.EquipmentTypeId equals type.Id
                    where operationIds.Contains(assignment.GroundOperationId) &&
                          assignment.ReleasedAt == null
                    orderby asset.AssetCode, asset.PublicId
                    select new AssignedEquipmentProjection(
                        assignment.GroundOperationId,
                        new OccAssignedEquipmentData(
                            assignment.PublicId,
                            asset.PublicId,
                            asset.AssetCode,
                            type.PublicId,
                            type.Code,
                            type.Name,
                            asset.Status,
                            assignment.AssignedAt)))
                .ToArrayAsync(cancellationToken);

        var services = operationIds.Length == 0
            ? []
            : await (
                    from service in context.OperationServices.AsNoTracking()
                    join definition in context.ServiceDefinitions.AsNoTracking()
                        on service.ServiceDefinitionId equals definition.Id
                    where operationIds.Contains(service.GroundOperationId)
                    orderby service.LineNumber, service.PublicId
                    select new OperationServiceProjection(
                        service.GroundOperationId,
                        new OccOperationServiceData(
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
        var agentsByOperation = agents.ToLookup(item => item.GroundOperationId, item => item.Agent);
        var equipmentByOperation = equipment.ToLookup(item => item.GroundOperationId, item => item.Equipment);
        var servicesByOperation = services.ToLookup(item => item.GroundOperationId, item => item.Service);

        return turnarounds.Select(item =>
        {
            var operationId = item.OperationInternalId;
            var turnaroundLegs = legsByTurnaround[item.InternalId];
            return new OccTurnaroundData(
                item.PublicId,
                item.OperationCode,
                item.OperationDate,
                item.CurrentStatus.ToString(),
                item.Airline,
                item.Aircraft,
                stands.GetValueOrDefault(item.InternalId),
                turnaroundLegs.SingleOrDefault(leg => leg.Direction == FlightDirection.Arrival)?.Leg,
                turnaroundLegs.SingleOrDefault(leg => leg.Direction == FlightDirection.Departure)?.Leg,
                item.Operation,
                operationId.HasValue ? agentsByOperation[operationId.Value].ToArray() : [],
                operationId.HasValue ? equipmentByOperation[operationId.Value].ToArray() : [],
                operationId.HasValue ? servicesByOperation[operationId.Value].ToArray() : [],
                DemoFlightGroups.Mark(item.ExternalProvider));
        }).ToArray();
    }

    public async Task<OccPlanningOptionsReadResult> GetOptionsAsync(
        IReadOnlyCollection<Guid> allowedStationIds,
        Guid turnaroundId,
        CancellationToken cancellationToken = default)
    {
        var stationIds = allowedStationIds
            .Where(id => id != Guid.Empty)
            .Distinct()
            .ToArray();
        if (stationIds.Length == 0)
        {
            return OccPlanningOptionsReadResult.Failed(OccPlanningOptionsReadFailure.NotFound);
        }

        var scope = await (
                from turnaround in context.Turnarounds.AsNoTracking()
                join station in context.Stations.AsNoTracking()
                    on turnaround.StationId equals station.Id
                join operationCandidate in context.GroundOperations.AsNoTracking()
                    on turnaround.Id equals operationCandidate.TurnaroundId into operations
                from operation in operations.DefaultIfEmpty()
                where turnaround.PublicId == turnaroundId &&
                      stationIds.Contains(station.PublicId) &&
                      station.IsActive
                select new
                {
                    TurnaroundInternalId = turnaround.Id,
                    turnaround.PublicId,
                    turnaround.OperationCode,
                    turnaround.OperationDate,
                    TurnaroundStatus = turnaround.CurrentStatus,
                    turnaround.AirlineId,
                    StationInternalId = station.Id,
                    Station = new OccStationData(
                        station.PublicId,
                        station.Code,
                        station.Name,
                        station.IanaTimeZone),
                    OperationInternalId = operation == null
                        ? (long?)null
                        : operation.Id,
                    OperationStatus = operation == null
                        ? (GroundOperationStatus?)null
                        : operation.CurrentStatus,
                    PlannedStartAt = operation == null
                        ? null
                        : operation.PlannedStartAt,
                    PlannedEndAt = operation == null
                        ? null
                        : operation.PlannedEndAt,
                    OperationRowVersion = operation == null
                        ? null
                        : operation.RowVersion,
                })
            .SingleOrDefaultAsync(cancellationToken);
        if (scope is null)
        {
            return OccPlanningOptionsReadResult.Failed(OccPlanningOptionsReadFailure.NotFound);
        }

        if (!scope.OperationInternalId.HasValue ||
            !scope.OperationStatus.HasValue ||
            scope.OperationRowVersion is null ||
            !OccPlanningAssignmentPolicy.CanAssign(
                scope.TurnaroundStatus,
                scope.OperationStatus.Value,
                scope.PlannedStartAt,
                scope.PlannedEndAt))
        {
            return OccPlanningOptionsReadResult.Failed(
                OccPlanningOptionsReadFailure.OperationalConflict);
        }

        var stand = await (
                from assignment in context.Set<StandAssignment>().AsNoTracking()
                join standItem in context.Stands.AsNoTracking()
                    on assignment.StandId equals standItem.Id
                join terminalCandidate in context.Terminals
                    .AsNoTracking()
                    .Where(item => item.StationId == scope.StationInternalId)
                    on standItem.TerminalId equals terminalCandidate.Id into terminals
                from terminal in terminals.DefaultIfEmpty()
                where assignment.TurnaroundId == scope.TurnaroundInternalId &&
                      standItem.StationId == scope.StationInternalId &&
                      assignment.AssignedTo == null
                select new StandContextProjection(
                    terminal == null ? null : terminal.Id,
                    new OccStandData(
                        standItem.PublicId,
                        standItem.Code,
                        terminal == null
                            ? null
                            : new OccTerminalData(
                                terminal.PublicId,
                                terminal.Code,
                                terminal.Name))))
            .SingleOrDefaultAsync(cancellationToken);

        var scheduledAt = await context.FlightLegs
            .AsNoTracking()
            .Where(leg => leg.TurnaroundId == scope.TurnaroundInternalId)
            .OrderBy(leg => leg.Direction)
            .Select(leg => (DateTimeOffset?)leg.ScheduledAt)
            .FirstOrDefaultAsync(cancellationToken);
        var referenceTime = scope.PlannedStartAt ??
            scheduledAt ??
            GetUtcInstantAtLocalMidnight(scope.OperationDate, scope.Station.IanaTimeZone);

        // A charter flight has no contract (ADR-0033): its services are added on the ramp at the base tariff.
        var isCharter = await context.Set<CharterAgreement>().AsNoTracking()
            .AnyAsync(item => item.TurnaroundId == scope.TurnaroundInternalId, cancellationToken);
        var applicableContracts = isCharter ? [] : await ApplicableContracts.For(context, scope.AirlineId, scope.StationInternalId, scope.OperationDate)
            .OrderByDescending(row => row.VersionNumber).ThenBy(row => row.VersionPublicId)
            .Select(row => new ContractProjection(row.VersionId, new OccContractOptionData(row.ContractPublicId,
                row.ContractCode, row.VersionNumber, row.ValidFrom, row.ValidTo, row.CurrencyCode)))
            .Take(2)
            .ToArrayAsync(cancellationToken);
        if (applicableContracts.Length > 1)
        {
            return OccPlanningOptionsReadResult.Failed(
                OccPlanningOptionsReadFailure.ContractConflict);
        }

        var contract = applicableContracts.SingleOrDefault();

        var services = contract is null
            ? []
            : await (
                    from rate in context.ContractServiceRates.AsNoTracking()
                    join definition in context.ServiceDefinitions.AsNoTracking()
                        on rate.ServiceDefinitionId equals definition.Id
                    where rate.ContractVersionId == contract.ContractVersionId &&
                          definition.IsActive
                    orderby definition.Name, definition.Code, definition.PublicId
                    select new OccServiceOptionData(
                        rate.PublicId,
                        definition.PublicId,
                        definition.Code,
                        definition.Name,
                        rate.BillingUnit,
                        rate.MinimumQuantity,
                        rate.UnitPrice,
                        contract.Contract.CurrencyCode))
                .ToArrayAsync(cancellationToken);

        var candidates = (await BuildAgentCandidatesAsync(
            scope.OperationInternalId,
            scope.StationInternalId,
            stand?.TerminalInternalId,
            scope.OperationDate,
            referenceTime,
            scope.PlannedStartAt,
            scope.PlannedEndAt,
            scope.Station.IanaTimeZone,
            null,
            cancellationToken)).Select(candidate => candidate.Data).ToArray();

        var options = new OccPlanningOptionsSourceData(
            new OccPlanningTurnaroundContextData(
                scope.PublicId,
                scope.OperationCode,
                scope.OperationDate,
                scope.Station,
                stand?.Stand,
                referenceTime,
                string.Empty),
            contract?.Contract,
            services,
            candidates,
            isCharter);
        var concurrencyToken = OccPlanningConcurrencyToken.CreateOptions(
            scope.TurnaroundStatus,
            scope.OperationStatus.Value,
            scope.PlannedStartAt!.Value,
            scope.PlannedEndAt!.Value,
            scope.OperationRowVersion,
            options);

        return OccPlanningOptionsReadResult.Success(options with
        {
            Turnaround = options.Turnaround with { ConcurrencyToken = concurrencyToken },
        });
    }

    /// <summary>One candidate with its internal key, for the stores that act on it (3-N05, 3-F).</summary>
    internal sealed record AgentCandidate(long AgentId, OccAgentCandidateData Data);

    /// <summary>
    /// The agents of the station and the facts OCC's eligibility evaluates for one operation
    /// (<see cref="OccAgentEligibilityPolicy"/>): account, scopes, documents and qualification on
    /// <paramref name="operationDate"/>, the shift and absences at <paramref name="referenceTime"/> in the station's
    /// calendar, the mentor a junior needs, and the simultaneous operations in [<paramref name="plannedStartAt"/>,
    /// <paramref name="plannedEndAt"/>) (<see cref="AgentSimultaneity"/>; the operation itself never counts, and without
    /// an operation every overlapping one does). The stand reassignment, the handover and the demo flight options
    /// (ADR-0041, with no operation yet) evaluate only <paramref name="onlyAgentIds"/>, with the same rules as the manual
    /// assignment.
    /// </summary>
    internal async Task<AgentCandidate[]> BuildAgentCandidatesAsync(
        long? operationId,
        long stationId,
        long? terminalId,
        DateOnly operationDate,
        DateTimeOffset referenceTime,
        DateTimeOffset? plannedStartAt,
        DateTimeOffset? plannedEndAt,
        string ianaTimeZone,
        IReadOnlyCollection<long>? onlyAgentIds,
        CancellationToken cancellationToken)
    {
        var only = onlyAgentIds?.Distinct().ToArray();
        if (only is { Length: 0 })
        {
            return [];
        }

        var zone = BusinessCalendar.Zone(ianaTimeZone);
        var localReference = TimeZoneInfo.ConvertTime(referenceTime, zone);
        var localDate = DateOnly.FromDateTime(localReference.DateTime);
        var localTime = TimeOnly.FromDateTime(localReference.DateTime);
        var previousDate = localDate.AddDays(-1);
        var agents = await (
                from agent in context.RampAgents.AsNoTracking()
                join person in context.Persons.AsNoTracking()
                    on agent.PersonId equals person.Id
                where (only == null || only.Contains(agent.Id)) &&
                      (context.Set<RampAgentStationScope>().AsNoTracking().Any(scope =>
                          scope.RampAgentId == agent.Id &&
                          scope.StationId == stationId &&
                          scope.ValidFrom <= operationDate &&
                          (scope.ValidTo == null || scope.ValidTo >= operationDate)) ||
                      context.ShiftAssignments.AsNoTracking().Any(shift =>
                          shift.RampAgentId == agent.Id &&
                          shift.StationId == stationId &&
                          terminalId.HasValue &&
                          shift.TerminalId == terminalId.Value &&
                          shift.StartsAtLocal != shift.EndsAtLocal &&
                          ((shift.StartsAtLocal < shift.EndsAtLocal &&
                            shift.WorkDate == localDate &&
                            shift.StartsAtLocal <= localTime &&
                            localTime < shift.EndsAtLocal) ||
                           (shift.StartsAtLocal > shift.EndsAtLocal &&
                            ((shift.WorkDate == localDate &&
                              shift.StartsAtLocal <= localTime) ||
                             (shift.WorkDate == previousDate &&
                              localTime < shift.EndsAtLocal))))))
                orderby person.FirstName, person.LastName, agent.PublicId
                select new
                {
                    agent.Id,
                    agent.PublicId,
                    agent.PersonId,
                    agent.EmployeeNumber,
                    agent.IsActive,
                    agent.HireDate,
                    DisplayName = (person.FirstName + " " + person.LastName).Trim(),
                })
            .ToArrayAsync(cancellationToken);
        if (agents.Length == 0)
        {
            return [];
        }

        var personIds = agents.Select(agent => agent.PersonId).ToArray();
        var agentIds = agents.Select(agent => agent.Id).ToArray();
        var now = timeProvider.GetUtcNow();

        var accounts = await context.Users
            .AsNoTracking()
            .Where(account => personIds.Contains(account.PersonId))
            .Select(account => new
            {
                account.Id,
                account.PersonId,
                IsActive = account.Status == AccountLifecycleStatus.Active &&
                    account.InvitationStatus == InvitationStatus.Accepted &&
                    account.EmailConfirmed &&
                    account.LockoutEnabled &&
                    !account.TwoFactorEnabled &&
                    account.SecurityStamp != null &&
                    account.SecurityStamp != string.Empty &&
                    (account.LockoutEnd == null || account.LockoutEnd <= now),
            })
            .ToArrayAsync(cancellationToken);
        var accountIds = accounts.Select(account => account.Id).ToArray();

        var mobileRoleAccounts = accountIds.Length == 0
            ? []
            : await (
                    from assignment in context.Set<IdentityUserRole<long>>().AsNoTracking()
                    join role in context.Roles.AsNoTracking()
                        on assignment.RoleId equals role.Id
                    where accountIds.Contains(assignment.UserId) &&
                          role.NormalizedName == "RAMP_AGENT" &&
                          role.Portal == PortalKind.RampMobileApp
                    select assignment.UserId)
                .Distinct()
                .ToArrayAsync(cancellationToken);

        var activeMembershipAccounts = accountIds.Length == 0
            ? []
            : await (
                    from membership in context.OrganizationMemberships.AsNoTracking()
                    join organization in context.Organizations.AsNoTracking()
                        on membership.OrganizationId equals organization.Id
                    where accountIds.Contains(membership.AccountId) &&
                          membership.Status == MembershipStatus.Active &&
                          membership.Kind == MembershipKind.InternalStaff &&
                          organization.Status == OrganizationStatus.Active &&
                          organization.Type == OrganizationType.AviamOperator &&
                          (membership.ValidFrom == null || membership.ValidFrom <= operationDate) &&
                          (membership.ValidTo == null || membership.ValidTo >= operationDate)
                    select membership.AccountId)
                .Distinct()
                .ToArrayAsync(cancellationToken);

        var accountStationScopes = accountIds.Length == 0
            ? []
            : await context.AccountStationScopes
                .AsNoTracking()
                .Where(scope => accountIds.Contains(scope.AccountId) &&
                    scope.StationId == stationId &&
                    scope.GrantedAt <= now &&
                    scope.RevokedAt == null)
                .Select(scope => scope.AccountId)
                .Distinct()
                .ToArrayAsync(cancellationToken);

        var stationScopedAgents = await context.Set<RampAgentStationScope>()
            .AsNoTracking()
            .Where(scope => agentIds.Contains(scope.RampAgentId) &&
                scope.StationId == stationId &&
                scope.ValidFrom <= operationDate &&
                (scope.ValidTo == null || scope.ValidTo >= operationDate))
            .Select(scope => scope.RampAgentId)
            .Distinct()
            .ToArrayAsync(cancellationToken);

        var terminalScopedAgents = terminalId.HasValue
            ? await context.Set<RampAgentTerminalScope>()
                .AsNoTracking()
                .Where(scope => agentIds.Contains(scope.RampAgentId) &&
                    scope.TerminalId == terminalId.Value &&
                    scope.ValidFrom <= operationDate &&
                    (scope.ValidTo == null || scope.ValidTo >= operationDate))
                .Select(scope => scope.RampAgentId)
                .Distinct()
                .ToArrayAsync(cancellationToken)
            : [];

        var qualifications = await context.QualificationCycles
            .AsNoTracking()
            .Where(cycle => agentIds.Contains(cycle.RampAgentId) &&
                cycle.IsCurrent &&
                cycle.ObtainedOn <= operationDate &&
                cycle.ExpiresOn >= operationDate)
            .Select(cycle => new
            {
                cycle.RampAgentId,
                cycle.EquipmentTypeId,
            })
            .Distinct()
            .ToArrayAsync(cancellationToken);

        var currentPermits = await context.AirportPermitCycles
            .AsNoTracking()
            .Where(cycle => agentIds.Contains(cycle.RampAgentId) &&
                cycle.IsCurrent &&
                cycle.IssuedOn <= operationDate &&
                cycle.ExpiresOn >= operationDate)
            .Select(cycle => new { cycle.RampAgentId, cycle.DocumentType })
            .Distinct()
            .ToArrayAsync(cancellationToken);

        var shifts = terminalId.HasValue
            ? await context.ShiftAssignments
                .AsNoTracking()
                .Where(shift => agentIds.Contains(shift.RampAgentId) &&
                    shift.StationId == stationId &&
                    shift.TerminalId == terminalId.Value &&
                    (shift.WorkDate == localDate || shift.WorkDate == previousDate))
                .Select(shift => new
                {
                    shift.RampAgentId,
                    shift.WorkDate,
                    shift.StartsAtLocal,
                    shift.EndsAtLocal,
                    shift.OperationalPositionId,
                })
                .ToArrayAsync(cancellationToken)
            : [];

        var approvedAbsences = await context.AvailabilityRequests
            .AsNoTracking()
            .Where(request => agentIds.Contains(request.RampAgentId) &&
                request.Status == AvailabilityRequestStatus.Approved &&
                (request.Type == AvailabilityRequestType.DayOff ||
                 request.Type == AvailabilityRequestType.Restriction) &&
                request.StartsOn <= localDate && request.EndsOn >= previousDate)
            .Select(request => new
            {
                request.RampAgentId,
                request.StartsOn,
                request.EndsOn,
            })
            .ToArrayAsync(cancellationToken);

        var positionIds = shifts
            .Where(shift => shift.OperationalPositionId.HasValue)
            .Select(shift => shift.OperationalPositionId!.Value)
            .Distinct()
            .ToArray();
        var positions = positionIds.Length == 0
            ? []
            : await context.OperationalPositions
                .AsNoTracking()
                .Where(position => positionIds.Contains(position.Id) && position.IsActive)
                .Select(position => new
                {
                    position.Id,
                    position.PublicId,
                    position.RequiresQualification,
                    position.RequiredEquipmentTypeId,
                })
                .ToArrayAsync(cancellationToken);

        // 3-D: one rule of simultaneity (OperationOccupancyRules): up to three operations that hold the agent may
        // overlap; approved, handed-over or cancelled ones do not count, and a holding one without a window does. A
        // flight that has no operation yet (the demo flight options, ADR-0041) counts every one that overlaps it.
        var overlaps = plannedStartAt.HasValue &&
            plannedEndAt.HasValue &&
            plannedStartAt.Value < plannedEndAt.Value
                ? await AgentSimultaneity.CountOverlapsAsync(context, agentIds, operationId, plannedStartAt.Value,
                    plannedEndAt.Value, cancellationToken)
                : new Dictionary<long, int>();

        // Pillier: an agent with less than three months never works alone. A junior is eligible only with an open
        // coverage of this station that names a mentor at the reference time (ADR-0030, PositionCoveragePolicy).
        var juniors = agents
            .Where(agent => PositionCoveragePolicy.IsJunior(agent.HireDate, operationDate))
            .Select(agent => agent.Id)
            .ToArray();
        var mentoredJuniors = juniors.Length == 0
            ? []
            : await context.Set<PositionCoverage>()
                .AsNoTracking()
                .Where(coverage => juniors.Contains(coverage.RampAgentId) &&
                    coverage.StationId == stationId &&
                    coverage.ReleasedAt == null &&
                    coverage.MentorRampAgentId != null &&
                    coverage.StartsAt <= referenceTime &&
                    referenceTime < coverage.EndsAt)
                .Select(coverage => coverage.RampAgentId)
                .Distinct()
                .ToArrayAsync(cancellationToken);
        var mentored = mentoredJuniors.ToHashSet();

        var mobileRoles = mobileRoleAccounts.ToHashSet();
        var memberships = activeMembershipAccounts.ToHashSet();
        var accountScopes = accountStationScopes.ToHashSet();
        var agentStationScopes = stationScopedAgents.ToHashSet();
        var agentTerminalScopes = terminalScopedAgents.ToHashSet();
        var currentQualifications = qualifications
            .Select(item => (item.RampAgentId, item.EquipmentTypeId))
            .ToHashSet();
        var airportIds = currentPermits
            .Where(item => item.DocumentType == PermitDocumentType.AirportId)
            .Select(item => item.RampAgentId)
            .ToHashSet();
        var driverLicenses = currentPermits
            .Where(item => item.DocumentType == PermitDocumentType.RampDriverLicense)
            .Select(item => item.RampAgentId)
            .ToHashSet();
        var accountsByPerson = accounts.ToLookup(account => account.PersonId);
        var shiftsByAgent = shifts.ToLookup(shift => shift.RampAgentId);
        var absencesByAgent = approvedAbsences.ToLookup(absence => absence.RampAgentId);
        var positionsById = positions.ToDictionary(position => position.Id);

        return agents.Select(agent =>
        {
            var agentAccounts = accountsByPerson[agent.PersonId].ToArray();
            var hasMobileAccount = agentAccounts.Any(account =>
                account.IsActive &&
                mobileRoles.Contains(account.Id) &&
                memberships.Contains(account.Id));
            var hasAccountStationScope = agentAccounts.Any(account =>
                accountScopes.Contains(account.Id));
            var compatibleShifts = shiftsByAgent[agent.Id]
                .Where(shift => OccShiftCoveragePolicy.Covers(
                    shift.WorkDate,
                    shift.StartsAtLocal,
                    shift.EndsAtLocal,
                    localDate,
                    localTime))
                .ToArray();
            var hasShift = compatibleShifts.Length > 0;
            var hasApprovedAbsence = absencesByAgent[agent.Id].Any(absence =>
                (absence.StartsOn <= localDate && absence.EndsOn >= localDate) ||
                compatibleShifts.Any(shift =>
                    absence.StartsOn <= shift.WorkDate &&
                    absence.EndsOn >= shift.WorkDate));
            var position = compatibleShifts.Length == 1 &&
                compatibleShifts[0].OperationalPositionId is long positionId &&
                positionsById.TryGetValue(
                    positionId,
                    out var resolvedPosition)
                    ? resolvedPosition
                    : null;
            var hasCurrentQualification = position is not null &&
                (!position.RequiresQualification ||
                 (position.RequiredEquipmentTypeId.HasValue &&
                  currentQualifications.Contains((agent.Id, position.RequiredEquipmentTypeId.Value))));

            return new AgentCandidate(agent.Id, new OccAgentCandidateData(
                agent.PublicId,
                agent.DisplayName,
                agent.EmployeeNumber,
                agent.IsActive,
                hasMobileAccount,
                agentStationScopes.Contains(agent.Id) && hasAccountStationScope,
                agentTerminalScopes.Contains(agent.Id),
                hasCurrentQualification,
                airportIds.Contains(agent.Id),
                driverLicenses.Contains(agent.Id),
                hasShift,
                position?.PublicId,
                OperationOccupancyRules.AtCapacity(overlaps.GetValueOrDefault(agent.Id)),
                hasApprovedAbsence,
                PositionCoveragePolicy.IsJunior(agent.HireDate, operationDate) && !mentored.Contains(agent.Id)));
        }).ToArray();
    }

    private static DateTimeOffset GetUtcInstantAtLocalMidnight(
        DateOnly localDate,
        string ianaTimeZone)
    {
        var zone = TimeZoneInfo.FindSystemTimeZoneById(ianaTimeZone);
        var localMidnight = DateTime.SpecifyKind(
            localDate.ToDateTime(TimeOnly.MinValue),
            DateTimeKind.Unspecified);
        var utc = TimeZoneInfo.ConvertTimeToUtc(localMidnight, zone);
        return new DateTimeOffset(utc, TimeSpan.Zero);
    }

    private sealed record AssignedAgentProjection(
        long GroundOperationId,
        OccAssignedAgentData Agent);

    private sealed record AssignedEquipmentProjection(
        long GroundOperationId,
        OccAssignedEquipmentData Equipment);

    private sealed record OperationServiceProjection(
        long GroundOperationId,
        OccOperationServiceData Service);

    private sealed record StandContextProjection(
        long? TerminalInternalId,
        OccStandData Stand);

    private sealed record ContractProjection(
        long ContractVersionId,
        OccContractOptionData Contract);
}
