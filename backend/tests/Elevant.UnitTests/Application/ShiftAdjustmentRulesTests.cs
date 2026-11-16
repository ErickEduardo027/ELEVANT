using Elevant.Application.Common;
using Elevant.Application.Identity;

namespace Elevant.UnitTests.Application;

/// <summary>3-E: OCC and Gestión Humana adjust a shift of today or later without uncovering the agent's work.</summary>
public sealed class ShiftAdjustmentRulesTests
{
    private const string Zone = "America/Santo_Domingo";
    private static readonly DateOnly Day = new(2026, 11, 9);

    /// <summary>An instant of <paramref name="day"/> in Santo Domingo (UTC−4, no daylight saving).</summary>
    private static DateTimeOffset Local(DateOnly day, int hour, int minute = 0) =>
        new DateTimeOffset(day.ToDateTime(new TimeOnly(0, 0)), TimeSpan.FromHours(-4)).AddHours(hour).AddMinutes(minute);

    private static string? Check(int start, int end, IReadOnlyCollection<(DateTimeOffset Start, DateTimeOffset End)>? work = null,
        DateOnly? today = null, bool validated = false, DateOnly? day = null) =>
        ShiftAdjustmentRules.Check(day ?? Day, today ?? Day, new TimeOnly(start, 0), new TimeOnly(end, 0), Zone, work ?? [],
            validated);

    [Fact]
    public void AShiftWiderThanItsWorkIsAdjusted()
    {
        Assert.Null(Check(8, 13, [(Local(Day, 10), Local(Day, 11))]));
        Assert.Null(Check(7, 12));
    }

    [Fact]
    public void ShorteningItLeavesAssignedWorkUncovered()
    {
        Assert.Equal("shift_uncovers_work", Check(8, 10, [(Local(Day, 10), Local(Day, 11))]));
        Assert.Equal("shift_uncovers_work", Check(10, 18, [(Local(Day, 9, 30), Local(Day, 11))]));
    }

    [Fact]
    public void ANightShiftCrossesMidnight()
    {
        // 20:00–04:00 still covers a flight at 01:30 of the next day; 20:00–01:00 no longer does.
        var night = new[] { (Local(Day.AddDays(1), 1, 30), Local(Day.AddDays(1), 2, 15)) };
        Assert.Null(Check(20, 4, night));
        Assert.Equal("shift_uncovers_work", Check(20, 1, night));
    }

    [Fact]
    public void ThePastIsReadInTheStationsCalendar()
    {
        // 22:00 in Santo Domingo is already the next UTC day: the shift of the station's today is still adjusted.
        var lateEvening = Local(Day, 22);
        Assert.Equal(Day, BusinessCalendar.Today(lateEvening, Zone));
        Assert.Null(Check(8, 13, today: BusinessCalendar.Today(lateEvening, Zone)));
        Assert.Equal("shift_in_past", Check(8, 13, today: Day.AddDays(1)));
    }

    [Fact]
    public void AValidatedAttendanceFreezesTheShift() =>
        Assert.Equal("attendance_validated", Check(8, 13, validated: true));

    [Theory]
    [InlineData(8, 8)]
    [InlineData(4, 21)]
    public void AShiftLastsLessThanADayAndAtMostSixteenHours(int start, int end) =>
        Assert.Equal("invalid_shift", Check(start, end));

    [Theory]
    [InlineData(null, null)]
    [InlineData("  Ok ", null)]
    [InlineData("  El vuelo se extendió.  ", "El vuelo se extendió.")]
    public void TheReasonIsTrimmedAndNeedsFiveToFiveHundredCharacters(string? reason, string? expected) =>
        Assert.Equal(expected, ShiftAdjustmentRules.Reason(reason));

    [Fact]
    public void ALongReasonIsRefused() => Assert.Null(ShiftAdjustmentRules.Reason(new string('x', 501)));
}
