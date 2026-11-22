using Elevant.Application.Common;

namespace Elevant.Infrastructure.Persistence.Seed.History;

/// <summary>
/// Local time of the station (America/Santo_Domingo through <see cref="BusinessCalendar"/>). Every instant the
/// history writes is UTC, whole milliseconds, and falls between <see cref="DayStart"/> and <see cref="DayEnd"/> local
/// time: nothing happens between 22:30 and 05:30.
/// </summary>
internal sealed class HistoryClock
{
    public static readonly TimeOnly DayStart = new(5, 30);
    public static readonly TimeOnly DayEnd = new(22, 30);

    public HistoryClock(string? ianaTimeZone)
    {
        TimeZoneId = string.IsNullOrWhiteSpace(ianaTimeZone) ? BusinessCalendar.DefaultTimeZone : ianaTimeZone;
        Zone = BusinessCalendar.Zone(TimeZoneId);
    }

    public string TimeZoneId { get; }

    public TimeZoneInfo Zone { get; }

    /// <summary>The UTC instant of a local date and time, clamped to the operating day.</summary>
    public DateTimeOffset At(DateOnly date, TimeOnly localTime) => ToUtc(date, Clamp(localTime));

    /// <summary>The UTC instant of a local date and minutes after midnight, clamped to the operating day.</summary>
    public DateTimeOffset At(DateOnly date, int minutesAfterMidnight) =>
        At(date, TimeOnly.FromTimeSpan(TimeSpan.FromMinutes(Math.Clamp(minutesAfterMidnight, 0, 24 * 60 - 1))));

    /// <summary>The UTC instant of a local date and time, without clamping (for instants that are not activity).</summary>
    public DateTimeOffset ToUtc(DateOnly date, TimeOnly localTime)
    {
        var local = DateTime.SpecifyKind(date.ToDateTime(localTime), DateTimeKind.Unspecified);
        return Truncate(new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(local, Zone), TimeSpan.Zero));
    }

    /// <summary>The same instant moved into the operating day of its local date (earlier → 05:30, later → 22:30).</summary>
    public DateTimeOffset Clamp(DateTimeOffset instant)
    {
        var local = TimeZoneInfo.ConvertTime(instant, Zone);
        var time = TimeOnly.FromDateTime(local.DateTime);
        var clamped = Clamp(time);
        return clamped == time ? Truncate(instant.ToUniversalTime()) : ToUtc(DateOnly.FromDateTime(local.DateTime), clamped);
    }

    public static TimeOnly Clamp(TimeOnly localTime) =>
        localTime < DayStart ? DayStart : localTime > DayEnd ? DayEnd : localTime;

    /// <summary>Whether the instant falls inside the operating day, local time.</summary>
    public bool IsOperatingTime(DateTimeOffset instant)
    {
        var time = TimeOnly.FromDateTime(TimeZoneInfo.ConvertTime(instant, Zone).DateTime);
        return time >= DayStart && time <= DayEnd;
    }

    /// <summary>The local date of an instant.</summary>
    public DateOnly LocalDate(DateTimeOffset instant) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(instant, Zone).DateTime);

    /// <summary>The local wall-clock time of an instant.</summary>
    public TimeOnly LocalTime(DateTimeOffset instant) =>
        TimeOnly.FromDateTime(TimeZoneInfo.ConvertTime(instant, Zone).DateTime);

    /// <summary>Whole milliseconds, as <c>datetimeoffset(3)</c> stores them.</summary>
    public static DateTimeOffset Truncate(DateTimeOffset instant) =>
        new(instant.Ticks - instant.Ticks % TimeSpan.TicksPerMillisecond, instant.Offset);
}
