using Elevant.Application.Operations;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>
/// Whether a new flight can take a stand for its window (2-B): an active stand of the station in an active
/// terminal, not held by another unfinished flight in that window, and allowed by the combined-stand rules
/// (ADR-0030). The same rules the positions map applies when OCC assigns a stand.
/// </summary>
internal static class StandAvailability
{
    /// <param name="StandId">The stand, or null when it is unknown, inactive or of another station.</param>
    /// <param name="Reasons">The rules it breaks; <c>stand_taken</c> when another flight holds it.</param>
    internal sealed record Placement(long? StandId, IReadOnlyList<string> Reasons)
    {
        public bool Available => StandId is not null && Reasons.Count == 0;
    }

    public static async Task<Placement> CheckAsync(ElevantDbContext context, long stationId, Guid standId,
        DateTimeOffset startsAt, DateTimeOffset endsAt, AircraftSizeCategory? aircraftSize, CancellationToken cancellationToken)
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
