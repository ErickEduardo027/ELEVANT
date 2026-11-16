namespace Elevant.Application.Operations;

/// <summary>Surcharges ELEVANT marks on its own when the operation is handed to OCC (ADR-0034).</summary>
public static class AutomaticSurchargeCodes
{
    /// <summary>Operation started between 22:00 and 05:59, station time.</summary>
    public const string Night = "NIGHT";

    /// <summary>Operation started on a Sunday or a Finance holiday between 06:00 and 21:59.</summary>
    public const string Holiday = "HOLIDAY";

    /// <summary>Ground time (block-on to push-back) beyond what Finance allows for the aircraft category.</summary>
    public const string Overtime = "OVERTIME";

    /// <summary>Arrival later than scheduled.</summary>
    public const string Delay = "DELAY";

    public static readonly IReadOnlyList<string> All = [Night, Holiday, Overtime, Delay];
}

/// <param name="StartedAt">Block-on, or the operation's actual start when block-on was not recorded.</param>
/// <param name="EndedAt">Push-back, or the hand-off moment when push-back was not recorded.</param>
/// <param name="AllowedGroundMinutes">Finance's allowance for the aircraft category; null when unknown.</param>
public sealed record AutomaticSurchargeInput(
    DateTimeOffset? StartedAt,
    DateTimeOffset? EndedAt,
    DateTimeOffset? ArrivalScheduledAt,
    DateTimeOffset? ArrivalActualAt,
    TimeZoneInfo StationZone,
    IReadOnlySet<DateOnly> Holidays,
    int? AllowedGroundMinutes);

/// <summary>
/// Detects the surcharges AVIAM's Service Order describes: 15 % between 22:00 and 05:59, 15 % on
/// Sundays and holidays between 06:00 and 21:59, package time exceeded and arrival delay. Only the
/// codes are decided here; the percentages and rates are Finance's tariff and each contract's.
/// </summary>
public static class AutomaticSurchargePolicy
{
    public static readonly TimeOnly NightStartsAt = new(22, 0);
    public static readonly TimeOnly DayStartsAt = new(6, 0);

    /// <param name="graceMinutes">Grace of each charge as Finance defined it (OVERTIME, DELAY); missing means none.</param>
    public static IReadOnlyList<string> Detect(AutomaticSurchargeInput input,
        IReadOnlyDictionary<string, int> graceMinutes)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(graceMinutes);
        var codes = new List<string>();
        if (input.StartedAt is { } started)
        {
            var local = TimeZoneInfo.ConvertTime(started, input.StationZone);
            var time = TimeOnly.FromTimeSpan(local.TimeOfDay);
            if (time >= NightStartsAt || time < DayStartsAt)
                codes.Add(AutomaticSurchargeCodes.Night);
            else if (local.DayOfWeek == DayOfWeek.Sunday || input.Holidays.Contains(DateOnly.FromDateTime(local.DateTime)))
                codes.Add(AutomaticSurchargeCodes.Holiday);
        }
        if (OverrunMinutes(GroundMinutes(input.StartedAt, input.EndedAt), input.AllowedGroundMinutes) is { } overrun &&
            overrun > Grace(graceMinutes, AutomaticSurchargeCodes.Overtime))
            codes.Add(AutomaticSurchargeCodes.Overtime);
        if (GroundMinutes(input.ArrivalScheduledAt, input.ArrivalActualAt) is { } delay &&
            delay > Grace(graceMinutes, AutomaticSurchargeCodes.Delay))
            codes.Add(AutomaticSurchargeCodes.Delay);
        return codes;
    }

    /// <summary>Whole minutes from start to end, never negative; null when either is missing.</summary>
    public static decimal? GroundMinutes(DateTimeOffset? start, DateTimeOffset? end) =>
        start is { } a && end is { } b ? Math.Max(0m, decimal.Floor((decimal)(b - a).Ticks / TimeSpan.TicksPerMinute)) : null;

    /// <summary>Minutes beyond the allowance; null when the ground time or the allowance is unknown.</summary>
    public static decimal? OverrunMinutes(decimal? groundMinutes, int? allowedMinutes) =>
        groundMinutes is { } ground && allowedMinutes is { } allowed ? Math.Max(0m, ground - allowed) : null;

    private static int Grace(IReadOnlyDictionary<string, int> grace, string code) =>
        grace.TryGetValue(code, out var minutes) ? Math.Max(0, minutes) : 0;
}
