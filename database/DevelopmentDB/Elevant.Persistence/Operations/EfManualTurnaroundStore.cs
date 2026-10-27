using System.Data;
using System.Text.Json;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Persistence.Identity;
using Elevant.Infrastructure.Persistence;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Elevant.Persistence.Operations;

/// <summary>Creates a manual flight under live OCC scope and an applicable contract.</summary>
internal sealed class EfManualTurnaroundStore(
    ElevantDbContext context,
    TimeProvider timeProvider) : IManualTurnaroundStore
{
    public async Task<ManualTurnaroundWriteResult> CreateAsync(
        ManualTurnaroundWriteRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        Guid? committedAuditId = null;
        ManualTurnaroundWriteResult? attempt = null;
        try
        {
            return await context.Database.CreateExecutionStrategy().ExecuteInTransactionAsync(
                async token =>
                {
                    context.ChangeTracker.Clear();
                    (attempt, committedAuditId) = await CreateInsideTransactionAsync(request, token);
                    if (!attempt.IsSuccess) context.ChangeTracker.Clear();
                    return attempt;
                },
                async token =>
                {
                    context.ChangeTracker.Clear();
                    if (attempt is null || !attempt.IsSuccess || attempt.Replayed) return attempt is not null;
                    return committedAuditId.HasValue &&
                        await context.AuditEntries.AsNoTracking().AnyAsync(entry =>
                            entry.PublicId == committedAuditId.Value &&
                            entry.Action == "occ.turnaround.created" &&
                            entry.EntityPublicId == request.TurnaroundId, token);
                },
                IsolationLevel.Serializable,
                cancellationToken);
        }
        catch (RetryLimitExceededException exception) when (IsConflict(exception))
        {
            context.ChangeTracker.Clear();
            return ManualTurnaroundWriteResult.Failed(ManualTurnaroundWriteFailure.Conflict);
        }
        catch (DbUpdateException exception) when (IsConflict(exception))
        {
            context.ChangeTracker.Clear();
            return ManualTurnaroundWriteResult.Failed(ManualTurnaroundWriteFailure.Conflict);
        }
        catch (SqlException exception) when (exception.Number is 1205 or 2601 or 2627)
        {
            context.ChangeTracker.Clear();
            return ManualTurnaroundWriteResult.Failed(ManualTurnaroundWriteFailure.Conflict);
        }
    }

    private async Task<(ManualTurnaroundWriteResult Result, Guid? AuditId)> CreateInsideTransactionAsync(
        ManualTurnaroundWriteRequest request, CancellationToken cancellationToken)
    {
        var now = timeProvider.GetUtcNow();
        var actor = await new EfActorContextResolver(context, timeProvider)
            .ResolveAsync(request.ActorAccountId, cancellationToken);
        if (actor is null ||
            !actor.HasPermission("operations.planning.create") ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff) ||
            !actor.StationScopes.Any(scope => scope.StationId == request.StationId) ||
            !request.AllowedStationIds.Contains(request.StationId))
            return (NotFound(), null);

        var scope = await (
            from station in context.Stations.AsNoTracking()
            join airport in context.Airports.AsNoTracking() on station.AirportId equals airport.Id
            join account in context.Users.AsNoTracking() on request.ActorAccountId equals account.PublicId
            where station.PublicId == request.StationId && station.IsActive &&
                  context.AccountStationScopes.AsNoTracking().Any(grant =>
                      grant.AccountId == account.Id && grant.StationId == station.Id &&
                      grant.GrantedAt <= now && grant.RevokedAt == null)
            select new StationScope(station.Id, station.IanaTimeZone, airport.Id,
                airport.IataCode, account.Id))
            .SingleOrDefaultAsync(cancellationToken);
        if (scope is null) return (NotFound(), null);

        var existing = await context.Turnarounds
            .FromSqlInterpolated($"""
                SELECT * FROM [ops].[turnarounds] WITH (UPDLOCK, HOLDLOCK)
                WHERE [public_id] = {request.TurnaroundId}
                """)
            .AsNoTracking()
            .SingleOrDefaultAsync(cancellationToken);
        if (existing is not null)
            return (await ReplayAsync(existing, request, scope, cancellationToken), null);

        var zone = TimeZoneInfo.FindSystemTimeZoneById(scope.TimeZoneId);
        var stationDate = DateOnly.FromDateTime(
            TimeZoneInfo.ConvertTime(request.ArrivalScheduledAt, zone).DateTime);
        if (stationDate != request.OperationDate ||
            string.Equals(scope.AirportIata, request.ArrivalOriginIata, StringComparison.OrdinalIgnoreCase) ||
            string.Equals(scope.AirportIata, request.DepartureDestinationIata, StringComparison.OrdinalIgnoreCase))
            return (Conflict(), null);

        var airline = await context.Airlines.AsNoTracking()
            .Where(item => item.PublicId == request.AirlineId && item.IsActive)
            .Select(item => new { item.Id, item.OrganizationId })
            .SingleOrDefaultAsync(cancellationToken);
        if (airline is null) return (NotFound(), null);

        var applicableContracts = await (
            from contract in context.Contracts.AsNoTracking()
            join version in context.ContractVersions.AsNoTracking()
                on contract.Id equals version.ContractId
            where contract.AirlineId == airline.Id &&
                  contract.Status == ContractStatus.Active &&
                  (contract.SignedOn == null || contract.SignedOn <= request.OperationDate) &&
                  (contract.TerminatedOn == null || contract.TerminatedOn >= request.OperationDate) &&
                  version.Status == ContractVersionStatus.Approved &&
                  version.ValidFrom <= request.OperationDate &&
                  (version.ValidTo == null || version.ValidTo >= request.OperationDate) &&
                  context.Set<ContractVersionStation>().AsNoTracking().Any(link =>
                      link.ContractVersionId == version.Id && link.StationId == scope.StationId)
            select version.Id).Take(2).ToArrayAsync(cancellationToken);
        if (applicableContracts.Length != 1) return (Conflict(), null);

        var stand = await (
            from item in context.Stands.AsNoTracking()
            join terminal in context.Terminals.AsNoTracking()
                on item.TerminalId equals (long?)terminal.Id
            where item.PublicId == request.StandId && item.StationId == scope.StationId &&
                  item.IsActive && terminal.StationId == scope.StationId && terminal.IsActive
            select new { item.Id })
            .SingleOrDefaultAsync(cancellationToken);
        if (stand is null) return (Conflict(), null);
        var standOverlaps = await (
            from assignment in context.Set<StandAssignment>().AsNoTracking()
            join previousOperation in context.GroundOperations.AsNoTracking()
                on assignment.TurnaroundId equals previousOperation.TurnaroundId
            where assignment.StandId == stand.Id && assignment.AssignedTo == null &&
                  previousOperation.CurrentStatus != GroundOperationStatus.Cancelled &&
                  (previousOperation.PlannedStartAt == null ||
                   previousOperation.PlannedEndAt == null ||
                   (previousOperation.PlannedStartAt < request.DepartureScheduledAt &&
                    request.ArrivalScheduledAt < previousOperation.PlannedEndAt))
            select assignment.Id).AnyAsync(cancellationToken);
        if (standOverlaps) return (Conflict(), null);

        var airports = await context.Airports.AsNoTracking()
            .Where(item => item.IataCode == request.ArrivalOriginIata ||
                item.IataCode == request.DepartureDestinationIata)
            .Select(item => new { item.Id, item.IataCode })
            .ToArrayAsync(cancellationToken);
        var origin = airports.SingleOrDefault(item => item.IataCode == request.ArrivalOriginIata);
        var destination = airports.SingleOrDefault(item => item.IataCode == request.DepartureDestinationIata);
        if (origin is null || destination is null) return (Conflict(), null);

        var turnaround = new Turnaround
        {
            PublicId = request.TurnaroundId,
            OperationCode = $"MAN-{request.TurnaroundId:N}",
            AirlineId = airline.Id,
            StationId = scope.StationId,
            OperationDate = request.OperationDate,
            CurrentStatus = TurnaroundStatus.Confirmed,
            Source = OperationalDataSource.Manual,
            CreatedAt = now,
            UpdatedAt = now,
        };
        context.Turnarounds.Add(turnaround);
        await context.SaveChangesAsync(cancellationToken);

        context.FlightLegs.AddRange(
            NewLeg(turnaround.Id, FlightDirection.Arrival, request.ArrivalFlightNumber,
                origin.Id, scope.AirportId, request.ArrivalScheduledAt, now),
            NewLeg(turnaround.Id, FlightDirection.Departure, request.DepartureFlightNumber,
                scope.AirportId, destination.Id, request.DepartureScheduledAt, now));
        context.Set<StandAssignment>().Add(new StandAssignment
        {
            PublicId = Guid.CreateVersion7(),
            TurnaroundId = turnaround.Id,
            StandId = stand.Id,
            AssignedFrom = request.ArrivalScheduledAt,
            AssignedByAccountId = scope.ActorAccountId,
            Reason = "Manual OCC flight entry.",
            CreatedAt = now,
            UpdatedAt = now,
        });
        var operation = new GroundOperation
        {
            PublicId = Guid.CreateVersion7(),
            TurnaroundId = turnaround.Id,
            CurrentStatus = GroundOperationStatus.Planned,
            PlannedStartAt = request.ArrivalScheduledAt,
            PlannedEndAt = request.DepartureScheduledAt,
            CreatedAt = now,
            UpdatedAt = now,
        };
        context.GroundOperations.Add(operation);
        context.Set<TurnaroundStatusEvent>().Add(new TurnaroundStatusEvent
        {
            TurnaroundId = turnaround.Id,
            FromStatus = null,
            ToStatus = TurnaroundStatus.Confirmed,
            OccurredAt = now,
            ActorAccountId = scope.ActorAccountId,
            Source = OperationalDataSource.Manual,
            Reason = "Manual OCC flight entry.",
        });
        var audit = new AuditEntry
        {
            PublicId = Guid.CreateVersion7(),
            OccurredAt = now,
            ActorType = AuditActorType.Account,
            ActorAccountId = scope.ActorAccountId,
            Action = "occ.turnaround.created",
            EntityType = nameof(Turnaround),
            EntityPublicId = request.TurnaroundId,
            OrganizationId = airline.OrganizationId,
            StationId = scope.StationId,
            Source = AuditSource.Api,
            CorrelationId = request.CorrelationId,
            RequestId = request.RequestId,
            Reason = "Manual OCC flight entry.",
            MetadataJson = JsonSerializer.Serialize(new
            {
                source = "manual",
                standId = request.StandId,
                operationDate = request.OperationDate,
                arrivalFlightNumber = request.ArrivalFlightNumber,
                departureFlightNumber = request.DepartureFlightNumber,
            }),
        };
        context.AuditEntries.Add(audit);
        await context.SaveChangesAsync(cancellationToken);

        context.Set<GroundOperationStatusEvent>().Add(new GroundOperationStatusEvent
        {
            GroundOperationId = operation.Id,
            FromStatus = null,
            ToStatus = GroundOperationStatus.Planned,
            OccurredAt = now,
            ActorAccountId = scope.ActorAccountId,
            Reason = "Created with manual OCC flight.",
        });
        await AirlineOperationChangeWriter.AddAsync(context,
            airline.OrganizationId, operation.PublicId, now, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);

        return (ManualTurnaroundWriteResult.Created(turnaround.PublicId, turnaround.OperationCode),
            audit.PublicId);
    }

    private async Task<ManualTurnaroundWriteResult> ReplayAsync(
        Turnaround existing, ManualTurnaroundWriteRequest request, StationScope scope,
        CancellationToken cancellationToken)
    {
        if (existing.StationId != scope.StationId || existing.Source != OperationalDataSource.Manual)
            return NotFound();
        var airlineId = await context.Airlines.AsNoTracking()
            .Where(item => item.Id == existing.AirlineId)
            .Select(item => item.PublicId)
            .SingleAsync(cancellationToken);
        var legs = await (
            from leg in context.FlightLegs.AsNoTracking()
            join origin in context.Airports.AsNoTracking() on leg.OriginAirportId equals origin.Id
            join destination in context.Airports.AsNoTracking() on leg.DestinationAirportId equals destination.Id
            where leg.TurnaroundId == existing.Id
            select new { leg.Direction, leg.FlightNumber, leg.ScheduledAt,
                OriginIata = origin.IataCode, DestinationIata = destination.IataCode })
            .ToArrayAsync(cancellationToken);
        var assignedStandId = await (
            from assignment in context.Set<StandAssignment>().AsNoTracking()
            join stand in context.Stands.AsNoTracking() on assignment.StandId equals stand.Id
            where assignment.TurnaroundId == existing.Id && assignment.AssignedTo == null
            select (Guid?)stand.PublicId).SingleOrDefaultAsync(cancellationToken);
        var arrival = legs.SingleOrDefault(item => item.Direction == FlightDirection.Arrival);
        var departure = legs.SingleOrDefault(item => item.Direction == FlightDirection.Departure);
        return airlineId == request.AirlineId && assignedStandId == request.StandId &&
            existing.OperationDate == request.OperationDate &&
            arrival is not null && departure is not null &&
            arrival.FlightNumber == request.ArrivalFlightNumber &&
            arrival.OriginIata == request.ArrivalOriginIata &&
            arrival.DestinationIata == scope.AirportIata &&
            arrival.ScheduledAt == request.ArrivalScheduledAt &&
            departure.FlightNumber == request.DepartureFlightNumber &&
            departure.OriginIata == scope.AirportIata &&
            departure.DestinationIata == request.DepartureDestinationIata &&
            departure.ScheduledAt == request.DepartureScheduledAt
                ? ManualTurnaroundWriteResult.Existing(existing.PublicId, existing.OperationCode)
                : Conflict();
    }

    private static FlightLeg NewLeg(long turnaroundId, FlightDirection direction,
        string flightNumber, long originId, long destinationId,
        DateTimeOffset scheduledAt, DateTimeOffset now) => new()
    {
        PublicId = Guid.CreateVersion7(),
        TurnaroundId = turnaroundId,
        Direction = direction,
        FlightNumber = flightNumber,
        OriginAirportId = originId,
        DestinationAirportId = destinationId,
        ScheduledAt = scheduledAt,
        Source = OperationalDataSource.Manual,
        CreatedAt = now,
        UpdatedAt = now,
    };

    private static ManualTurnaroundWriteResult NotFound() =>
        ManualTurnaroundWriteResult.Failed(ManualTurnaroundWriteFailure.NotFound);

    private static ManualTurnaroundWriteResult Conflict() =>
        ManualTurnaroundWriteResult.Failed(ManualTurnaroundWriteFailure.Conflict);

    private static bool IsConflict(Exception exception) =>
        exception is SqlException sql && sql.Number is 1205 or 2601 or 2627 ||
        exception.InnerException is not null && IsConflict(exception.InnerException);

    private sealed record StationScope(long StationId, string TimeZoneId,
        long AirportId, string AirportIata, long ActorAccountId);
}
