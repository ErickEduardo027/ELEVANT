using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Common;
using Elevant.Application.Identity;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Audit;
using Elevant.Persistence.Commercial;
using Elevant.Persistence.Identity;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;
using Step = Elevant.Persistence.Operations.MasterDataCommand.Step;

namespace Elevant.Persistence.Operations;

/// <summary>
/// OCC edits a turnaround from Planificación (3-A, 3-N21): it reschedules, cancels or diverts it before its operation
/// starts and registers the minimal carrier of a charter. Every command runs in one serializable transaction with its
/// Idempotency-Key receipt (<see cref="MasterDataCommand"/>), checks the turnaround version OCC saw, is audited and
/// announced; nothing is deleted. A cancellation frees the stand and the agents through the one release path
/// (<see cref="RampAgentRelease"/>), and the tablet only hears the notice types it knows.
/// </summary>
internal sealed class EfOccTurnaroundStore(ElevantDbContext context, IActorContextResolver actors, TimeProvider timeProvider)
    : IOccTurnaroundStore
{
    private const string ReadPermission = "operations.planning.read";
    private const string CreatePermission = "operations.planning.create";
    private const string UpdatePermission = "operations.planning.update";
    private const string RescheduleAction = "occ.turnaround.reschedule";
    private const string StatusAction = "occ.turnaround.status_change";
    private const string CharterAirlineAction = "occ.charter_airline.create";
    private const string OtherAirlinesRegion = "Otras aerolíneas";

    private sealed record Scope(long TurnaroundId, long StationId, Guid StationPublicId, string TimeZone, string AirportIata,
        long AccountId);

    public async Task<MasterDataResult<OccTurnaroundDetailData>> ReadAsync(Guid actorId, Guid turnaroundId,
        CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, ReadPermission)) return Failed<OccTurnaroundDetailData>(MasterDataFailure.Forbidden, "forbidden");
        var scope = await ScopeAsync(actor!, actorId, turnaroundId, cancellationToken);
        var detail = scope is null ? null : await DetailAsync(turnaroundId);
        return detail is null
            ? Failed<OccTurnaroundDetailData>(MasterDataFailure.NotFound, "not_found")
            : MasterDataResult<OccTurnaroundDetailData>.Success(detail);
    }

    public async Task<MasterDataResult<OccTurnaroundDetailData>> RescheduleAsync(Guid actorId, Guid turnaroundId,
        RescheduleTurnaroundInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, UpdatePermission)) return Failed<OccTurnaroundDetailData>(MasterDataFailure.Forbidden, "forbidden");
        if (idempotencyKey is not { } key || key == Guid.Empty)
            return Failed<OccTurnaroundDetailData>(MasterDataFailure.Invalid, "idempotency_key_required");
        if (string.IsNullOrWhiteSpace(input.ExpectedVersion))
            return Failed<OccTurnaroundDetailData>(MasterDataFailure.Invalid, "expected_version_required");
        var arrivalNumber = FlightIdentity.NormalizeFlightNumber(input.ArrivalFlightNumber);
        var departureNumber = FlightIdentity.NormalizeFlightNumber(input.DepartureFlightNumber);
        var origin = FlightIdentity.NormalizeIata(input.ArrivalOriginIata);
        var destination = FlightIdentity.NormalizeIata(input.DepartureDestinationIata);
        if (!FlightIdentity.IsFlightNumber(arrivalNumber) || !FlightIdentity.IsFlightNumber(departureNumber) ||
            !FlightIdentity.IsIata(origin) || !FlightIdentity.IsIata(destination) ||
            input.ArrivalScheduledAt is not { } arrivalValue || input.DepartureScheduledAt is not { } departureValue ||
            !OccTurnaroundRules.IsValidSchedule(arrivalValue, departureValue) ||
            input.StandId == Guid.Empty || input.AircraftTypeId == Guid.Empty)
            return Failed<OccTurnaroundDetailData>(MasterDataFailure.Invalid, "invalid_turnaround_change");
        var reason = OccTurnaroundRules.Reason(input.Reason);
        if (reason is null) return Failed<OccTurnaroundDetailData>(MasterDataFailure.Invalid, "reason_required");
        var scope = await ScopeAsync(actor!, actorId, turnaroundId, cancellationToken);
        if (scope is null) return Failed<OccTurnaroundDetailData>(MasterDataFailure.NotFound, "not_found");
        // A leg of the station's own airport is never its origin or destination.
        if (origin == scope.AirportIata || destination == scope.AirportIata)
            return Failed<OccTurnaroundDetailData>(MasterDataFailure.Invalid, "invalid_turnaround_change");
        var arrivalAt = Truncate(arrivalValue);
        var departureAt = Truncate(departureValue);
        var hash = CommercialCommandReceipts.Hash(new
        {
            turnaroundId, arrivalNumber, origin, arrivalAt, departureNumber, destination, departureAt, input.StandId,
            input.AircraftTypeId, reason, expected = input.ExpectedVersion,
        });
        var now = Now();
        return await MasterDataCommand.RunAsync(context, key, scope.AccountId, RescheduleAction, hash, "version_conflict", now,
            () => RescheduleInsideAsync(scope, input, arrivalNumber, origin, arrivalAt, departureNumber, destination,
                departureAt, reason, now, cancellationToken),
            DetailAsync, cancellationToken);
    }

    public async Task<MasterDataResult<OccTurnaroundDetailData>> ChangeStatusAsync(Guid actorId, Guid turnaroundId,
        TurnaroundStatusChangeInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, UpdatePermission)) return Failed<OccTurnaroundDetailData>(MasterDataFailure.Forbidden, "forbidden");
        if (idempotencyKey is not { } key || key == Guid.Empty)
            return Failed<OccTurnaroundDetailData>(MasterDataFailure.Invalid, "idempotency_key_required");
        if (string.IsNullOrWhiteSpace(input.ExpectedVersion))
            return Failed<OccTurnaroundDetailData>(MasterDataFailure.Invalid, "expected_version_required");
        if (OccTurnaroundRules.ParseOutcome(input.Outcome) is not { } outcome)
            return Failed<OccTurnaroundDetailData>(MasterDataFailure.Invalid, "invalid_turnaround_change");
        var reason = OccTurnaroundRules.Reason(input.Reason);
        if (reason is null) return Failed<OccTurnaroundDetailData>(MasterDataFailure.Invalid, "reason_required");
        var scope = await ScopeAsync(actor!, actorId, turnaroundId, cancellationToken);
        if (scope is null) return Failed<OccTurnaroundDetailData>(MasterDataFailure.NotFound, "not_found");
        var hash = CommercialCommandReceipts.Hash(new
        {
            turnaroundId, outcome = outcome.ToString(), reason, expected = input.ExpectedVersion,
        });
        var now = Now();
        return await MasterDataCommand.RunAsync(context, key, scope.AccountId, StatusAction, hash, "version_conflict", now,
            () => ChangeStatusInsideAsync(scope, outcome, reason, input.ExpectedVersion!, now, cancellationToken),
            DetailAsync, cancellationToken);
    }

    public async Task<MasterDataResult<OccCharterAirlineData>> CreateCharterAirlineAsync(Guid actorId, CharterAirlineInput input,
        Guid? idempotencyKey, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, CreatePermission)) return Failed<OccCharterAirlineData>(MasterDataFailure.Forbidden, "forbidden");
        if (idempotencyKey is not { } key || key == Guid.Empty)
            return Failed<OccCharterAirlineData>(MasterDataFailure.Invalid, "idempotency_key_required");
        var name = OccTurnaroundRules.AirlineName(input.Name);
        var icao = OccTurnaroundRules.AirlineIcao(input.IcaoCode);
        if (name is null || icao is null || !OccTurnaroundRules.TryAirlineIata(input.IataCode, out var iata))
            return Failed<OccCharterAirlineData>(MasterDataFailure.Invalid, "invalid_charter_airline");
        var accountId = await AccountIdAsync(actorId, cancellationToken);
        var hash = CommercialCommandReceipts.Hash(new { name, icao, iata });
        var now = Now();
        var stations = actor!.StationScopes.Select(scope => scope.StationId).Distinct().ToArray();
        return await MasterDataCommand.RunAsync(context, key, accountId, CharterAirlineAction, hash, "airline_code_in_use", now,
            async () =>
            {
                // A designator already in ref.airlines names that carrier: the screen offers it instead (3-N21).
                var taken = await context.Airlines.AsNoTracking()
                    .Where(item => item.IcaoCode == icao || (iata != null && item.IataCode == iata))
                    .Select(item => (Guid?)item.PublicId).FirstOrDefaultAsync(cancellationToken);
                if (taken is { } existing) return Step.Fail(MasterDataFailure.Conflict, "airline_code_in_use", null, existing);
                // The OCC- prefix marks a carrier OCC created; a commercial approval of the same codes completes it.
                var code = $"OCC-{Guid.NewGuid():N}"[..24];
                var organization = new Organization
                {
                    PublicId = Guid.CreateVersion7(), Code = code, LegalName = name, DisplayName = Truncate(name, 120),
                    Type = OrganizationType.AirlineCustomer, Status = OrganizationStatus.Active, CreatedAt = now, UpdatedAt = now,
                };
                context.Organizations.Add(organization);
                await context.SaveChangesAsync(cancellationToken);
                var airline = new Airline
                {
                    PublicId = Guid.CreateVersion7(), OrganizationId = organization.Id, IataCode = iata, IcaoCode = icao,
                    Name = name, IsActive = true, CreatedAt = now, UpdatedAt = now,
                };
                context.Airlines.Add(airline);
                await context.SaveChangesAsync(cancellationToken);
                // Unverified and unpublished: Superadministración sees it, the public catalog does not.
                context.CommercialAirlineProfiles.Add(new CommercialAirlineProfile
                {
                    PublicId = Guid.CreateVersion7(), SourceName = code, DisplayName = name, LegalName = name,
                    Region = OtherAirlinesRegion, IataCode = iata, IcaoCode = icao, SourceUrl = string.Empty,
                    IsPublished = false, CanonicalAirlineId = airline.Id, CreatedAt = now, UpdatedAt = now,
                });
                context.AuditEntries.Add(new AuditEntry
                {
                    PublicId = Guid.CreateVersion7(), OccurredAt = now, ActorType = AuditActorType.Account,
                    ActorAccountId = accountId, Action = "occ.airline.created", EntityType = "ref.airlines",
                    EntityPublicId = airline.PublicId, OrganizationId = organization.Id, Source = AuditSource.Api,
                    CorrelationId = Guid.CreateVersion7(), Reason = "Aerolínea mínima registrada por OCC para un charter.",
                    MetadataJson = SafeAuditChanges.Serialize(new AuditFieldChangeData("airline.icao", null, icao),
                        new AuditFieldChangeData("airline.iata", null, iata),
                        new AuditFieldChangeData("airline.name", null, name)),
                });
                // The charter airlines of «Nuevo vuelo» list it from now on.
                foreach (var station in await context.Stations.AsNoTracking().Where(item => stations.Contains(item.PublicId))
                             .Select(item => new { item.Id, item.PublicId }).ToArrayAsync(cancellationToken))
                    await OccPlanningChangeWriter.AddForStationAsync(context, station.Id, station.PublicId, now, cancellationToken);
                await context.SaveChangesAsync(cancellationToken);
                return Step.Done(airline.PublicId);
            }, AirlineAsync, cancellationToken);
    }

    private async Task<Step> RescheduleInsideAsync(Scope scope, RescheduleTurnaroundInput input, string arrivalNumber,
        string origin, DateTimeOffset arrivalAt, string departureNumber, string destination, DateTimeOffset departureAt,
        string reason, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var turnaround = await context.Turnarounds.SingleAsync(item => item.Id == scope.TurnaroundId, cancellationToken);
        if (MasterDataCommand.Version(turnaround.RowVersion) != input.ExpectedVersion)
            return Step.Fail(MasterDataFailure.Conflict, "version_conflict");
        var operation = await context.GroundOperations.FirstOrDefaultAsync(item => item.TurnaroundId == turnaround.Id,
            cancellationToken);
        if (OccTurnaroundRules.BeforeStartFailure(turnaround.CurrentStatus, operation?.CurrentStatus) is { } closed)
            return Step.Fail(MasterDataFailure.Conflict, closed);
        var legs = await context.FlightLegs.Where(item => item.TurnaroundId == turnaround.Id).ToArrayAsync(cancellationToken);
        var arrival = legs.SingleOrDefault(item => item.Direction == FlightDirection.Arrival);
        var departure = legs.SingleOrDefault(item => item.Direction == FlightDirection.Departure);
        if (arrival is null || departure is null) return Step.Fail(MasterDataFailure.Conflict, "invalid_turnaround_change");
        // The new airports by code, and the current ones so the audit names them by their code too.
        var airports = await context.Airports.AsNoTracking()
            .Where(item => item.IataCode == origin || item.IataCode == destination ||
                           item.Id == arrival.OriginAirportId || item.Id == departure.DestinationAirportId)
            .Select(item => new { item.Id, item.IataCode }).ToArrayAsync(cancellationToken);
        var originId = airports.FirstOrDefault(item => item.IataCode == origin)?.Id;
        var destinationId = airports.FirstOrDefault(item => item.IataCode == destination)?.Id;
        if (originId is null || destinationId is null) return Step.Fail(MasterDataFailure.Invalid, "invalid_turnaround_change");
        string? AirportCode(long id) => airports.FirstOrDefault(item => item.Id == id)?.IataCode;

        // A new local day takes the contract of that day; a charter stays without one (ADR-0033).
        var operationDate = BusinessCalendar.Today(arrivalAt, scope.TimeZone);
        var contractVersionId = turnaround.ContractVersionId;
        if (operationDate != turnaround.OperationDate &&
            !await context.Set<CharterAgreement>().AnyAsync(item => item.TurnaroundId == turnaround.Id, cancellationToken))
        {
            var contracts = await ApplicableContracts.For(context, turnaround.AirlineId, scope.StationId, operationDate)
                .Select(row => row.VersionId).Take(2).ToArrayAsync(cancellationToken);
            if (contracts.Length == 0) return Step.Fail(MasterDataFailure.Conflict, "contract_not_in_force");
            if (contracts.Length > 1) return Step.Fail(MasterDataFailure.Conflict, "contract_ambiguous");
            contractVersionId = contracts[0];
        }

        // The aircraft type, typed once (3-B): an active one, frozen from the first submission.
        var aircraftTypeId = turnaround.AircraftTypeId;
        AircraftSizeCategory? aircraftSize = null;
        if (input.AircraftTypeId is { } requestedType)
        {
            var type = await context.AircraftTypes.AsNoTracking().Where(item => item.PublicId == requestedType)
                .Select(item => new { item.Id, item.IsActive, item.SizeCategory }).SingleOrDefaultAsync(cancellationToken);
            if (type is null || (!type.IsActive && type.Id != turnaround.AircraftTypeId))
                return Step.Fail(MasterDataFailure.Conflict, "aircraft_type_unavailable");
            if (type.Id != turnaround.AircraftTypeId)
            {
                var submitted = operation is not null && await context.OperationSubmissions.AsNoTracking()
                    .AnyAsync(item => item.GroundOperationId == operation.Id, cancellationToken);
                if (OccTurnaroundRules.IsAircraftTypeLocked(operation?.CurrentStatus, submitted))
                    return Step.Fail(MasterDataFailure.Conflict, "aircraft_type_locked");
            }
            (aircraftTypeId, aircraftSize) = (type.Id, type.SizeCategory);
        }
        else if (aircraftTypeId is { } currentType)
            aircraftSize = await context.AircraftTypes.AsNoTracking().Where(item => item.Id == currentType)
                .Select(item => item.SizeCategory).SingleOrDefaultAsync(cancellationToken);

        // The stand, locked and checked for the new window without the flight's own assignment (3-N10).
        var active = await context.Set<StandAssignment>()
            .SingleOrDefaultAsync(item => item.TurnaroundId == turnaround.Id && item.AssignedTo == null, cancellationToken);
        var currentStand = active is null
            ? null
            : await context.Stands.AsNoTracking().Where(item => item.Id == active.StandId)
                .Select(item => (Guid?)item.PublicId).SingleAsync(cancellationToken);
        long? standId = active?.StandId;
        if ((input.StandId ?? currentStand) is { } targetStand)
        {
            await StandAvailability.LockAsync(context, targetStand, cancellationToken);
            var placement = await StandAvailability.CheckAsync(context, scope.StationId, targetStand, arrivalAt, departureAt,
                aircraftSize, turnaround.Id, cancellationToken);
            if (!placement.Available)
                return Step.Fail(MasterDataFailure.Conflict, "stand_unavailable", placement.Reasons);
            standId = placement.StandId;
        }

        // The assigned agent keeps the flight only if their shift covers the new window and they stay within three
        // simultaneous operations; otherwise OCC releases them first (nothing is released silently).
        if (operation is { CurrentStatus: GroundOperationStatus.Assigned } &&
            await AgentReasonsAsync(scope, operation.Id, arrivalAt, departureAt, cancellationToken) is { Count: > 0 } reasons)
            return Step.Fail(MasterDataFailure.Conflict, "assigned_agent_unavailable", reasons);

        // The audit names airports, aircraft types and stands by their codes, never by internal keys.
        var changes = new List<AuditFieldChangeData>();
        void Track(string field, object? before, object? after)
        {
            var (from, to) = (Text(before), Text(after));
            if (from != to) changes.Add(new AuditFieldChangeData(field, from, to));
        }
        Track("turnaround.arrival_flight", arrival.FlightNumber, arrivalNumber);
        Track("turnaround.arrival_origin", AirportCode(arrival.OriginAirportId), origin);
        Track("turnaround.arrival_scheduled", arrival.ScheduledAt, arrivalAt);
        Track("turnaround.departure_flight", departure.FlightNumber, departureNumber);
        Track("turnaround.departure_destination", AirportCode(departure.DestinationAirportId), destination);
        Track("turnaround.departure_scheduled", departure.ScheduledAt, departureAt);
        Track("turnaround.operation_date", turnaround.OperationDate, operationDate);
        if (turnaround.AircraftTypeId != aircraftTypeId)
        {
            var types = await context.AircraftTypes.AsNoTracking()
                .Where(item => item.Id == turnaround.AircraftTypeId || item.Id == aircraftTypeId)
                .Select(item => new { item.Id, item.IcaoCode }).ToArrayAsync(cancellationToken);
            Track("turnaround.aircraft_type", types.FirstOrDefault(item => item.Id == turnaround.AircraftTypeId)?.IcaoCode,
                types.FirstOrDefault(item => item.Id == aircraftTypeId)?.IcaoCode);
        }
        if (active?.StandId != standId)
            Track("turnaround.stand", await StandCodeAsync(active?.StandId, cancellationToken),
                await StandCodeAsync(standId, cancellationToken));
        if (changes.Count == 0) return Step.Done(turnaround.PublicId);

        (arrival.FlightNumber, arrival.OriginAirportId, arrival.ScheduledAt, arrival.UpdatedAt) =
            (arrivalNumber, originId.Value, arrivalAt, now);
        (departure.FlightNumber, departure.DestinationAirportId, departure.ScheduledAt, departure.UpdatedAt) =
            (departureNumber, destinationId.Value, departureAt, now);
        if (operation is not null)
            (operation.PlannedStartAt, operation.PlannedEndAt, operation.UpdatedAt) = (arrivalAt, departureAt, now);
        (turnaround.OperationDate, turnaround.ContractVersionId, turnaround.AircraftTypeId, turnaround.UpdatedAt) =
            (operationDate, contractVersionId, aircraftTypeId, now);
        // The new window is saved before the stand moves: the covering agent is chosen at the new block time.
        await context.SaveChangesAsync(cancellationToken);
        if (standId is { } target && active?.StandId != target)
        {
            if (active is not null)
            {
                active.AssignedTo = active.AssignedFrom > now ? active.AssignedFrom : now;
                active.UpdatedAt = now;
                await context.SaveChangesAsync(cancellationToken);
            }
            context.Set<StandAssignment>().Add(new StandAssignment
            {
                PublicId = Guid.CreateVersion7(), TurnaroundId = turnaround.Id, StandId = target, AssignedFrom = now,
                AssignedByAccountId = scope.AccountId, Reason = Truncate($"Reprogramada por OCC: {reason}", 500),
                CreatedAt = now, UpdatedAt = now,
            });
            // ADR-0030: the flight follows the agent covering the new stand. Saved before the notice below, so it reaches
            // the agents who keep the flight, never the one the move released (who hears «assignment_released»).
            await CoverageReassignment.FollowStandAsync(context, turnaround.Id, scope.StationId, target, scope.AccountId, now,
                cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
        }
        var changeId = Audit(scope, turnaround, "occ.turnaround.rescheduled", reason, now, [.. changes]);
        if (operation is not null)
            await OperationalNotificationWriter.NotifyAssignedAgentsAsync(context, scope.StationId, operation.Id, changeId,
                "flight_changed", now, scope.AccountId, cancellationToken);
        await AnnounceAsync(scope, turnaround, operation, now, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
        return Step.Done(turnaround.PublicId);
    }

    private async Task<Step> ChangeStatusInsideAsync(Scope scope, TurnaroundStatus outcome, string reason, string expected,
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        var turnaround = await context.Turnarounds.SingleAsync(item => item.Id == scope.TurnaroundId, cancellationToken);
        if (MasterDataCommand.Version(turnaround.RowVersion) != expected)
            return Step.Fail(MasterDataFailure.Conflict, "version_conflict");
        var operation = await context.GroundOperations.FirstOrDefaultAsync(item => item.TurnaroundId == turnaround.Id,
            cancellationToken);
        if (OccTurnaroundRules.BeforeStartFailure(turnaround.CurrentStatus, operation?.CurrentStatus) is { } closed)
            return Step.Fail(MasterDataFailure.Conflict, closed);
        var action = outcome == TurnaroundStatus.Cancelled ? "occ.turnaround.cancelled" : "occ.turnaround.diverted";
        var correlation = Guid.CreateVersion7();
        var operationFrom = operation?.CurrentStatus;

        // The stand is free again for another flight in the same window.
        var stand = await context.Set<StandAssignment>()
            .SingleOrDefaultAsync(item => item.TurnaroundId == turnaround.Id && item.AssignedTo == null, cancellationToken);
        if (stand is not null)
        {
            stand.AssignedTo = stand.AssignedFrom > now ? stand.AssignedFrom : now;
            stand.UpdatedAt = now;
        }
        if (operation is not null)
        {
            // The agents leave through the one release path; their tablet hears «assignment_released».
            var assignments = await context.OperationAgentAssignments
                .Where(item => item.GroundOperationId == operation.Id && item.ReleasedAt == null).ToArrayAsync(cancellationToken);
            await RampAgentRelease.ReleaseOperationAsync(context, operation, assignments, scope.StationId, turnaround.AirlineId,
                scope.AccountId, reason, action, null, correlation, now, cancellationToken, keepStatus: true);
            context.Set<GroundOperationStatusEvent>().Add(new GroundOperationStatusEvent
            {
                GroundOperationId = operation.Id, FromStatus = operation.CurrentStatus, ToStatus = GroundOperationStatus.Cancelled,
                OccurredAt = now, ActorAccountId = scope.AccountId, Reason = reason,
            });
            (operation.CurrentStatus, operation.UpdatedAt) = (GroundOperationStatus.Cancelled, now);
        }
        context.Set<TurnaroundStatusEvent>().Add(new TurnaroundStatusEvent
        {
            TurnaroundId = turnaround.Id, FromStatus = turnaround.CurrentStatus, ToStatus = outcome, OccurredAt = now,
            ActorAccountId = scope.AccountId, Source = OperationalDataSource.Manual, Reason = reason,
        });
        var from = turnaround.CurrentStatus;
        (turnaround.CurrentStatus, turnaround.UpdatedAt) = (outcome, now);

        // A charter with a confirmed or recorded prepayment tells Finance: the refund follows Cobros, never automatic.
        var charter = await context.Set<CharterAgreement>().AsNoTracking().Where(item => item.TurnaroundId == turnaround.Id)
            .Select(item => new { item.PublicId, item.PrepaymentStatus, item.PrepaymentAmount }).SingleOrDefaultAsync(cancellationToken);
        if (charter is not null && (charter.PrepaymentStatus == CharterPrepaymentStatus.Confirmed || charter.PrepaymentAmount > 0))
            await DepartmentNotificationWriter.NotifyAsync(context, Department.Finance, "finance.charters.read", "charter_cancelled",
                charter.PublicId, turnaround.OperationCode, now, cancellationToken, scope.StationId, scope.AccountId);

        Audit(scope, turnaround, action, reason, now,
            new AuditFieldChangeData("turnaround.status", from.ToString(), outcome.ToString()),
            new AuditFieldChangeData("operation.status", operationFrom?.ToString(),
                operation is null ? null : nameof(GroundOperationStatus.Cancelled)),
            new AuditFieldChangeData("turnaround.stand", await StandCodeAsync(stand?.StandId, cancellationToken), null));
        await AnnounceAsync(scope, turnaround, operation, now, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
        return Step.Done(turnaround.PublicId);
    }

    /// <summary>Why the assigned agents cannot keep the rescheduled flight: their shift or the three-operation limit.</summary>
    private async Task<IReadOnlyList<string>> AgentReasonsAsync(Scope scope, long operationId, DateTimeOffset start,
        DateTimeOffset end, CancellationToken cancellationToken)
    {
        var agents = await context.OperationAgentAssignments.AsNoTracking()
            .Where(item => item.GroundOperationId == operationId && item.ReleasedAt == null)
            .Select(item => item.RampAgentId).Distinct().ToArrayAsync(cancellationToken);
        if (agents.Length == 0) return [];
        var zone = BusinessCalendar.Zone(scope.TimeZone);
        var startLocal = TimeZoneInfo.ConvertTime(start, zone).DateTime;
        var endLocal = TimeZoneInfo.ConvertTime(end, zone).DateTime;
        var day = DateOnly.FromDateTime(startLocal);
        var previousDay = day.AddDays(-1);
        var shifts = await context.ShiftAssignments.AsNoTracking()
            .Where(shift => agents.Contains(shift.RampAgentId) && shift.StationId == scope.StationId &&
                (shift.WorkDate == day || shift.WorkDate == previousDay))
            .Select(shift => new { shift.RampAgentId, shift.WorkDate, shift.StartsAtLocal, shift.EndsAtLocal })
            .ToArrayAsync(cancellationToken);
        var reasons = new List<string>();
        if (agents.Any(agent => !shifts.Any(shift => shift.RampAgentId == agent &&
                OccShiftCoveragePolicy.CoversInterval(shift.WorkDate, shift.StartsAtLocal, shift.EndsAtLocal, startLocal,
                    endLocal))))
            reasons.Add("shift_not_covering");
        var overlaps = await AgentSimultaneity.CountOverlapsAsync(context, agents, operationId, start, end, cancellationToken);
        if (agents.Any(agent => overlaps.GetValueOrDefault(agent) >= OperationOccupancyRules.MaxSimultaneousOperations))
            reasons.Add("simultaneous_limit");
        return reasons;
    }

    /// <summary>The turnaround with its version, station and the changes its state allows; null when it is gone.</summary>
    private async Task<OccTurnaroundDetailData?> DetailAsync(Guid turnaroundId)
    {
        var row = await (from turnaround in context.Turnarounds.AsNoTracking()
                         join station in context.Stations.AsNoTracking() on turnaround.StationId equals station.Id
                         where turnaround.PublicId == turnaroundId
                         select new
                         {
                             turnaround.Id, turnaround.CurrentStatus, turnaround.RowVersion, StationId = station.Id,
                             Station = new OccStationData(station.PublicId, station.Code, station.Name, station.IanaTimeZone),
                         }).SingleOrDefaultAsync();
        if (row is null) return null;
        var projected = await EfOccPlanningReadStore.ProjectTurnaroundsAsync(context, row.StationId,
            context.Turnarounds.AsNoTracking().Where(item => item.Id == row.Id), CancellationToken.None);
        if (projected.Length != 1) return null;
        var operation = await context.GroundOperations.AsNoTracking().Where(item => item.TurnaroundId == row.Id)
            .Select(item => new { item.Id, item.CurrentStatus }).FirstOrDefaultAsync();
        var submitted = operation is not null &&
            await context.OperationSubmissions.AsNoTracking().AnyAsync(item => item.GroundOperationId == operation.Id);
        // Only an arrival OCC recorded is corrected; a time the feed reported is not OCC's record (3-N08).
        var arrived = await context.FlightLegs.AsNoTracking().AnyAsync(leg => leg.TurnaroundId == row.Id &&
            leg.Direction == FlightDirection.Arrival && leg.ActualAt != null && leg.Source == OperationalDataSource.Manual);
        var charter = await context.Set<CharterAgreement>().AsNoTracking().AnyAsync(item => item.TurnaroundId == row.Id);
        return new OccTurnaroundDetailData(row.Station, projected[0], MasterDataCommand.Version(row.RowVersion), charter,
            OccTurnaroundRules.AllowedActions(row.CurrentStatus, operation?.CurrentStatus, arrived, submitted));
    }

    private async Task<OccCharterAirlineData?> AirlineAsync(Guid airlineId) =>
        await context.Airlines.AsNoTracking().Where(item => item.PublicId == airlineId)
            .Select(item => new OccCharterAirlineData(item.PublicId, item.IcaoCode, item.IataCode, item.Name))
            .SingleOrDefaultAsync();

    /// <summary>The turnaround in the actor's station scope (404 otherwise, never «not yours»).</summary>
    private async Task<Scope?> ScopeAsync(ActorContext actor, Guid actorId, Guid turnaroundId, CancellationToken cancellationToken)
    {
        var row = await (from turnaround in context.Turnarounds.AsNoTracking()
                         join station in context.Stations.AsNoTracking() on turnaround.StationId equals station.Id
                         join airport in context.Airports.AsNoTracking() on station.AirportId equals airport.Id
                         where turnaround.PublicId == turnaroundId
                         select new { turnaround.Id, StationId = station.Id, station.PublicId, station.IanaTimeZone,
                             AirportIata = airport.IataCode })
            .SingleOrDefaultAsync(cancellationToken);
        if (row is null || !actor.StationScopes.Any(scope => scope.StationId == row.PublicId)) return null;
        return new Scope(row.Id, row.StationId, row.PublicId, row.IanaTimeZone, row.AirportIata,
            await AccountIdAsync(actorId, cancellationToken));
    }

    /// <summary>Audits the change on the turnaround with its reason and changed fields; returns the audit id.</summary>
    private Guid Audit(Scope scope, Turnaround turnaround, string action, string reason, DateTimeOffset now,
        params AuditFieldChangeData[] changes)
    {
        var id = Guid.CreateVersion7();
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = id, OccurredAt = now, ActorType = AuditActorType.Account, ActorAccountId = scope.AccountId,
            Action = action, EntityType = nameof(Turnaround), EntityPublicId = turnaround.PublicId,
            StationId = scope.StationId, Source = AuditSource.Api, CorrelationId = Guid.CreateVersion7(), Reason = reason,
            MetadataJson = SafeAuditChanges.Serialize(changes),
        });
        return id;
    }

    /// <summary>The station's OCC, the operation's tablets and the airline's portal re-read the flight (hints only).</summary>
    private async Task AnnounceAsync(Scope scope, Turnaround turnaround, GroundOperation? operation, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        await OccPlanningChangeWriter.AddForStationAsync(context, scope.StationId, scope.StationPublicId, now, cancellationToken);
        if (operation is null) return;
        await RampOperationChangeWriter.AnnounceAsync(context, operation.Id, now, false, cancellationToken);
        var organizationId = await context.Airlines.AsNoTracking().Where(item => item.Id == turnaround.AirlineId)
            .Select(item => item.OrganizationId).SingleAsync(cancellationToken);
        await AirlineOperationChangeWriter.AddAsync(context, organizationId, operation.PublicId, now, cancellationToken);
    }

    /// <summary>The code of a stand for the audit; null without a stand.</summary>
    private async Task<string?> StandCodeAsync(long? standId, CancellationToken cancellationToken) => standId is { } id
        ? await context.Stands.AsNoTracking().Where(item => item.Id == id).Select(item => item.Code)
            .SingleOrDefaultAsync(cancellationToken)
        : null;

    private static string? Text(object? value) => value switch
    {
        null => null,
        DateTimeOffset instant => instant.ToUniversalTime().ToString("O", System.Globalization.CultureInfo.InvariantCulture),
        DateOnly day => day.ToString("O", System.Globalization.CultureInfo.InvariantCulture),
        _ => Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture),
    };

    private static string Truncate(string value, int length) => value.Length <= length ? value : value[..length];

    private static bool Allowed(ActorContext? actor, string permission) =>
        actor is not null && actor.HasPermission(permission) &&
        actor.Memberships.Any(membership => membership.Kind == MembershipKind.InternalStaff &&
            membership.OrganizationType == OrganizationType.AviamOperator);

    private static MasterDataResult<T> Failed<T>(MasterDataFailure failure, string code) where T : class =>
        MasterDataResult<T>.Failed(failure, code);

    private Task<long> AccountIdAsync(Guid actorId, CancellationToken cancellationToken) =>
        context.Users.AsNoTracking().Where(user => user.PublicId == actorId).Select(user => user.Id)
            .SingleAsync(cancellationToken);

    private DateTimeOffset Now() => Truncate(timeProvider.GetUtcNow());

    private static DateTimeOffset Truncate(DateTimeOffset value)
    {
        var utc = value.ToUniversalTime();
        return new DateTimeOffset(utc.UtcTicks - utc.UtcTicks % TimeSpan.TicksPerMillisecond, TimeSpan.Zero);
    }
}
