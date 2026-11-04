using System.Text.RegularExpressions;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>
/// Stand occupancy projected from the active stand assignments and the actual arrival time of each
/// turnaround. OCC records the arrival and assigns, reassigns or releases stands; every change is
/// audited and announced to the station's OCC through <c>occ_planning</c>.
/// </summary>
internal sealed partial class EfOccPositionStore(ElevantDbContext context, IActorContextResolver actors,
    TimeProvider timeProvider) : IOccPositionStore
{
    private const string ReadPermission = "operations.positions_map.read";
    private const string AssignPermission = "operations.positions_map.assign";

    [GeneratedRegex("^[A-Z0-9-]{2,10}$")]
    private static partial Regex Registration();

    private sealed record Context(ActorContext Actor, long AccountId, long TurnaroundId, long StationId, Guid StationPublicId,
        DateOnly OperationDate, Turnaround Turnaround);

    public async Task<OccPositionResult> ReadAsync(Guid actorId, Guid stationId, DateOnly operationDate,
        CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, ReadPermission) || !actor!.StationScopes.Any(scope => scope.StationId == stationId))
            return new(null, OccPositionFailure.Forbidden);
        var station = await context.Stations.AsNoTracking().Where(item => item.PublicId == stationId && item.IsActive)
            .Select(item => new { item.Id, item.Code }).SingleOrDefaultAsync(cancellationToken);
        if (station is null) return new(null, OccPositionFailure.NotFound);
        return new(await BoardAsync(station.Id, stationId, station.Code, operationDate, actor.HasPermission(AssignPermission),
            cancellationToken), null);
    }

    public async Task<OccPositionResult> LocateStandAsync(Guid actorId, Guid standId, decimal? latitude, decimal? longitude,
        DateOnly operationDate, CancellationToken cancellationToken = default)
    {
        if (latitude is null != longitude is null || latitude is < -90 or > 90 || longitude is < -180 or > 180)
            return new(null, OccPositionFailure.Invalid);
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, AssignPermission)) return new(null, OccPositionFailure.Forbidden);
        var row = await (from stand in context.Stands
                         // Tracked: an AsNoTracking source would make the whole query untracked.
                         join station in context.Stations on stand.StationId equals station.Id
                         where stand.PublicId == standId && stand.IsActive && station.IsActive
                         select new { Stand = stand, station.PublicId, station.Code }).SingleOrDefaultAsync(cancellationToken);
        if (row is null) return new(null, OccPositionFailure.NotFound);
        if (!actor!.StationScopes.Any(scope => scope.StationId == row.PublicId)) return new(null, OccPositionFailure.Forbidden);
        var now = Now();
        row.Stand.Latitude = latitude is { } lat ? Math.Round(lat, 6) : null;
        row.Stand.Longitude = longitude is { } lon ? Math.Round(lon, 6) : null;
        row.Stand.LocatedAt = latitude is null ? null : now;
        row.Stand.UpdatedAt = now;
        var accountId = await context.Users.AsNoTracking().Where(user => user.PublicId == actorId)
            .Select(user => user.Id).SingleAsync(cancellationToken);
        context.AuditEntries.Add(new Domain.Entities.Audit.AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = now, ActorType = AuditActorType.Account, ActorAccountId = accountId,
            Source = AuditSource.Api, CorrelationId = standId, Action = "occ.stand.located", EntityType = "ref.stands",
            EntityPublicId = standId, StationId = row.Stand.StationId,
        });
        await OccPlanningChangeWriter.AddForStationAsync(context, row.Stand.StationId, row.PublicId, now, cancellationToken);
        try
        {
            await context.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return new(null, OccPositionFailure.Conflict);
        }
        return new(await BoardAsync(row.Stand.StationId, row.PublicId, row.Code, operationDate,
            actor.HasPermission(AssignPermission), cancellationToken), null);
    }

    public async Task<OccPositionResult> RecordArrivalAsync(Guid actorId, Guid turnaroundId, RecordArrivalInput input,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        var registration = input.AircraftRegistration?.Trim().ToUpperInvariant();
        if (registration is null || !Registration().IsMatch(registration)) return new(null, OccPositionFailure.Invalid);
        var scope = await ScopeAsync(actorId, turnaroundId, cancellationToken);
        if (scope.Failure is { } failure) return new(null, failure);
        var current = scope.Context!;
        var now = Now();
        var arrivedAt = input.ArrivedAt?.ToUniversalTime() ?? now;
        // An arrival cannot be in the future nor days before the operation.
        if (arrivedAt > now.AddMinutes(5) || DateOnly.FromDateTime(arrivedAt.UtcDateTime) < current.OperationDate.AddDays(-1))
            return new(null, OccPositionFailure.Invalid);
        if (current.Turnaround.CurrentStatus is TurnaroundStatus.Cancelled or TurnaroundStatus.Diverted or TurnaroundStatus.Completed)
            return new(null, OccPositionFailure.Conflict);
        var leg = await context.FlightLegs.SingleOrDefaultAsync(item => item.TurnaroundId == current.TurnaroundId &&
            item.Direction == FlightDirection.Arrival, cancellationToken);
        if (leg is null) return new(null, OccPositionFailure.Conflict);
        leg.ActualAt = Truncate(arrivedAt);
        leg.UpdatedAt = now;
        current.Turnaround.AircraftRegistration = registration;
        current.Turnaround.UpdatedAt = now;
        if (current.Turnaround.CurrentStatus is TurnaroundStatus.Scheduled or TurnaroundStatus.Confirmed)
        {
            context.Set<TurnaroundStatusEvent>().Add(new TurnaroundStatusEvent
            {
                TurnaroundId = current.TurnaroundId, FromStatus = current.Turnaround.CurrentStatus,
                ToStatus = TurnaroundStatus.InProgress, OccurredAt = now, ActorAccountId = current.AccountId,
                Source = OperationalDataSource.Manual, Reason = "Llegada registrada por OCC.",
            });
            current.Turnaround.CurrentStatus = TurnaroundStatus.InProgress;
        }
        return await SaveAsync(current, "occ.turnaround.arrived", $"{registration} {leg.ActualAt:O}", cancellationToken);
    }

    public async Task<OccPositionResult> AssignAsync(Guid actorId, Guid turnaroundId, Guid standId, string? reason,
        CancellationToken cancellationToken = default)
    {
        var note = reason?.Trim();
        if (note is { Length: > 500 }) return new(null, OccPositionFailure.Invalid);
        var scope = await ScopeAsync(actorId, turnaroundId, cancellationToken);
        if (scope.Failure is { } failure) return new(null, failure);
        var current = scope.Context!;
        if (current.Turnaround.CurrentStatus is TurnaroundStatus.Cancelled or TurnaroundStatus.Diverted or TurnaroundStatus.Completed)
            return new(null, OccPositionFailure.Conflict);
        var stand = await context.Stands.AsNoTracking()
            .Where(item => item.PublicId == standId && item.StationId == current.StationId && item.IsActive)
            .Select(item => new { item.Id, item.Code, item.MaxAircraftSize }).SingleOrDefaultAsync(cancellationToken);
        if (stand is null) return new(null, OccPositionFailure.NotFound);
        var window = await context.GroundOperations.AsNoTracking().Where(item => item.TurnaroundId == current.TurnaroundId)
            .Select(item => new { item.PlannedStartAt, item.PlannedEndAt }).FirstOrDefaultAsync(cancellationToken);
        // Combined stands (ADR-0030): an impossible combination is rejected with the rule it breaks.
        var occupied = await (from assignment in context.Set<StandAssignment>().AsNoTracking()
                              join operation in context.GroundOperations.AsNoTracking() on assignment.TurnaroundId equals operation.TurnaroundId
                              join parked in context.Stands.AsNoTracking() on assignment.StandId equals parked.Id
                              join turnaround in context.Turnarounds.AsNoTracking() on assignment.TurnaroundId equals turnaround.Id
                              from type in context.AircraftTypes.AsNoTracking().Where(type => type.Id == turnaround.AircraftTypeId).DefaultIfEmpty()
                              where parked.StationId == current.StationId && assignment.AssignedTo == null &&
                                    assignment.TurnaroundId != current.TurnaroundId &&
                                    operation.CurrentStatus != GroundOperationStatus.Cancelled &&
                                    (window == null || window.PlannedStartAt == null || window.PlannedEndAt == null ||
                                     operation.PlannedStartAt == null || operation.PlannedEndAt == null ||
                                     (operation.PlannedStartAt < window.PlannedEndAt && window.PlannedStartAt < operation.PlannedEndAt))
                              select new { parked.Id, parked.Code, Size = type == null ? null : type.SizeCategory })
            .ToArrayAsync(cancellationToken);
        var rules = await context.Set<StandConstraint>().AsNoTracking()
            .Where(item => item.StationId == current.StationId && item.IsActive)
            .Select(item => new { item.StandId, item.AffectedStandId, item.Kind }).ToArrayAsync(cancellationToken);
        var aircraftSize = current.Turnaround.AircraftTypeId is { } aircraftTypeId
            ? await context.AircraftTypes.AsNoTracking().Where(item => item.Id == aircraftTypeId)
                .Select(item => item.SizeCategory).SingleOrDefaultAsync(cancellationToken)
            : null;
        var broken = StandConstraintPolicy.Evaluate(new StandPlacement(stand.Id, stand.Code, stand.MaxAircraftSize, aircraftSize),
            occupied.Select(item => new OccupiedStand(item.Id, item.Code, item.Size)).ToArray(),
            rules.Select(item => new StandRule(item.StandId, item.AffectedStandId, item.Kind)).ToArray());
        if (broken.Count > 0) return new(null, OccPositionFailure.Conflict, broken);
        // Same rule as manual planning: no other active assignment whose window overlaps this one.
        var overlaps = await (from assignment in context.Set<StandAssignment>().AsNoTracking()
                              join operation in context.GroundOperations.AsNoTracking() on assignment.TurnaroundId equals operation.TurnaroundId
                              where assignment.StandId == stand.Id && assignment.AssignedTo == null &&
                                    assignment.TurnaroundId != current.TurnaroundId &&
                                    operation.CurrentStatus != GroundOperationStatus.Cancelled &&
                                    (window == null || window.PlannedStartAt == null || window.PlannedEndAt == null ||
                                     operation.PlannedStartAt == null || operation.PlannedEndAt == null ||
                                     (operation.PlannedStartAt < window.PlannedEndAt && window.PlannedStartAt < operation.PlannedEndAt))
                              select assignment.Id).AnyAsync(cancellationToken);
        if (overlaps) return new(null, OccPositionFailure.Conflict);
        var now = Now();
        var active = await context.Set<StandAssignment>()
            .SingleOrDefaultAsync(item => item.TurnaroundId == current.TurnaroundId && item.AssignedTo == null, cancellationToken);
        if (active?.StandId == stand.Id) return new(await BoardFor(current, cancellationToken), null);
        // Closing the previous assignment and opening the new one commit together: one active
        // assignment per turnaround is a filtered unique index.
        return await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
            if (active is not null)
            {
                active.AssignedTo = Max(now, active.AssignedFrom);
                active.UpdatedAt = now;
                try
                {
                    await context.SaveChangesAsync(cancellationToken);
                }
                catch (DbUpdateException)
                {
                    context.ChangeTracker.Clear();
                    return new OccPositionResult(null, OccPositionFailure.Conflict);
                }
            }
            context.Set<StandAssignment>().Add(new StandAssignment
            {
                PublicId = Guid.CreateVersion7(), TurnaroundId = current.TurnaroundId, StandId = stand.Id,
                AssignedFrom = now, AssignedByAccountId = current.AccountId,
                Reason = string.IsNullOrEmpty(note) ? (active is null ? "Asignada por OCC." : "Reasignada por OCC.") : note,
                CreatedAt = now, UpdatedAt = now,
            });
            // The flight follows the agent covering the new stand (ADR-0030).
            await CoverageReassignment.FollowStandAsync(context, current.TurnaroundId, current.StationId, stand.Id,
                current.AccountId, now, cancellationToken);
            var result = await SaveAsync(current, active is null ? "occ.stand.assigned" : "occ.stand.reassigned",
                stand.Code, cancellationToken, commit: transaction);
            return result;
        });
    }

    public async Task<OccPositionResult> ReleaseAsync(Guid actorId, Guid turnaroundId, CancellationToken cancellationToken = default)
    {
        var scope = await ScopeAsync(actorId, turnaroundId, cancellationToken);
        if (scope.Failure is { } failure) return new(null, failure);
        var current = scope.Context!;
        var active = await context.Set<StandAssignment>()
            .SingleOrDefaultAsync(item => item.TurnaroundId == current.TurnaroundId && item.AssignedTo == null, cancellationToken);
        if (active is null) return new(await BoardFor(current, cancellationToken), null);
        var now = Now();
        active.AssignedTo = Max(now, active.AssignedFrom);
        active.UpdatedAt = now;
        return await SaveAsync(current, "occ.stand.released", null, cancellationToken);
    }

    private static bool Allowed(ActorContext? actor, string permission) =>
        actor is not null && actor.HasPermission(permission) &&
        actor.Memberships.Any(membership => membership.Kind == MembershipKind.InternalStaff &&
            membership.OrganizationType == OrganizationType.AviamOperator);

    private DateTimeOffset Now() => Truncate(timeProvider.GetUtcNow());

    private static DateTimeOffset Truncate(DateTimeOffset value) =>
        new(value.UtcTicks - value.UtcTicks % TimeSpan.TicksPerMillisecond, TimeSpan.Zero);

    private static DateTimeOffset Max(DateTimeOffset left, DateTimeOffset right) => left > right ? left : right;

    private async Task<(Context? Context, OccPositionFailure? Failure)> ScopeAsync(Guid actorId, Guid turnaroundId,
        CancellationToken cancellationToken)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, AssignPermission)) return (null, OccPositionFailure.Forbidden);
        var turnaround = await context.Turnarounds.SingleOrDefaultAsync(item => item.PublicId == turnaroundId, cancellationToken);
        if (turnaround is null) return (null, OccPositionFailure.NotFound);
        var station = await context.Stations.AsNoTracking().Where(item => item.Id == turnaround.StationId)
            .Select(item => new { item.PublicId }).SingleAsync(cancellationToken);
        if (!actor!.StationScopes.Any(scope => scope.StationId == station.PublicId)) return (null, OccPositionFailure.NotFound);
        var accountId = await context.Users.AsNoTracking().Where(user => user.PublicId == actorId)
            .Select(user => user.Id).SingleAsync(cancellationToken);
        return (new Context(actor, accountId, turnaround.Id, turnaround.StationId, station.PublicId, turnaround.OperationDate,
            turnaround), null);
    }

    private async Task<OccPositionResult> SaveAsync(Context current, string action, string? reason,
        CancellationToken cancellationToken, Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction? commit = null)
    {
        var now = Now();
        // Each change has its own audit id, so a flight moved twice notifies twice (notices are unique per source).
        var changeId = Guid.CreateVersion7();
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = changeId, OccurredAt = now, ActorType = AuditActorType.Account,
            ActorAccountId = current.AccountId, Action = action, EntityType = nameof(Turnaround),
            EntityPublicId = current.Turnaround.PublicId, StationId = current.StationId, Source = AuditSource.Api,
            CorrelationId = Guid.CreateVersion7(), Reason = reason,
        });
        await OccPlanningChangeWriter.AddForStationAsync(context, current.StationId, current.StationPublicId, now, cancellationToken);
        // ADR-0029: the assigned agent learns at once when the airport moves the flight to another stand.
        var operationId = await context.GroundOperations.AsNoTracking().Where(item => item.TurnaroundId == current.TurnaroundId)
            .Select(item => (long?)item.Id).FirstOrDefaultAsync(cancellationToken);
        if (operationId is { } groundOperationId)
        {
            await RampOperationChangeWriter.AnnounceAsync(context, groundOperationId, now, false, cancellationToken);
            if (action != "occ.turnaround.arrived")
                await OperationalNotificationWriter.NotifyAssignedAgentsAsync(context, current.StationId, groundOperationId,
                    changeId, "flight_changed", now, current.AccountId, cancellationToken);
        }
        try
        {
            await context.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return new(null, OccPositionFailure.Conflict);
        }
        catch (DbUpdateException)
        {
            // The filtered unique index allows one active assignment per turnaround.
            context.ChangeTracker.Clear();
            return new(null, OccPositionFailure.Conflict);
        }
        if (commit is not null) await commit.CommitAsync(cancellationToken);
        return new(await BoardFor(current, cancellationToken), null);
    }

    private async Task<OccPositionBoardData> BoardFor(Context current, CancellationToken cancellationToken)
    {
        var code = await context.Stations.AsNoTracking().Where(item => item.Id == current.StationId)
            .Select(item => item.Code).SingleAsync(cancellationToken);
        return await BoardAsync(current.StationId, current.StationPublicId, code, current.OperationDate, true, cancellationToken);
    }

    private async Task<OccPositionBoardData> BoardAsync(long stationId, Guid stationPublicId, string stationCode,
        DateOnly operationDate, bool canAssign, CancellationToken cancellationToken)
    {
        var stands = await (from stand in context.Stands.AsNoTracking()
                            join terminal in context.Terminals.AsNoTracking() on stand.TerminalId equals (long?)terminal.Id into terminals
                            from terminal in terminals.DefaultIfEmpty()
                            where stand.StationId == stationId && stand.IsActive
                            orderby stand.Code
                            select new { stand.Id, stand.PublicId, stand.Code, Terminal = terminal == null ? null : terminal.Code, stand.StandType,
                                stand.Latitude, stand.Longitude, stand.HasBoardingBridge, stand.IsRemote, stand.MaxAircraftSize })
            .ToArrayAsync(cancellationToken);
        var rules = (await context.Set<StandConstraint>().AsNoTracking()
                .Where(item => item.StationId == stationId && item.IsActive)
                .Select(item => new { item.StandId, item.AffectedStandId, item.Kind }).ToArrayAsync(cancellationToken))
            .Select(item => new StandRule(item.StandId, item.AffectedStandId, item.Kind)).ToArray();
        var zone = TimeZoneInfo.FindSystemTimeZoneById(await context.Stations.AsNoTracking().Where(item => item.Id == stationId)
            .Select(item => item.IanaTimeZone).SingleAsync(cancellationToken));
        var dayStart = new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(operationDate.ToDateTime(TimeOnly.MinValue), zone), TimeSpan.Zero);
        var dayEnd = dayStart.AddDays(1);
        var coverage = (await (from item in context.Set<PositionCoverage>().AsNoTracking()
                               join coveredStand in context.Set<PositionCoverageStand>().AsNoTracking() on item.Id equals coveredStand.PositionCoverageId
                               join agent in context.RampAgents.AsNoTracking() on item.RampAgentId equals agent.Id
                               join person in context.Persons.AsNoTracking() on agent.PersonId equals person.Id
                               where item.StationId == stationId && item.ReleasedAt == null && item.StartsAt < dayEnd && dayStart < item.EndsAt
                               select new { coveredStand.StandId, Name = (person.FirstName + " " + person.LastName).Trim() })
                .ToArrayAsync(cancellationToken))
            .ToLookup(item => item.StandId, item => item.Name);
        // The day's turnarounds plus any aircraft still parked from an earlier day.
        var turnarounds = await (from turnaround in context.Turnarounds.AsNoTracking()
                                 join airline in context.Airlines.AsNoTracking() on turnaround.AirlineId equals airline.Id
                                 where turnaround.StationId == stationId &&
                                       turnaround.CurrentStatus != TurnaroundStatus.Cancelled &&
                                       (turnaround.OperationDate == operationDate ||
                                        context.Set<StandAssignment>().Any(item => item.TurnaroundId == turnaround.Id && item.AssignedTo == null &&
                                            turnaround.OperationDate < operationDate && turnaround.CurrentStatus == TurnaroundStatus.InProgress))
                                 select new { turnaround.Id, turnaround.PublicId, turnaround.OperationCode, Airline = airline.Name,
                                     turnaround.AircraftRegistration, turnaround.CurrentStatus })
            .ToArrayAsync(cancellationToken);
        var ids = turnarounds.Select(item => item.Id).ToArray();
        var legs = (await context.FlightLegs.AsNoTracking().Where(item => ids.Contains(item.TurnaroundId))
                .Select(item => new { item.TurnaroundId, item.Direction, item.FlightNumber, item.ScheduledAt, item.ActualAt })
                .ToArrayAsync(cancellationToken))
            .ToLookup(item => item.TurnaroundId);
        var assignments = await context.Set<StandAssignment>().AsNoTracking()
            .Where(item => ids.Contains(item.TurnaroundId) && item.AssignedTo == null)
            .Select(item => new { item.TurnaroundId, item.StandId, item.AssignedFrom }).ToArrayAsync(cancellationToken);
        var assignmentOf = assignments.ToDictionary(item => item.TurnaroundId);

        OccPositionTurnaroundData Map(long id)
        {
            var turnaround = turnarounds.Single(item => item.Id == id);
            var arrival = legs[id].FirstOrDefault(item => item.Direction == FlightDirection.Arrival);
            var departure = legs[id].FirstOrDefault(item => item.Direction == FlightDirection.Departure);
            return new OccPositionTurnaroundData(turnaround.PublicId, turnaround.OperationCode, turnaround.Airline,
                turnaround.AircraftRegistration, arrival?.FlightNumber, departure?.FlightNumber, arrival?.ScheduledAt,
                arrival?.ActualAt, departure?.ScheduledAt, assignmentOf.GetValueOrDefault(id)?.AssignedFrom,
                turnaround.CurrentStatus.ToString());
        }

        var occupiedNow = assignments.Select(item => new OccupiedStand(item.StandId,
            stands.FirstOrDefault(stand => stand.Id == item.StandId)?.Code ?? "", null)).ToArray();
        var cancelled = StandConstraintPolicy.CancelledStands(occupiedNow, rules);
        var limited = StandConstraintPolicy.NarrowbodyLimited(occupiedNow, rules);
        var positions = stands.Select(stand =>
        {
            var parked = assignments.Where(item => item.StandId == stand.Id).Select(item => Map(item.TurnaroundId))
                .OrderBy(item => item.ArrivalScheduledAt).ToArray();
            var status = parked.Any(item => item.ArrivedAt is not null) ? "occupied" : parked.Length > 0 ? "planned" : "available";
            return new OccPositionData(stand.PublicId, stand.Code, stand.Terminal, stand.StandType, status, parked,
                stand.Latitude, stand.Longitude, stand.HasBoardingBridge, stand.IsRemote, stand.MaxAircraftSize?.ToString(),
                cancelled.GetValueOrDefault(stand.Id),
                stand.MaxAircraftSize == AircraftSizeCategory.Narrowbody || limited.Contains(stand.Id),
                coverage[stand.Id].Distinct().ToArray());
        }).ToArray();
        var unassigned = turnarounds.Where(item => !assignmentOf.ContainsKey(item.Id) &&
                item.CurrentStatus is not (TurnaroundStatus.Completed or TurnaroundStatus.Diverted))
            .Select(item => Map(item.Id)).OrderBy(item => item.ArrivalScheduledAt).ToArray();
        return new OccPositionBoardData(stationPublicId, stationCode, operationDate, timeProvider.GetUtcNow(), positions,
            unassigned, canAssign);
    }
}
