namespace Elevant.Application.Identity;

public sealed record ScheduleShift(
    Guid Id, Guid RampProfileId, string AgentName, string EmployeeNumber,
    Guid StationId, string StationCode, string IanaTimeZone,
    DateOnly WorkDate, TimeOnly StartsAtLocal, TimeOnly EndsAtLocal,
    bool CanReveal);

public sealed record ScheduleWarningRule(
    string Version, DateOnly EffectiveOn, TimeSpan MinimumRest,
    TimeSpan MaximumSevenDayScheduled);

public enum ScheduleWarningKind
{
    Overlap,
    ShortRest,
    SevenDayLoad,
    Unevaluable,
}

public sealed record ScheduleWarningEvidence(
    Guid ShiftId, Guid StationId, string StationCode,
    DateTimeOffset StartsAt, DateTimeOffset EndsAt);

public sealed record ScheduleWarning(
    Guid AnchorShiftId, Guid RampProfileId, string AgentName,
    string EmployeeNumber, DateOnly WorkDate, ScheduleWarningKind Kind,
    IReadOnlyList<ScheduleWarningEvidence> Evidence, bool HasRestrictedEvidence,
    int? MeasuredMinutes, int? ThresholdMinutes,
    string RuleVersion, DateOnly RuleEffectiveOn, string? Reason);

/// <summary>
/// Computes provisional planning warnings from confirmed shift assignments.
/// It does not decide eligibility, labor-law compliance, or worked time.
/// </summary>
public static class ScheduleWarningEvaluator
{
    private sealed record Interval(ScheduleShift Shift,
        DateTimeOffset? Start, DateTimeOffset? End, string? InvalidReason)
    {
        public bool IsValid => Start.HasValue && End.HasValue;
    }

    public static IReadOnlyList<ScheduleWarning> Evaluate(
        IReadOnlyList<ScheduleShift> shifts, Guid requestedStationId,
        TimeZoneInfo requestedZone, DateOnly from, DateOnly to,
        ScheduleWarningRule rule)
    {
        ArgumentNullException.ThrowIfNull(shifts);
        ArgumentNullException.ThrowIfNull(requestedZone);
        ArgumentNullException.ThrowIfNull(rule);
        if (requestedStationId == Guid.Empty || from == default || to < from ||
            string.IsNullOrWhiteSpace(rule.Version) ||
            rule.MinimumRest <= TimeSpan.Zero ||
            rule.MaximumSevenDayScheduled <= TimeSpan.Zero)
            throw new ArgumentException("The schedule warning input is invalid.");

        var warnings = new List<ScheduleWarning>();
        foreach (var group in shifts.GroupBy(shift => shift.RampProfileId))
        {
            var intervals = group.Select(Convert).ToArray();
            var valid = intervals.Where(item => item.IsValid)
                .OrderBy(item => item.Start).ThenBy(item => item.Shift.Id).ToArray();
            var targets = intervals.Where(item =>
                    item.Shift.StationId == requestedStationId &&
                    item.Shift.CanReveal &&
                    item.Shift.WorkDate >= from && item.Shift.WorkDate <= to)
                .OrderBy(item => item.Shift.WorkDate)
                .ThenBy(item => item.Shift.EmployeeNumber, StringComparer.Ordinal)
                .ThenBy(item => item.Shift.Id).ToArray();
            var dailyWarnings = new HashSet<(DateOnly Date, ScheduleWarningKind Kind)>();

            foreach (var target in targets)
            {
                if (!target.IsValid)
                {
                    warnings.Add(Create(target, ScheduleWarningKind.Unevaluable,
                        [target], null, null, rule, target.InvalidReason));
                    continue;
                }

                // A bad nearby source can change either the preceding rest or
                // the seven-date load. Never infer compliance from partial data.
                var nearbyInvalid = intervals.Where(item => !item.IsValid &&
                    item.Shift.Id != target.Shift.Id &&
                    item.Shift.WorkDate >= target.Shift.WorkDate.AddDays(-7) &&
                    item.Shift.WorkDate <= target.Shift.WorkDate.AddDays(1)).ToArray();
                if (nearbyInvalid.Length > 0)
                {
                    if (dailyWarnings.Add((target.Shift.WorkDate,
                            ScheduleWarningKind.Unevaluable)))
                        warnings.Add(Create(target, ScheduleWarningKind.Unevaluable,
                            [target, .. nearbyInvalid], null, null, rule,
                            "ContextShiftUnevaluable"));
                    continue;
                }

                var preceding = valid.Where(item =>
                        item.Shift.Id != target.Shift.Id &&
                        (item.Start!.Value < target.Start!.Value ||
                            (item.Start.Value == target.Start.Value &&
                                item.Shift.Id.CompareTo(target.Shift.Id) < 0)))
                    .OrderByDescending(item => item.End)
                    .ThenBy(item => item.Shift.Id).FirstOrDefault();
                if (preceding is not null)
                {
                    var rest = target.Start!.Value - preceding.End!.Value;
                    if (rest < TimeSpan.Zero)
                    {
                        var overlap = Min(target.End!.Value, preceding.End.Value) -
                            target.Start.Value;
                        if (overlap > TimeSpan.Zero)
                            warnings.Add(Create(target, ScheduleWarningKind.Overlap,
                                [preceding, target], (int)overlap.TotalMinutes, 0,
                                rule, null));
                    }
                    else if (rest < rule.MinimumRest)
                    {
                        warnings.Add(Create(target, ScheduleWarningKind.ShortRest,
                            [preceding, target], (int)rest.TotalMinutes,
                            (int)rule.MinimumRest.TotalMinutes, rule, null));
                    }
                }

                if (!dailyWarnings.Add((target.Shift.WorkDate,
                        ScheduleWarningKind.SevenDayLoad))) continue;
                var windowFrom = target.Shift.WorkDate.AddDays(-6);
                var window = valid.Where(item =>
                    {
                        var localStart = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(
                            item.Start!.Value, requestedZone).DateTime);
                        return localStart >= windowFrom &&
                            localStart <= target.Shift.WorkDate;
                    })
                    .OrderBy(item => item.Start).ThenBy(item => item.Shift.Id).ToArray();
                var total = UnionDuration(window);
                if (total > rule.MaximumSevenDayScheduled)
                    warnings.Add(Create(target, ScheduleWarningKind.SevenDayLoad,
                        window, (int)total.TotalMinutes,
                        (int)rule.MaximumSevenDayScheduled.TotalMinutes,
                        rule, null));
            }
        }

        return warnings.OrderBy(item => item.WorkDate)
            .ThenBy(item => item.EmployeeNumber, StringComparer.Ordinal)
            .ThenBy(item => item.Kind)
            .ThenBy(item => item.AnchorShiftId).ToArray();
    }

    private static Interval Convert(ScheduleShift shift)
    {
        TimeZoneInfo zone;
        try
        {
            zone = TimeZoneInfo.FindSystemTimeZoneById(shift.IanaTimeZone);
        }
        catch (TimeZoneNotFoundException)
        {
            return new Interval(shift, null, null, "UnknownTimeZone");
        }
        catch (InvalidTimeZoneException)
        {
            return new Interval(shift, null, null, "UnknownTimeZone");
        }

        if (shift.StartsAtLocal == shift.EndsAtLocal)
            return new Interval(shift, null, null, "InvalidDuration");
        var start = DateTime.SpecifyKind(shift.WorkDate.ToDateTime(
            shift.StartsAtLocal), DateTimeKind.Unspecified);
        var endDate = shift.EndsAtLocal < shift.StartsAtLocal
            ? shift.WorkDate.AddDays(1) : shift.WorkDate;
        var end = DateTime.SpecifyKind(endDate.ToDateTime(
            shift.EndsAtLocal), DateTimeKind.Unspecified);
        if (zone.IsInvalidTime(start) || zone.IsInvalidTime(end))
            return new Interval(shift, null, null, "NonexistentLocalTime");
        if (zone.IsAmbiguousTime(start) || zone.IsAmbiguousTime(end))
            return new Interval(shift, null, null, "AmbiguousLocalTime");

        var startUtc = new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(start, zone));
        var endUtc = new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(end, zone));
        if (endUtc <= startUtc)
            return new Interval(shift, null, null, "InvalidDuration");
        return new Interval(shift, startUtc, endUtc, null);
    }

    private static TimeSpan UnionDuration(IReadOnlyList<Interval> ordered)
    {
        if (ordered.Count == 0) return TimeSpan.Zero;
        var total = TimeSpan.Zero;
        var start = ordered[0].Start!.Value;
        var end = ordered[0].End!.Value;
        for (var index = 1; index < ordered.Count; index++)
        {
            var next = ordered[index];
            if (next.Start!.Value <= end)
                end = Max(end, next.End!.Value);
            else
            {
                total += end - start;
                start = next.Start.Value;
                end = next.End!.Value;
            }
        }
        return total + (end - start);
    }

    private static ScheduleWarning Create(Interval target, ScheduleWarningKind kind,
        IReadOnlyList<Interval> source, int? measuredMinutes,
        int? thresholdMinutes, ScheduleWarningRule rule, string? reason)
    {
        var restricted = source.Any(item => !item.Shift.CanReveal);
        var evidence = source.Where(item => item.Shift.CanReveal && item.IsValid)
            .Select(item => new ScheduleWarningEvidence(item.Shift.Id,
                item.Shift.StationId, item.Shift.StationCode,
                item.Start!.Value, item.End!.Value))
            .DistinctBy(item => item.ShiftId).ToArray();
        return new ScheduleWarning(target.Shift.Id,
            target.Shift.RampProfileId, target.Shift.AgentName,
            target.Shift.EmployeeNumber, target.Shift.WorkDate, kind,
            evidence, restricted, restricted ? null : measuredMinutes,
            thresholdMinutes, rule.Version, rule.EffectiveOn, reason);
    }

    private static DateTimeOffset Min(DateTimeOffset left, DateTimeOffset right) =>
        left <= right ? left : right;

    private static DateTimeOffset Max(DateTimeOffset left, DateTimeOffset right) =>
        left >= right ? left : right;
}
