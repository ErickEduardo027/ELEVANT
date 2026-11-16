using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations;

/// <summary>An active combined-stand rule between two stands (ADR-0030).</summary>
public sealed record StandRule(long StandId, long AffectedStandId, StandConstraintKind Kind);

/// <summary>A stand with an aircraft whose window overlaps the one being placed.</summary>
public sealed record OccupiedStand(long StandId, string Code, AircraftSizeCategory? AircraftSize);

/// <summary>The stand OCC wants to use for a turnaround.</summary>
public sealed record StandPlacement(long StandId, string Code, AircraftSizeCategory? MaxAircraftSize,
    AircraftSizeCategory? AircraftSize);

/// <summary>
/// Combined stands (ADR-0030): the airport decides with the stand code, and some stands cancel
/// or limit others while occupied — 9A or 11A cancel 10, 23A limits 25 to narrow-body, 30 and
/// 30A never at once. Pure: returns the broken rules as codes; empty means the stand can be used.
/// </summary>
public static class StandConstraintPolicy
{
    public static IReadOnlyList<string> Evaluate(StandPlacement placement, IReadOnlyCollection<OccupiedStand> occupied,
        IReadOnlyCollection<StandRule> rules)
    {
        ArgumentNullException.ThrowIfNull(placement);
        ArgumentNullException.ThrowIfNull(occupied);
        ArgumentNullException.ThrowIfNull(rules);
        var reasons = new List<string>();
        var occupiedById = occupied.Where(stand => stand.StandId != placement.StandId)
            .GroupBy(stand => stand.StandId).ToDictionary(group => group.Key, group => group.First());

        // Another occupied stand cancels this one, or this one would cancel an occupied stand.
        if (rules.Any(rule => rule.Kind == StandConstraintKind.Cancels &&
                ((rule.AffectedStandId == placement.StandId && occupiedById.ContainsKey(rule.StandId)) ||
                 (rule.StandId == placement.StandId && occupiedById.ContainsKey(rule.AffectedStandId)))))
            reasons.Add("stand_cancelled");

        var wide = placement.AircraftSize == AircraftSizeCategory.Widebody;
        if (wide && placement.MaxAircraftSize == AircraftSizeCategory.Narrowbody)
            reasons.Add("stand_narrowbody_only");
        else if (wide && rules.Any(rule => rule.Kind == StandConstraintKind.NarrowbodyOnly &&
                     rule.AffectedStandId == placement.StandId && occupiedById.ContainsKey(rule.StandId)))
            reasons.Add("stand_narrowbody_only");

        // Occupying this stand limits a neighbour that already holds a wide-body.
        if (rules.Any(rule => rule.Kind == StandConstraintKind.NarrowbodyOnly && rule.StandId == placement.StandId &&
                occupiedById.TryGetValue(rule.AffectedStandId, out var neighbour) &&
                neighbour.AircraftSize == AircraftSizeCategory.Widebody))
            reasons.Add("neighbour_widebody");
        return reasons;
    }

    /// <summary>Codes of the stands an occupied stand cancels right now, for the map (an alert to OCC).</summary>
    public static IReadOnlyDictionary<long, string> CancelledStands(IReadOnlyCollection<OccupiedStand> occupied,
        IReadOnlyCollection<StandRule> rules)
    {
        var occupiedById = occupied.GroupBy(stand => stand.StandId).ToDictionary(group => group.Key, group => group.First());
        var cancelled = new Dictionary<long, string>();
        foreach (var rule in rules.Where(rule => rule.Kind == StandConstraintKind.Cancels))
        {
            if (occupiedById.TryGetValue(rule.StandId, out var by)) cancelled.TryAdd(rule.AffectedStandId, by.Code);
        }
        return cancelled;
    }

    /// <summary>Stands currently limited to narrow-body because a neighbour is occupied.</summary>
    public static IReadOnlySet<long> NarrowbodyLimited(IReadOnlyCollection<OccupiedStand> occupied,
        IReadOnlyCollection<StandRule> rules)
    {
        var occupiedIds = occupied.Select(stand => stand.StandId).ToHashSet();
        return rules.Where(rule => rule.Kind == StandConstraintKind.NarrowbodyOnly && occupiedIds.Contains(rule.StandId))
            .Select(rule => rule.AffectedStandId).ToHashSet();
    }
}
