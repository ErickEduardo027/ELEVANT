using System.Data;
using System.Text.RegularExpressions;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Common;
using Elevant.Application.Identity;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Commercial;
using Elevant.Persistence.Integration;
using Elevant.Persistence.Realtime;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Elevant.Persistence.Operations;

/// <summary>
/// Stand occupancy projected from the active stand assignments and the actual arrival time of each
/// turnaround, until the tablet records its push-back (owner decision 23: the aircraft left, while its assignment
/// stays open). OCC records (or corrects, with a reason) the arrival and assigns, reassigns or releases
/// stands; every change is audited and announced to the station's OCC through <c>occ_planning</c>. The
/// three commands run in one serializable transaction with the stand locked, take an optional
/// Idempotency-Key and the turnaround version (3-N10), and fail with a stable code.
/// </summary>
internal sealed partial class EfOccPositionStore(ElevantDbContext context, IActorContextResolver actors,
    TimeProvider timeProvider) : IOccPositionStore
{
    private const string ReadPermission = "operations.positions_map.read";
    private const string AssignPermission = "operations.positions_map.assign";

    [GeneratedRegex("^[A-Z0-9-]{2,10}$")]
    private static partial Regex Registration();

    private const string ArrivalAction = "occ.turnaround.arrival";
    private const string AssignAction = "occ.stand.assign";
    private const string ReleaseAction = "occ.stand.release";

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
        OccPositionCommand command, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(command);
        var registration = input.AircraftRegistration?.Trim().ToUpperInvariant();
        if (registration is null || !Registration().IsMatch(registration) || input.AircraftTypeId == Guid.Empty)
            return Failed(OccPositionFailure.Invalid, "invalid_position_request");
        var requestedAt = input.ArrivedAt is { } value ? Truncate(value.ToUniversalTime()) : (DateTimeOffset?)null;
        var note = input.Reason?.Trim();
        var payload = new { turnaroundId, registration, arrivedAt = requestedAt, input.AircraftTypeId, reason = note };
        return await RunAsync(actorId, turnaroundId, command, ArrivalAction, payload, async (current, now) =>
        {
            var arrivedAt = requestedAt ?? now;
            // An arrival cannot be in the future nor days before the operation.
            if (arrivedAt > now.AddMinutes(5) || DateOnly.FromDateTime(arrivedAt.UtcDateTime) < current.OperationDate.AddDays(-1))
                return Outcome.Fail(OccPositionFailure.Invalid, "invalid_position_request");
            var turnaround = current.Turnaround;
            if (OccTurnaroundRules.IsClosed(turnaround.CurrentStatus))
                return Outcome.Fail(OccPositionFailure.Conflict, "turnaround_closed");
            var leg = await context.FlightLegs.SingleOrDefaultAsync(item => item.TurnaroundId == current.TurnaroundId &&
                item.Direction == FlightDirection.Arrival, cancellationToken);
            if (leg is null) return Outcome.Fail(OccPositionFailure.Conflict, "invalid_position_request");
            var operation = await context.GroundOperations.AsNoTracking().Where(item => item.TurnaroundId == current.TurnaroundId)
                .Select(item => new { item.Id, item.CurrentStatus, item.PlannedStartAt, item.PlannedEndAt })
                .FirstOrDefaultAsync(cancellationToken);
            var submitted = operation is not null && await context.OperationSubmissions.AsNoTracking()
                .AnyAsync(item => item.GroundOperationId == operation.Id, cancellationToken);
            // 3-N08: from the first submission the arrival is evidence, whoever wrote it (OCC or the flight feed) and even
            // when the leg has no time yet: DELAY and the close were priced with it.
            if (!OccTurnaroundRules.CanCorrectArrival(turnaround.CurrentStatus, operation?.CurrentStatus, submitted))
                return Outcome.Fail(OccPositionFailure.Conflict, "arrival_locked");
            // Before it, a time already on the leg is replaced with its reason: OCC's record always, the feed's when OCC
            // records another one. The leg's first time, or the feed's kept as it is, needs none.
            var recordedAt = Truncate(arrivedAt);
            var previous = leg.ActualAt;
            string? reason = null;
            if (OccTurnaroundRules.ArrivalNeedsReason(previous, leg.Source == OperationalDataSource.Manual, recordedAt))
            {
                reason = OccTurnaroundRules.Reason(note);
                if (reason is null) return Outcome.Fail(OccPositionFailure.Invalid, "reason_required");
            }
            // 3-B: the aircraft type seen on arrival, typed once; frozen from the first submission.
            if (input.AircraftTypeId is { } typeId)
            {
                var type = await context.AircraftTypes.AsNoTracking().Where(item => item.PublicId == typeId)
                    .Select(item => new { item.Id, item.IsActive, item.SizeCategory }).SingleOrDefaultAsync(cancellationToken);
                if (type is null || (!type.IsActive && type.Id != turnaround.AircraftTypeId))
                    return Outcome.Fail(OccPositionFailure.Conflict, "aircraft_type_unavailable");
                if (type.Id != turnaround.AircraftTypeId)
                {
                    if (OccTurnaroundRules.IsAircraftTypeLocked(operation?.CurrentStatus, submitted))
                        return Outcome.Fail(OccPositionFailure.Conflict, "aircraft_type_locked");
                    var reasons = await StandAvailability.SizeReasonsAsync(context, current.StationId, current.TurnaroundId,
                        operation?.PlannedStartAt, operation?.PlannedEndAt, type.SizeCategory, cancellationToken);
                    if (reasons.Count > 0) return Outcome.Fail(OccPositionFailure.Conflict, "stand_unavailable", reasons);
                    turnaround.AircraftTypeId = type.Id;
                }
            }
            leg.ActualAt = recordedAt;
            // OCC's time prevails: the feed no longer rewrites this leg's actual time.
            leg.Source = OperationalDataSource.Manual;
            leg.UpdatedAt = now;
            turnaround.AircraftRegistration = registration;
            turnaround.UpdatedAt = now;
            if (turnaround.CurrentStatus is TurnaroundStatus.Scheduled or TurnaroundStatus.Confirmed)
            {
                context.Set<TurnaroundStatusEvent>().Add(new TurnaroundStatusEvent
                {
                    TurnaroundId = current.TurnaroundId, FromStatus = turnaround.CurrentStatus,
                    ToStatus = TurnaroundStatus.InProgress, OccurredAt = now, ActorAccountId = current.AccountId,
                    Source = OperationalDataSource.Manual, Reason = "Llegada registrada por OCC.",
                });
                turnaround.CurrentStatus = TurnaroundStatus.InProgress;
            }
            return reason is null
                ? await AnnounceAsync(current, "occ.turnaround.arrived", $"{registration} {leg.ActualAt:O}", now, cancellationToken)
                : await AnnounceAsync(current, "occ.turnaround.arrival_corrected",
                    $"{reason} ({previous:O} -> {leg.ActualAt:O})", now, cancellationToken);
        }, cancellationToken);
    }

    public async Task<OccPositionResult> AssignAsync(Guid actorId, Guid turnaroundId, Guid standId, string? reason,
        OccPositionCommand command, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        var note = reason?.Trim();
        if (note is { Length: > 500 } || standId == Guid.Empty) return Failed(OccPositionFailure.Invalid, "invalid_position_request");
        var payload = new { turnaroundId, standId, reason = note };
        return await RunAsync(actorId, turnaroundId, command, AssignAction, payload, async (current, now) =>
        {
            if (OccTurnaroundRules.IsClosed(current.Turnaround.CurrentStatus))
                return Outcome.Fail(OccPositionFailure.Conflict, "turnaround_closed");
            // 3-N10: the stand row is locked first and every check below runs in this serializable transaction, so a
            // concurrent assignment of another flight waits and then sees this one.
            await StandAvailability.LockAsync(context, standId, cancellationToken);
            var stand = await context.Stands.AsNoTracking()
                .Where(item => item.PublicId == standId && item.StationId == current.StationId && item.IsActive)
                .Select(item => new { item.Id, item.Code, item.MaxAircraftSize }).SingleOrDefaultAsync(cancellationToken);
            if (stand is null) return Outcome.Fail(OccPositionFailure.NotFound, "not_found");
            var window = await context.GroundOperations.AsNoTracking().Where(item => item.TurnaroundId == current.TurnaroundId)
                .Select(item => new { item.PlannedStartAt, item.PlannedEndAt }).FirstOrDefaultAsync(cancellationToken);
            // Combined stands (ADR-0030): an impossible combination is rejected with the rule it breaks. The flights that
            // hold a stand are the one query of StandAvailability: an approved or closed flight no longer does (3-D), nor
            // one whose aircraft pushed back (owner decision 23).
            var occupied = await StandAvailability.Occupying(context, current.StationId, window?.PlannedStartAt,
                    window?.PlannedEndAt, current.TurnaroundId)
                .Select(item => new { Id = item.StandId, Code = item.StandCode, Size = item.AircraftSize })
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
            if (broken.Count > 0) return Outcome.Fail(OccPositionFailure.Conflict, "stand_unavailable", broken);
            // Same rule as manual planning: no other active assignment whose window overlaps this one.
            if (occupied.Any(item => item.Id == stand.Id))
                return Outcome.Fail(OccPositionFailure.Conflict, "stand_unavailable", ["stand_taken"]);
            var active = await context.Set<StandAssignment>()
                .SingleOrDefaultAsync(item => item.TurnaroundId == current.TurnaroundId && item.AssignedTo == null, cancellationToken);
            if (active?.StandId == stand.Id) return Outcome.Unchanged;
            // Closing the previous assignment and opening the new one commit together: one active assignment per
            // turnaround is a filtered unique index, so the closing is saved first.
            if (active is not null)
            {
                active.AssignedTo = Max(now, active.AssignedFrom);
                active.UpdatedAt = now;
                await context.SaveChangesAsync(cancellationToken);
            }
            context.Set<StandAssignment>().Add(new StandAssignment
            {
                PublicId = Guid.CreateVersion7(), TurnaroundId = current.TurnaroundId, StandId = stand.Id,
                AssignedFrom = now, AssignedByAccountId = current.AccountId,
                Reason = string.IsNullOrEmpty(note) ? (active is null ? "Asignada por OCC." : "Reasignada por OCC.") : note,
                CreatedAt = now, UpdatedAt = now,
            });
            current.Turnaround.UpdatedAt = now;
            // The flight follows the agent covering the new stand (ADR-0030), under the manual assignment's rules (3-N05).
            await CoverageReassignment.FollowStandAsync(context, timeProvider, current.TurnaroundId, current.StationId,
                stand.Id, current.AccountId, now, cancellationToken);
            return await AnnounceAsync(current, active is null ? "occ.stand.assigned" : "occ.stand.reassigned", stand.Code, now,
                cancellationToken);
        }, cancellationToken);
    }

    public async Task<OccPositionResult> ReleaseAsync(Guid actorId, Guid turnaroundId, OccPositionCommand command,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        return await RunAsync(actorId, turnaroundId, command, ReleaseAction, new { turnaroundId }, async (current, now) =>
        {
            var active = await context.Set<StandAssignment>()
                .SingleOrDefaultAsync(item => item.TurnaroundId == current.TurnaroundId && item.AssignedTo == null, cancellationToken);
            if (active is null) return Outcome.Unchanged;
            active.AssignedTo = Max(now, active.AssignedFrom);
            active.UpdatedAt = now;
            current.Turnaround.UpdatedAt = now;
            return await AnnounceAsync(current, "occ.stand.released", null, now, cancellationToken);
        }, cancellationToken);
    }

    private static bool Allowed(ActorContext? actor, string permission) =>
        actor is not null && actor.HasPermission(permission) &&
        actor.Memberships.Any(membership => membership.Kind == MembershipKind.InternalStaff &&
            membership.OrganizationType == OrganizationType.AviamOperator);

    private DateTimeOffset Now() => Truncate(timeProvider.GetUtcNow());

    private static DateTimeOffset Truncate(DateTimeOffset value) =>
        new(value.UtcTicks - value.UtcTicks % TimeSpan.TicksPerMillisecond, TimeSpan.Zero);

    private static DateTimeOffset Max(DateTimeOffset left, DateTimeOffset right) => left > right ? left : right;

    private static OccPositionResult Failed(OccPositionFailure failure, string code, IReadOnlyList<string>? reasons = null) =>
        new(null, failure, reasons is { Count: > 0 } ? reasons : null, code);

    /// <summary>What a command step did: changed the turnaround, nothing to change, or the failure that rolls it back.</summary>
    private sealed record Outcome(OccPositionFailure? Failure, string? Code, IReadOnlyList<string>? Reasons)
    {
        public static Outcome Done { get; } = new(null, null, null);

        public static Outcome Unchanged { get; } = new(null, null, null);

        public static Outcome Fail(OccPositionFailure failure, string code, IReadOnlyList<string>? reasons = null) =>
            new(failure, code, reasons);
    }

    /// <summary>
    /// One positions command (3-N10): the receipt of its Idempotency-Key, the turnaround version it expects, the work
    /// and the commit in one serializable transaction. Without a key (older screens) the same transaction still runs.
    /// A replay answers the current board without repeating audit or notices; any other use of the key is
    /// <c>idempotency_conflict</c>; a stale version is <c>version_conflict</c>.
    /// </summary>
    private async Task<OccPositionResult> RunAsync(Guid actorId, Guid turnaroundId, OccPositionCommand command, string action,
        object payload, Func<Context, DateTimeOffset, Task<Outcome>> work, CancellationToken cancellationToken)
    {
        if (command.IdempotencyKey == Guid.Empty) return Failed(OccPositionFailure.Invalid, "idempotency_key_required");
        if (command.IdempotencyKey is not null && string.IsNullOrWhiteSpace(command.ExpectedVersion))
            return Failed(OccPositionFailure.Invalid, "expected_version_required");
        var scope = await ScopeAsync(actorId, turnaroundId, cancellationToken);
        if (scope.Failure is { } failure)
            return Failed(failure, failure == OccPositionFailure.Forbidden ? "forbidden" : "not_found");
        var found = scope.Scope!;
        var hash = CommercialCommandReceipts.Hash(new { action, payload, expected = command.ExpectedVersion });
        try
        {
            var outcome = await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(IsolationLevel.Serializable,
                    cancellationToken);
                if (command.IdempotencyKey is { } key)
                {
                    var prior = await CommercialCommandReceipts.FindAsync(context, key, found.AccountId, action, hash,
                        cancellationToken);
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Conflict)
                        return Outcome.Fail(OccPositionFailure.Conflict, "idempotency_conflict");
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Replay) return Outcome.Unchanged;
                }
                var turnaround = await context.Turnarounds.SingleAsync(item => item.Id == found.TurnaroundId, cancellationToken);
                if (command.ExpectedVersion is { } expected && Version(turnaround.RowVersion) != expected)
                    return Outcome.Fail(OccPositionFailure.Conflict, "version_conflict");
                var now = Now();
                var done = await work(found with { Turnaround = turnaround }, now);
                if (done.Failure is not null)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    context.ChangeTracker.Clear();
                    return done;
                }
                if (command.IdempotencyKey is { } receipt)
                    CommercialCommandReceipts.Add(context, receipt, found.AccountId, action, hash, turnaroundId, now);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return done;
            });
            context.ChangeTracker.Clear();
            return outcome.Failure is { } refused
                ? Failed(refused, outcome.Code!, outcome.Reasons)
                : await AnsweredAsync(found, cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return Failed(OccPositionFailure.Conflict, "version_conflict");
        }
        catch (DbUpdateException exception) when (command.IdempotencyKey is { } key &&
                                                   CommercialCommandReceipts.IsDuplicateKey(exception))
        {
            // A concurrent command with the same key committed first.
            context.ChangeTracker.Clear();
            var concurrent = await CommercialCommandReceipts.FindAsync(context, key, found.AccountId, action, hash,
                cancellationToken);
            return concurrent.Outcome == CommercialCommandReceipts.Outcome.Replay
                ? await AnsweredAsync(found, cancellationToken)
                : Failed(OccPositionFailure.Conflict, "idempotency_conflict");
        }
        catch (DbUpdateException exception) when (exception.InnerException is SqlException { Number: 2601 or 2627 })
        {
            // The filtered unique index allows one active assignment per turnaround.
            context.ChangeTracker.Clear();
            return Failed(OccPositionFailure.Conflict, "stand_unavailable", ["stand_taken"]);
        }
        catch (Exception exception) when (exception is RetryLimitExceededException or SqlException &&
                                          exception.GetBaseException() is SqlException { Number: 1205 or 3960 })
        {
            // A deadlock that kept repeating: the screen re-reads and decides again.
            context.ChangeTracker.Clear();
            return Failed(OccPositionFailure.Conflict, "version_conflict");
        }
    }

    /// <summary>The board of the turnaround's day and the turnaround's version after the command.</summary>
    private async Task<OccPositionResult> AnsweredAsync(Context current, CancellationToken cancellationToken)
    {
        var rowVersion = await context.Turnarounds.AsNoTracking().Where(item => item.Id == current.TurnaroundId)
            .Select(item => item.RowVersion).SingleAsync(cancellationToken);
        return new(await BoardFor(current, cancellationToken), null, null, null, Version(rowVersion));
    }

    private static string Version(byte[] rowVersion) => Convert.ToBase64String(rowVersion);

    private async Task<(Context? Scope, OccPositionFailure? Failure)> ScopeAsync(Guid actorId, Guid turnaroundId,
        CancellationToken cancellationToken)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, AssignPermission)) return (null, OccPositionFailure.Forbidden);
        var turnaround = await context.Turnarounds.AsNoTracking().Where(item => item.PublicId == turnaroundId)
            .Select(item => new { item.Id, item.StationId, item.OperationDate }).SingleOrDefaultAsync(cancellationToken);
        if (turnaround is null) return (null, OccPositionFailure.NotFound);
        var station = await context.Stations.AsNoTracking().Where(item => item.Id == turnaround.StationId)
            .Select(item => new { item.PublicId }).SingleAsync(cancellationToken);
        if (!actor!.StationScopes.Any(scope => scope.StationId == station.PublicId)) return (null, OccPositionFailure.NotFound);
        var accountId = await context.Users.AsNoTracking().Where(user => user.PublicId == actorId)
            .Select(user => user.Id).SingleAsync(cancellationToken);
        // The turnaround itself is read again, tracked, inside the command's transaction.
        return (new Context(actor, accountId, turnaround.Id, turnaround.StationId, station.PublicId, turnaround.OperationDate,
            null!), null);
    }

    /// <summary>
    /// Audits the change and announces it to the station's OCC and the operation's tablets; the assigned agents learn
    /// when the flight moved or its arrival was corrected (ADR-0029). Each change has its own audit id, so a flight moved
    /// twice notifies twice (notices are unique per source). The caller saves.
    /// </summary>
    private async Task<Outcome> AnnounceAsync(Context current, string action, string? reason, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var changeId = Guid.CreateVersion7();
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = changeId, OccurredAt = now, ActorType = AuditActorType.Account,
            ActorAccountId = current.AccountId, Action = action, EntityType = nameof(Turnaround),
            EntityPublicId = current.Turnaround.PublicId, StationId = current.StationId, Source = AuditSource.Api,
            CorrelationId = Guid.CreateVersion7(), Reason = reason,
        });
        await OccPlanningChangeWriter.AddForStationAsync(context, current.StationId, current.StationPublicId, now, cancellationToken);
        var operationId = await context.GroundOperations.AsNoTracking().Where(item => item.TurnaroundId == current.TurnaroundId)
            .Select(item => (long?)item.Id).FirstOrDefaultAsync(cancellationToken);
        if (operationId is { } groundOperationId)
        {
            await RampOperationChangeWriter.AnnounceAsync(context, groundOperationId, now, false, cancellationToken);
            if (action != "occ.turnaround.arrived")
                await OperationalNotificationWriter.NotifyAssignedAgentsAsync(context, current.StationId, groundOperationId,
                    changeId, "flight_changed", now, current.AccountId, cancellationToken);
        }
        return Outcome.Done;
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
        var zone = await context.Stations.AsNoTracking().Where(item => item.Id == stationId)
            .Select(item => item.IanaTimeZone).SingleAsync(cancellationToken);
        var dayStart = BusinessCalendar.StartOfDay(operationDate, zone).ToUniversalTime();
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
                                     turnaround.AircraftRegistration, turnaround.CurrentStatus, turnaround.ExternalProvider })
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
        // Owner decision 23: the aircraft that pushed back left its stand. Its assignment stays open as the flight's stand
        // of record, but it no longer occupies, limits or cancels a stand, nor waits for one among the flights without one.
        var departed = (await StandAvailability.PushedBackTurnarounds(context).Where(id => ids.Contains(id))
            .ToArrayAsync(cancellationToken)).ToHashSet();
        var occupying = assignments.Where(item => !departed.Contains(item.TurnaroundId)).ToArray();

        OccPositionTurnaroundData Map(long id)
        {
            var turnaround = turnarounds.Single(item => item.Id == id);
            var arrival = legs[id].FirstOrDefault(item => item.Direction == FlightDirection.Arrival);
            var departure = legs[id].FirstOrDefault(item => item.Direction == FlightDirection.Departure);
            return new OccPositionTurnaroundData(turnaround.PublicId, turnaround.OperationCode, turnaround.Airline,
                turnaround.AircraftRegistration, arrival?.FlightNumber, departure?.FlightNumber, arrival?.ScheduledAt,
                arrival?.ActualAt, departure?.ScheduledAt, assignmentOf.GetValueOrDefault(id)?.AssignedFrom,
                turnaround.CurrentStatus.ToString(), DemoFlightGroups.Mark(turnaround.ExternalProvider));
        }

        var occupiedNow = occupying.Select(item => new OccupiedStand(item.StandId,
            stands.FirstOrDefault(stand => stand.Id == item.StandId)?.Code ?? "", null)).ToArray();
        var cancelled = StandConstraintPolicy.CancelledStands(occupiedNow, rules);
        var limited = StandConstraintPolicy.NarrowbodyLimited(occupiedNow, rules);
        var positions = stands.Select(stand =>
        {
            var parked = occupying.Where(item => item.StandId == stand.Id).Select(item => Map(item.TurnaroundId))
                .OrderBy(item => item.ArrivalScheduledAt).ToArray();
            var status = parked.Any(item => item.ArrivedAt is not null) ? "occupied" : parked.Length > 0 ? "planned" : "available";
            return new OccPositionData(stand.PublicId, stand.Code, stand.Terminal, stand.StandType, status, parked,
                stand.Latitude, stand.Longitude, stand.HasBoardingBridge, stand.IsRemote, stand.MaxAircraftSize?.ToString(),
                cancelled.GetValueOrDefault(stand.Id),
                stand.MaxAircraftSize == AircraftSizeCategory.Narrowbody || limited.Contains(stand.Id),
                coverage[stand.Id].Distinct().ToArray());
        }).ToArray();
        var unassigned = turnarounds.Where(item => !assignmentOf.ContainsKey(item.Id) && !departed.Contains(item.Id) &&
                item.CurrentStatus is not (TurnaroundStatus.Completed or TurnaroundStatus.Diverted))
            .Select(item => Map(item.Id)).OrderBy(item => item.ArrivalScheduledAt).ToArray();
        return new OccPositionBoardData(stationPublicId, stationCode, operationDate, timeProvider.GetUtcNow(), positions,
            unassigned, canAssign);
    }
}
