using Elevant.Application.Common;

namespace Elevant.Application.Identity;

/// <summary>
/// Pure rules of the one path that takes work off a ramp agent (2-N06, 2-N08): the instants of a shift and the
/// instants an approved absence takes from the agent at one station. Days are the station's calendar days
/// (<see cref="BusinessCalendar"/>); the UTC day is never a working day.
/// </summary>
public static class RampAgentReleaseRules
{
    /// <summary>
    /// The shift as instants in its station's zone; an end at or before the start crosses midnight. A local
    /// time a daylight-saving jump skips moves forward to the first valid minute.
    /// </summary>
    public static (DateTimeOffset Start, DateTimeOffset End) ShiftWindow(DateOnly workDate, TimeOnly startsAtLocal,
        TimeOnly endsAtLocal, string? ianaTimeZone)
    {
        var zone = BusinessCalendar.Zone(ianaTimeZone);
        var start = Instant(workDate.ToDateTime(startsAtLocal), zone);
        var end = Instant((endsAtLocal <= startsAtLocal ? workDate.AddDays(1) : workDate).ToDateTime(endsAtLocal), zone);
        return (start, end);
    }

    /// <summary>
    /// What an approved absence from <paramref name="startsOn"/> to <paramref name="endsOn"/> (both included)
    /// takes from the agent at one station: from the start of the first day to the start of the day after the
    /// last one. The night shift of the day before keeps its hours after midnight (the agent works it), and the
    /// night shift of the last day takes its hours after midnight with it (the agent does not work it).
    /// </summary>
    public static (DateTimeOffset From, DateTimeOffset Until) AbsenceWindow(DateOnly startsOn, DateOnly endsOn,
        string? ianaTimeZone, DateTimeOffset? previousNightEndsAt = null, DateTimeOffset? lastNightEndsAt = null)
    {
        if (endsOn < startsOn) throw new ArgumentException("The absence ends before it starts.", nameof(endsOn));
        var from = BusinessCalendar.StartOfDay(startsOn, ianaTimeZone);
        var until = BusinessCalendar.StartOfDay(endsOn.AddDays(1), ianaTimeZone);
        if (previousNightEndsAt is { } previous && previous > from) from = previous < until ? previous : until;
        if (lastNightEndsAt is { } last && last > until) until = last;
        return (from, until);
    }

    private static DateTimeOffset Instant(DateTime local, TimeZoneInfo zone)
    {
        var value = DateTime.SpecifyKind(local, DateTimeKind.Unspecified);
        while (zone.IsInvalidTime(value)) value = value.AddMinutes(30);
        return new DateTimeOffset(value, zone.GetUtcOffset(value)).ToUniversalTime();
    }
}

/// <summary>What Gestión Humana does to an approved absence (2-N22).</summary>
public enum AbsenceAmendmentAction
{
    /// <summary>It has not started: it is cancelled.</summary>
    Cancel,
    /// <summary>It has not ended: it ends earlier.</summary>
    Shorten,
}

/// <summary>
/// 2-N22: an approved absence is cancelled while it has not started, and shortened (an earlier last day, never
/// before yesterday nor before its first day) while it has not ended. Nothing it released comes back.
/// </summary>
public static class AbsenceAmendmentRules
{
    /// <summary>Null when the amendment applies; otherwise the Problem Details code of the broken rule.</summary>
    public static string? Check(AbsenceAmendmentAction action, DateOnly startsOn, DateOnly endsOn, DateOnly? newEndsOn,
        DateOnly today)
    {
        if (endsOn < today) return "absence_ended";
        if (action == AbsenceAmendmentAction.Cancel) return startsOn > today ? null : "absence_started";
        return newEndsOn is { } end && end < endsOn && end >= startsOn && end >= today.AddDays(-1)
            ? null : "absence_end_invalid";
    }
}
