using System.Collections.Concurrent;

namespace Elevant.Application.Common;

/// <summary>
/// The business day of AVIAM (2-F): rules that count days (contract validity and signature dates,
/// permit expiry, terminations, sweeps) use the calendar of the station's IANA time zone when the
/// rule has one and, otherwise, America/Santo_Domingo (UTC−4 all year). The UTC day is never a
/// business day: from 20:00 to 23:59 in the Dominican Republic it is already tomorrow.
/// </summary>
public static class BusinessCalendar
{
    /// <summary>Time zone of AVIAM's commercial calendar.</summary>
    public const string DefaultTimeZone = "America/Santo_Domingo";

    private static readonly ConcurrentDictionary<string, TimeZoneInfo> Zones = new(StringComparer.Ordinal);

    /// <summary>The calendar day of <paramref name="now"/> in the given zone (the default one when null or empty).</summary>
    public static DateOnly Today(DateTimeOffset now, string? ianaTimeZone = null) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, Zone(ianaTimeZone)).DateTime);

    /// <summary>First instant of <paramref name="day"/> in the zone, with the zone's offset.</summary>
    public static DateTimeOffset StartOfDay(DateOnly day, string? ianaTimeZone = null)
    {
        var zone = Zone(ianaTimeZone);
        var local = DateTime.SpecifyKind(day.ToDateTime(TimeOnly.MinValue), DateTimeKind.Unspecified);
        // A daylight-saving jump at midnight skips it: the day starts at the first valid local time.
        while (zone.IsInvalidTime(local)) local = local.AddMinutes(30);
        return new DateTimeOffset(local, zone.GetUtcOffset(local));
    }

    /// <summary>Last millisecond of <paramref name="day"/> in the zone (stored instants keep milliseconds).</summary>
    public static DateTimeOffset EndOfDay(DateOnly day, string? ianaTimeZone = null) =>
        StartOfDay(day.AddDays(1), ianaTimeZone).AddMilliseconds(-1);

    /// <summary>
    /// The zone for an IANA identifier. An unknown identifier falls back to the default zone; if the
    /// host has no time zone data at all, the default zone is UTC−4 without daylight saving.
    /// </summary>
    public static TimeZoneInfo Zone(string? ianaTimeZone = null) =>
        Zones.GetOrAdd(string.IsNullOrWhiteSpace(ianaTimeZone) ? DefaultTimeZone : ianaTimeZone.Trim(), Resolve);

    private static TimeZoneInfo Resolve(string id)
    {
        if (Find(id) is { } zone) return zone;
        if (!string.Equals(id, DefaultTimeZone, StringComparison.Ordinal)) return Zone(DefaultTimeZone);
        return TimeZoneInfo.CreateCustomTimeZone(DefaultTimeZone, TimeSpan.FromHours(-4), DefaultTimeZone, DefaultTimeZone);
    }

    private static TimeZoneInfo? Find(string id)
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById(id); }
        catch (TimeZoneNotFoundException) { }
        catch (InvalidTimeZoneException) { }
        // Windows hosts without ICU only know their own identifiers.
        if (!TimeZoneInfo.TryConvertIanaIdToWindowsId(id, out var windowsId)) return null;
        try { return TimeZoneInfo.FindSystemTimeZoneById(windowsId); }
        catch (TimeZoneNotFoundException) { return null; }
        catch (InvalidTimeZoneException) { return null; }
    }
}
