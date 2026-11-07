using System.Globalization;
using Elevant.Application.Common;

namespace Elevant.UnitTests.Application;

/// <summary>2-F: business days follow America/Santo_Domingo (or the station's zone), never the UTC day.</summary>
public sealed class BusinessCalendarTests
{
    [Theory]
    // 21:00 on 5 November in Santo Domingo is already 6 November in UTC.
    [InlineData("2026-11-06T01:00:00+00:00", "2026-11-05")]
    [InlineData("2026-11-06T03:59:59+00:00", "2026-11-05")]
    [InlineData("2026-11-06T04:00:00+00:00", "2026-11-06")]
    [InlineData("2026-11-05T12:00:00-04:00", "2026-11-05")]
    public void TodayIsTheDayInSantoDomingo(string instant, string expected) =>
        Assert.Equal(Day(expected), BusinessCalendar.Today(Instant(instant)));

    [Fact]
    public void TodayUsesTheStationZoneWhenGiven()
    {
        var instant = Instant("2026-11-06T01:00:00+00:00");
        Assert.Equal(new DateOnly(2026, 11, 6), BusinessCalendar.Today(instant, "Europe/Madrid"));
        Assert.Equal(new DateOnly(2026, 11, 5), BusinessCalendar.Today(instant, "America/New_York"));
        // Blank or unknown zones fall back to AVIAM's calendar.
        Assert.Equal(new DateOnly(2026, 11, 5), BusinessCalendar.Today(instant, " "));
        Assert.Equal(new DateOnly(2026, 11, 5), BusinessCalendar.Today(instant, "Mars/Olympus_Mons"));
    }

    [Fact]
    public void StartAndEndOfTheDayAreInstantsOfTheZone()
    {
        var day = new DateOnly(2026, 11, 5);
        Assert.Equal(Instant("2026-11-05T04:00:00+00:00"), BusinessCalendar.StartOfDay(day));
        Assert.Equal(TimeSpan.FromHours(-4), BusinessCalendar.StartOfDay(day).Offset);
        Assert.Equal(Instant("2026-11-06T03:59:59.999+00:00"), BusinessCalendar.EndOfDay(day));
        Assert.Equal(day, BusinessCalendar.Today(BusinessCalendar.EndOfDay(day)));
        Assert.Equal(day.AddDays(1), BusinessCalendar.Today(BusinessCalendar.EndOfDay(day).AddMilliseconds(1)));
    }

    [Fact]
    public void ADaylightSavingDayStartsAtItsFirstValidTime()
    {
        // New York keeps midnight on the switch days; the start is still within that local day.
        var start = BusinessCalendar.StartOfDay(new DateOnly(2026, 3, 8), "America/New_York");
        Assert.Equal(new DateOnly(2026, 3, 8), BusinessCalendar.Today(start, "America/New_York"));
        Assert.Equal(TimeSpan.FromHours(-5), start.Offset);
    }

    private static DateOnly Day(string value) => DateOnly.ParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static DateTimeOffset Instant(string value) => DateTimeOffset.Parse(value, CultureInfo.InvariantCulture);
}
