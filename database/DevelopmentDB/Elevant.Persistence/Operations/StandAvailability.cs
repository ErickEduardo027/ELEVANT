using Elevant.Application.Operations;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>A stand another flight holds in a window (<see cref="StandAvailability.Occupying"/>).</summary>
/// <remarks>A member-initialized class (not a positional record) so callers can keep composing the query.</remarks>
internal sealed class OccupiedStandRow
{
    public long StandId { get; init; }
    public string StandCode { get; init; } = string.Empty;
    public long TurnaroundId { get; init; }
    public AircraftSizeCategory? AircraftSize { get; init; }
}

/// <summary>
/// Whether a flight can take a stand for its window (2-B): an active stand of the station in an active
/// terminal, not held by another unfinished flight in that window (one that has not pushed back), and allowed by the
/// combined-stand rules (ADR-0030). The same rules the positions map applies when OCC assigns a stand. Every command
/// that places a flight on a stand locks the stand first (<see cref="LockAsync"/>), so two flights never take it at
/// once (3-N10).
/// </summary>
internal static class StandAvailability
{
    /// <param name="StandId">The stand, or null when it is unknown, inactive or of another station.</param>
    /// <param name="Reasons">The rules it breaks; <c>stand_taken</c> when another flight holds it.</param>
    internal sealed record Placement(long? StandId, IReadOnlyList<string> Reasons)
    {
        public bool Available => StandId is not null && Reasons.Count == 0;
    }

    /// <summary>
    /// Locks the stand row (UPDLOCK, HOLDLOCK) until the caller's transaction ends: a concurrent command for the same
    /// stand waits and then sees the assignment this one wrote. Returns the stand's key, or null when it does not exist.
    /// </summary>
    public static async Task<long?> LockAsync(ElevantDbContext context, Guid standId, CancellationToken cancellationToken) =>
        (await context.Stands.FromSqlInterpolated($"""
                SELECT * FROM [ref].[stands] WITH (UPDLOCK, HOLDLOCK)
                WHERE [public_id] = {standId}
                """)
            .AsNoTracking()
            .Select(stand => (long?)stand.Id)
            .ToArrayAsync(cancellationToken))
        .SingleOrDefault();

    /// <summary>
    /// The turnarounds whose aircraft left the stand (<see cref="OperationOccupancyRules.HasLeftStand"/>, owner decision
    /// 23): their operation has the PUSHBACK milestone with an actual time. The one SQL form of that rule, which every
    /// occupancy read composes: <see cref="Occupying"/>, the positions board and
    /// <see cref="MasterDataUsage.StandInUseAsync"/>. It frees the occupancy only: the stand assignment stays open as the
    /// flight's stand of record, so the readers of «the flight's stand» never use it.
    /// </summary>
    public static IQueryable<long> PushedBackTurnarounds(ElevantDbContext context) =>
        from operation in context.GroundOperations.AsNoTracking()
        join milestone in context.Set<OperationMilestone>().AsNoTracking()
            on operation.Id equals milestone.GroundOperationId
        where milestone.Code == RampEvidenceTimePolicy.Pushback && milestone.ActualAt != null
        select operation.TurnaroundId;

    /// <summary>
    /// The one query of «which flights hold a stand» (3-D): the active stand assignments of the station whose flight
    /// still holds its stand (<see cref="OperationOccupancyRules.HoldsStand"/>: the operation is neither cancelled nor
    /// approved and the turnaround is neither completed, cancelled nor diverted), whose aircraft has not pushed back
    /// (<see cref="PushedBackTurnarounds"/>) and whose planned window overlaps [<paramref name="startsAt"/>,
    /// <paramref name="endsAt"/>). A holding flight without a planned window, or an unknown window of the flight being
    /// placed, counts as overlapping (it fails closed). <paramref name="exceptTurnaroundId"/> is the flight being placed,
    /// whose own assignment never blocks it.
    /// </summary>
    public static IQueryable<OccupiedStandRow> Occupying(ElevantDbContext context, long stationId, DateTimeOffset? startsAt,
        DateTimeOffset? endsAt, long? exceptTurnaroundId)
    {
        // A query variable: EF inlines it as a subquery of this one.
        var departed = PushedBackTurnarounds(context);
        return from assignment in context.Set<StandAssignment>().AsNoTracking()
               join operation in context.GroundOperations.AsNoTracking()
                   on assignment.TurnaroundId equals operation.TurnaroundId
               join parked in context.Stands.AsNoTracking() on assignment.StandId equals parked.Id
               join turnaround in context.Turnarounds.AsNoTracking() on assignment.TurnaroundId equals turnaround.Id
               from type in context.AircraftTypes.AsNoTracking().Where(type => type.Id == turnaround.AircraftTypeId)
                   .DefaultIfEmpty()
               where parked.StationId == stationId && assignment.AssignedTo == null &&
                     (exceptTurnaroundId == null || assignment.TurnaroundId != exceptTurnaroundId) &&
                     // OperationOccupancyRules.HoldsStand, with explicit comparisons of the enums stored as text.
                     operation.CurrentStatus != GroundOperationStatus.Cancelled &&
                     operation.CurrentStatus != GroundOperationStatus.Approved &&
                     turnaround.CurrentStatus != TurnaroundStatus.Completed &&
                     turnaround.CurrentStatus != TurnaroundStatus.Cancelled &&
                     turnaround.CurrentStatus != TurnaroundStatus.Diverted &&
                     // Owner decision 23: the aircraft that pushed back left the stand.
                     !departed.Contains(assignment.TurnaroundId) &&
                     (startsAt == null || endsAt == null ||
                      operation.PlannedStartAt == null || operation.PlannedEndAt == null ||
                      (operation.PlannedStartAt < endsAt && startsAt < operation.PlannedEndAt))
               select new OccupiedStandRow
               {
                   StandId = parked.Id, StandCode = parked.Code, TurnaroundId = assignment.TurnaroundId,
                   AircraftSize = type == null ? null : type.SizeCategory,
               };
    }

    /// <summary>
    /// Where the flight can park in the window; <paramref name="excludeTurnaroundId"/> is the flight being moved or
    /// rescheduled, whose own assignment never blocks it.
    /// </summary>
    public static async Task<Placement> CheckAsync(ElevantDbContext context, long stationId, Guid standId,
        DateTimeOffset startsAt, DateTimeOffset endsAt, AircraftSizeCategory? aircraftSize, long? excludeTurnaroundId,
        CancellationToken cancellationToken)
    {
        var stand = await (from item in context.Stands.AsNoTracking()
                           join terminal in context.Terminals.AsNoTracking() on item.TerminalId equals (long?)terminal.Id
                           where item.PublicId == standId && item.StationId == stationId && item.IsActive && terminal.IsActive
                           select new { item.Id, item.Code, item.MaxAircraftSize }).SingleOrDefaultAsync(cancellationToken);
        if (stand is null) return new Placement(null, []);
        var occupied = await Occupying(context, stationId, startsAt, endsAt, excludeTurnaroundId)
            .Select(item => new { item.StandId, item.StandCode, item.AircraftSize })
            .ToArrayAsync(cancellationToken);
        var rules = await context.Set<StandConstraint>().AsNoTracking()
            .Where(item => item.StationId == stationId && item.IsActive)
            .Select(item => new { item.StandId, item.AffectedStandId, item.Kind }).ToArrayAsync(cancellationToken);
        var reasons = StandConstraintPolicy.Evaluate(new StandPlacement(stand.Id, stand.Code, stand.MaxAircraftSize, aircraftSize),
            occupied.Select(item => new OccupiedStand(item.StandId, item.StandCode, item.AircraftSize)).ToArray(),
            rules.Select(item => new StandRule(item.StandId, item.AffectedStandId, item.Kind)).ToArray()).ToList();
        if (occupied.Any(item => item.StandId == stand.Id)) reasons.Insert(0, "stand_taken");
        return new Placement(stand.Id, reasons);
    }

    /// <summary>
    /// The combined-stand rules a new aircraft size breaks on the stand the flight already holds (ADR-0030): a wide-body
    /// never takes a narrow-body stand nor one an occupied neighbour limits, and the stand never limits a neighbour that
    /// holds one. Only these size rules count, since the stand and the window stay as they are. The stand is locked first
    /// (3-N10). Without a size, a window or an active assignment nothing is checked. The arrival recorded by OCC and the
    /// feed's pair linked to a planned flight (3-N07) apply it before the turnaround takes the type.
    /// </summary>
    public static async Task<IReadOnlyList<string>> SizeReasonsAsync(ElevantDbContext context, long stationId,
        long turnaroundId, DateTimeOffset? startsAt, DateTimeOffset? endsAt, AircraftSizeCategory? aircraftSize,
        CancellationToken cancellationToken)
    {
        if (aircraftSize is null || startsAt is not { } start || endsAt is not { } end) return [];
        var held = await (from assignment in context.Set<StandAssignment>().AsNoTracking()
                          join stand in context.Stands.AsNoTracking() on assignment.StandId equals stand.Id
                          where assignment.TurnaroundId == turnaroundId && assignment.AssignedTo == null
                          select (Guid?)stand.PublicId).SingleOrDefaultAsync(cancellationToken);
        if (held is not { } standId) return [];
        await LockAsync(context, standId, cancellationToken);
        var placement = await CheckAsync(context, stationId, standId, start, end, aircraftSize, turnaroundId,
            cancellationToken);
        return placement.Reasons.Where(reason => reason is "stand_narrowbody_only" or "neighbour_widebody").ToArray();
    }
}
