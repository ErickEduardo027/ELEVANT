using Elevant.Application.Operations;

namespace Elevant.UnitTests.Application;

public sealed class OccShiftCoveragePolicyTests
{
    private static readonly DateOnly WorkDate = new(2026, 8, 19);

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
}
