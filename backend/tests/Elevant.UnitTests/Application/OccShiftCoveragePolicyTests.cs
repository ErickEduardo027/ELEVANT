using Elevant.Application.Operations;

namespace Elevant.UnitTests.Application;

public sealed class OccShiftCoveragePolicyTests
{
    private static readonly DateOnly WorkDate = new(2026, 8, 19);

    /// <summary>A stay of an hour from 19:53 in Punta Cana (23:53 UTC).</summary>
    private static readonly DateTimeOffset StayStart = new(2026, 8, 19, 23, 53, 0, TimeSpan.Zero);

    private static readonly DateTimeOffset StayEnd = StayStart.AddHours(1);

    [Theory]
    [InlineData(6, 0, true)]
    [InlineData(8, 15, true)]
    [InlineData(13, 59, true)]
    [InlineData(14, 0, false)]
    [InlineData(5, 59, false)]
    public void DayShiftUsesInclusiveStartAndExclusiveEnd(
        int hour,
        int minute,
        bool expected)
    {
        var actual = OccShiftCoveragePolicy.Covers(
            WorkDate,
            new TimeOnly(6, 0),
            new TimeOnly(14, 0),
            WorkDate,
            new TimeOnly(hour, minute));

        Assert.Equal(expected, actual);
    }

    [Theory]
    [InlineData(2026, 8, 19, 22, 0, true)]
    [InlineData(2026, 8, 19, 23, 59, true)]
    [InlineData(2026, 8, 20, 0, 0, true)]
    [InlineData(2026, 8, 20, 5, 59, true)]
    [InlineData(2026, 8, 20, 6, 0, false)]
    [InlineData(2026, 8, 19, 21, 59, false)]
    public void OvernightShiftCoversBothCivilDates(
        int year,
        int month,
        int day,
        int hour,
        int minute,
        bool expected)
    {
        var actual = OccShiftCoveragePolicy.Covers(
            WorkDate,
            new TimeOnly(22, 0),
            new TimeOnly(6, 0),
            new DateOnly(year, month, day),
            new TimeOnly(hour, minute));

        Assert.Equal(expected, actual);
    }

    [Fact]
    public void ShiftNeverCoversAnUnrelatedDate()
    {
        Assert.False(OccShiftCoveragePolicy.Covers(
            WorkDate,
            new TimeOnly(6, 0),
            new TimeOnly(14, 0),
            WorkDate.AddDays(1),
            new TimeOnly(8, 0)));
    }

    [Fact]
    public void EqualStartAndEndIsNotAWholeDayShift()
    {
        Assert.False(OccShiftCoveragePolicy.Covers(
            WorkDate,
            new TimeOnly(6, 0),
            new TimeOnly(6, 0),
            WorkDate,
            new TimeOnly(12, 0)));
    }

    [Theory]
    [InlineData(6, 0, 14, 0, 8, 0, 12, 0, true)]
    [InlineData(9, 0, 13, 0, 8, 0, 12, 0, false)]
    [InlineData(6, 0, 11, 0, 8, 0, 12, 0, false)]
    [InlineData(6, 0, 6, 0, 8, 0, 12, 0, false)]
    public void ProgrammedShiftMustCoverWholeOperation(
        int startHour, int startMinute, int endHour, int endMinute,
        int operationStartHour, int operationStartMinute,
        int operationEndHour, int operationEndMinute, bool expected)
    {
        Assert.Equal(expected, OccShiftCoveragePolicy.CoversInterval(
            WorkDate, new TimeOnly(startHour, startMinute), new TimeOnly(endHour, endMinute),
            new DateTime(2026, 8, 19, operationStartHour, operationStartMinute, 0),
            new DateTime(2026, 8, 19, operationEndHour, operationEndMinute, 0)));
    }

    [Fact]
    public void OvernightShiftMayCoverNextDayDeparture()
    {
        Assert.True(OccShiftCoveragePolicy.CoversInterval(
            WorkDate, new TimeOnly(21, 0), new TimeOnly(5, 0),
            new DateTime(2026, 8, 19, 22, 0, 0),
            new DateTime(2026, 8, 20, 2, 0, 0)));
    }

    [Fact]
    public void ShiftLongerThanSixteenHoursIsRejected()
    {
        Assert.False(OccShiftCoveragePolicy.CoversInterval(
            WorkDate, new TimeOnly(5, 0), new TimeOnly(4, 0),
            new DateTime(2026, 8, 19, 8, 0, 0),
            new DateTime(2026, 8, 19, 10, 0, 0)));
    }

    /// <summary>
    /// N24: a shift from 11:00 to 20:00 covered the arrival of a stay from 19:53 to 20:53, not its departure. With the
    /// operation's window the shift must cover all of it.
    /// </summary>
    [Theory]
    [InlineData(11, 20, false)]
    [InlineData(20, 21, false)]
    [InlineData(12, 21, true)]
    [InlineData(19, 21, true)]
    public void WithAWindowTheShiftMustCoverTheWholeStay(int startHour, int endHour, bool expected)
    {
        var stay = (new DateTime(2026, 8, 19, 19, 53, 0), new DateTime(2026, 8, 19, 20, 53, 0));
        Assert.Equal(expected, OccShiftCoveragePolicy.CoversOperation(
            WorkDate, new TimeOnly(startHour, 0), new TimeOnly(endHour, 0), stay.Item1, stay));
    }

    /// <summary>Without a window the shift is judged at the reference instant, as before.</summary>
    [Theory]
    [InlineData(19, 53, true)]
    [InlineData(20, 0, false)]
    public void WithoutAWindowTheShiftCoversTheReferenceInstant(int hour, int minute, bool expected)
    {
        Assert.Equal(expected, OccShiftCoveragePolicy.CoversOperation(
            WorkDate, new TimeOnly(11, 0), new TimeOnly(20, 0), new DateTime(2026, 8, 19, hour, minute, 0), null));
    }

    [Fact]
    public void AnOvernightStayNeedsAShiftUntilItsEnd()
    {
        var stay = (new DateTime(2026, 8, 19, 23, 30, 0), new DateTime(2026, 8, 20, 0, 30, 0));
        Assert.True(OccShiftCoveragePolicy.CoversOperation(
            WorkDate, new TimeOnly(22, 0), new TimeOnly(6, 0), stay.Item1, stay));
        Assert.False(OccShiftCoveragePolicy.CoversOperation(
            WorkDate, new TimeOnly(16, 0), new TimeOnly(0, 0), stay.Item1, stay));
        // The next day's shift from midnight covers the end of the stay, not its start.
        Assert.False(OccShiftCoveragePolicy.CoversOperation(
            WorkDate.AddDays(1), new TimeOnly(0, 0), new TimeOnly(8, 0), stay.Item1, stay));
    }

    /// <summary>
    /// D-N24: before the stay and once it has ended, the whole stay; an assignment made after the planned start, what
    /// is left of it from now.
    /// </summary>
    [Theory]
    [InlineData(-30, 0)]
    [InlineData(0, 0)]
    [InlineData(17, 17)]
    [InlineData(59, 59)]
    [InlineData(60, 0)]
    [InlineData(90, 0)]
    public void TheWindowToCoverIsTheWholeStayOrWhatIsLeftOfIt(int nowMinutes, int fromMinutes)
    {
        Assert.Equal<(DateTimeOffset, DateTimeOffset)?>((StayStart.AddMinutes(fromMinutes), StayEnd),
            OccShiftCoveragePolicy.WindowToCover(StayStart, StayEnd, StayStart.AddMinutes(nowMinutes)));
    }

    [Fact]
    public void AnOperationWithoutAValidWindowHasNoWindowToCover()
    {
        Assert.Null(OccShiftCoveragePolicy.WindowToCover(null, StayEnd, StayStart));
        Assert.Null(OccShiftCoveragePolicy.WindowToCover(StayStart, null, StayStart));
        Assert.Null(OccShiftCoveragePolicy.WindowToCover(StayStart, StayStart, StayStart));
        Assert.Null(OccShiftCoveragePolicy.WindowToCover(StayEnd, StayStart, StayStart));
    }
}
