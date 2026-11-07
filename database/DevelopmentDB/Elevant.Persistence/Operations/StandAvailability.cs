using Elevant.Application.Operations;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>
/// Whether a flight can take a stand for its window (2-B): an active stand of the station in an active
/// terminal, not held by another unfinished flight in that window, and allowed by the combined-stand rules
/// (ADR-0030). The same rules the positions map applies when OCC assigns a stand. Every command that places a
/// flight on a stand locks the stand first (<see cref="LockAsync"/>), so two flights never take it at once (3-N10).
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
        var occupied = await (from assignment in context.Set<StandAssignment>().AsNoTracking()
                              join operation in context.GroundOperations.AsNoTracking()
                                  on assignment.TurnaroundId equals operation.TurnaroundId
                              join parked in context.Stands.AsNoTracking() on assignment.StandId equals parked.Id
                              join turnaround in context.Turnarounds.AsNoTracking() on assignment.TurnaroundId equals turnaround.Id
                              from type in context.AircraftTypes.AsNoTracking()
                                  .Where(type => type.Id == turnaround.AircraftTypeId).DefaultIfEmpty()
                              where parked.StationId == stationId && assignment.AssignedTo == null &&
                                    (excludeTurnaroundId == null || assignment.TurnaroundId != excludeTurnaroundId) &&
                                    operation.CurrentStatus != GroundOperationStatus.Cancelled &&
                                    (operation.PlannedStartAt == null || operation.PlannedEndAt == null ||
                                     (operation.PlannedStartAt < endsAt && startsAt < operation.PlannedEndAt))
                              select new { parked.Id, parked.Code, Size = type == null ? null : type.SizeCategory })
            .ToArrayAsync(cancellationToken);
        var rules = await context.Set<StandConstraint>().AsNoTracking()
            .Where(item => item.StationId == stationId && item.IsActive)
            .Select(item => new { item.StandId, item.AffectedStandId, item.Kind }).ToArrayAsync(cancellationToken);
        var reasons = StandConstraintPolicy.Evaluate(new StandPlacement(stand.Id, stand.Code, stand.MaxAircraftSize, aircraftSize),
            occupied.Select(item => new OccupiedStand(item.Id, item.Code, item.Size)).ToArray(),
            rules.Select(item => new StandRule(item.StandId, item.AffectedStandId, item.Kind)).ToArray()).ToList();
        if (occupied.Any(item => item.Id == stand.Id)) reasons.Insert(0, "stand_taken");
        return new Placement(stand.Id, reasons);
    }
}
