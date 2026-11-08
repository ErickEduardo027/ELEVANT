namespace Elevant.Application.Identity;

/// <summary>
/// 3-E: OCC and Gestión Humana adjust the hours of a shift of today or a later day in its station's calendar
/// (<see cref="Common.BusinessCalendar"/>), never one whose attendance was already validated. The adjusted shift keeps
/// covering the work the agent already has in it: the stand coverages (as the agent or the mentor) and the operations
/// assigned, in progress or returned. A shift lasts at most <see cref="MaxDuration"/>; an end at or before the start
/// crosses midnight. Pure: the store gathers the facts in its transaction and this decides.
/// </summary>
public static class ShiftAdjustmentRules
{
    public static readonly TimeSpan MaxDuration = TimeSpan.FromHours(16);

    /// <summary>Shortest and longest reason the audit keeps.</summary>
    public const int MinReasonLength = 5;

    public const int MaxReasonLength = 500;

    /// <summary>The trimmed reason, or null when it is too short or too long.</summary>
    public static string? Reason(string? reason)
    {
        var trimmed = reason?.Trim();
        return trimmed is { Length: >= MinReasonLength and <= MaxReasonLength } ? trimmed : null;
    }

    /// <summary>
    /// Null when the adjustment applies; otherwise the Problem Details code of the broken rule: <c>shift_in_past</c>,
    /// <c>attendance_validated</c>, <c>invalid_shift</c> or <c>shift_uncovers_work</c>.
    /// </summary>
    /// <param name="workDate">The shift's day in its station's calendar.</param>
    /// <param name="today">Today in the station's calendar (<see cref="Common.BusinessCalendar.Today"/>).</param>
    /// <param name="startsAtLocal">The new local start.</param>
    /// <param name="endsAtLocal">The new local end; at or before the start it crosses midnight.</param>
    /// <param name="ianaTimeZone">The station's time zone.</param>
    /// <param name="work">The instants of the coverages and operations the agent already has in the shift.</param>
    /// <param name="attendanceValidated">Gestión Humana already validated an attendance of the shift.</param>
    public static string? Check(DateOnly workDate, DateOnly today, TimeOnly startsAtLocal, TimeOnly endsAtLocal,
        string? ianaTimeZone, IReadOnlyCollection<(DateTimeOffset Start, DateTimeOffset End)> work,
        bool attendanceValidated)
    {
        ArgumentNullException.ThrowIfNull(work);
        if (workDate < today) return "shift_in_past";
        if (attendanceValidated) return "attendance_validated";
        if (startsAtLocal == endsAtLocal || startsAtLocal.Second != 0 || endsAtLocal.Second != 0 ||
            startsAtLocal.Millisecond != 0 || endsAtLocal.Millisecond != 0)
            return "invalid_shift";
        var (start, end) = RampAgentReleaseRules.ShiftWindow(workDate, startsAtLocal, endsAtLocal, ianaTimeZone);
        if (end <= start || end - start > MaxDuration) return "invalid_shift";
        return work.All(item => start <= item.Start && item.End <= end) ? null : "shift_uncovers_work";
    }
}
