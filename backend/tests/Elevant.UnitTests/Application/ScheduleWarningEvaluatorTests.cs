using Elevant.Application.Identity;

namespace Elevant.UnitTests.Application;

public sealed class ScheduleWarningEvaluatorTests
{
    private static readonly Guid Puj = Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly Guid Jfk = Guid.Parse("20000000-0000-7000-8000-000000000091");
    private static readonly Guid Agent = Guid.Parse("50000000-0000-7000-8000-000000000001");
    private static readonly ScheduleWarningRule Rule = new("dev-2026-10-05",
        new DateOnly(2026, 10, 5), TimeSpan.FromHours(12), TimeSpan.FromHours(48));

    [Theory]
    [InlineData(3, 59, 719)]
    [InlineData(4, 0, null)]
    public void ShortRestUsesActualOvernightInstants(int nextHour, int nextMinute,
        int? expectedMinutes)
    {
        var shifts = new[]
        {
            Shift(1, Puj, "PUJ", "America/Santo_Domingo", 5, 8, 0, 16, 0),
            Shift(2, Puj, "PUJ", "America/Santo_Domingo", 6,
                nextHour, nextMinute, 12, 0),
        };

        var warnings = Evaluate(shifts, new DateOnly(2026, 10, 6));
        var rest = warnings.Where(item => item.Kind == ScheduleWarningKind.ShortRest).ToArray();
        if (expectedMinutes is null) Assert.Empty(rest);
        else
        {
            Assert.Equal(expectedMinutes, Assert.Single(rest).MeasuredMinutes);
            Assert.Equal(720, rest[0].ThresholdMinutes);
            Assert.Equal(shifts[1].Id, rest[0].AnchorShiftId);
        }
    }

    [Fact]
    public void MidnightEndingShiftUsesTheFollowingLocalDate()
    {
        var shifts = new[]
        {
            Shift(1, Puj, "PUJ", "America/Santo_Domingo", 5, 23, 0, 8, 0),
            Shift(2, Puj, "PUJ", "America/Santo_Domingo", 6, 19, 59, 23, 0),
        };

        var warning = Assert.Single(Evaluate(shifts, new DateOnly(2026, 10, 6)),
            item => item.Kind == ScheduleWarningKind.ShortRest);
        Assert.Equal(719, warning.MeasuredMinutes);
    }

    [Theory]
    [InlineData(2026, 3, 8, 2, 30, "NonexistentLocalTime")]
    [InlineData(2026, 11, 1, 1, 30, "AmbiguousLocalTime")]
    public void DstGapAndFoldAreUnevaluable(int year, int month, int day, int hour,
        int minute, string reason)
    {
        var shift = Shift(3, Jfk, "JFK", "America/New_York", day,
            hour, minute, 10, 0, month, year);

        var warning = Assert.Single(ScheduleWarningEvaluator.Evaluate([shift], Jfk,
            TimeZoneInfo.FindSystemTimeZoneById("America/New_York"),
            new DateOnly(year, month, day), new DateOnly(year, month, day), Rule));
        Assert.Equal(ScheduleWarningKind.Unevaluable, warning.Kind);
        Assert.Null(warning.MeasuredMinutes);
        Assert.Equal(reason, warning.Reason);
    }

    [Fact]
    public void OverlapIsSeparateAndDoesNotDoubleCountSevenDayLoad()
    {
        var shifts = Enumerable.Range(1, 6)
            .Select(day => Shift(day, Puj, "PUJ", "America/Santo_Domingo",
                day, 8, 0, 16, 0))
            .Append(Shift(9, Puj, "PUJ", "America/Santo_Domingo", 6,
                12, 0, 14, 0)).ToArray();

        var warnings = Evaluate(shifts, new DateOnly(2026, 10, 6));
        Assert.Contains(warnings, item => item.Kind == ScheduleWarningKind.Overlap &&
            item.MeasuredMinutes == 120);
        Assert.DoesNotContain(warnings, item => item.Kind == ScheduleWarningKind.SevenDayLoad);
    }

    [Fact]
    public void SimultaneousStartOfTwoConfirmedShiftsIsAnOverlap()
    {
        var shifts = new[]
        {
            Shift(1, Puj, "PUJ", "America/Santo_Domingo", 6, 8, 0, 16, 0),
            Shift(2, Puj, "PUJ", "America/Santo_Domingo", 6, 8, 0, 12, 0),
        };

        var warnings = Evaluate(shifts, new DateOnly(2026, 10, 6));
        Assert.Contains(warnings, item => item.Kind == ScheduleWarningKind.Overlap &&
            item.MeasuredMinutes == 240);
    }

    [Theory]
    [InlineData(0, false)]
    [InlineData(1, true)]
    public void SevenDayLoadWarnsOnlyAboveFortyEightHours(int extraMinute,
        bool shouldWarn)
    {
        var shifts = Enumerable.Range(1, 5)
            .Select(day => Shift(day, Puj, "PUJ", "America/Santo_Domingo",
                day, 8, 0, 16, 0))
            .Append(Shift(7, Puj, "PUJ", "America/Santo_Domingo", 7,
                8, 0, 16, extraMinute)).ToArray();

        var load = Evaluate(shifts, new DateOnly(2026, 10, 7))
            .Where(item => item.Kind == ScheduleWarningKind.SevenDayLoad).ToArray();
        if (!shouldWarn) Assert.Empty(load);
        else
        {
            Assert.Equal(2881, Assert.Single(load).MeasuredMinutes);
            Assert.Equal(2880, load[0].ThresholdMinutes);
            Assert.Equal(Rule.Version, load[0].RuleVersion);
        }
    }

    [Fact]
    public void CrossStationRestKeepsHiddenShiftDetailsAndMeasuredTimePrivate()
    {
        var hidden = Shift(10, Jfk, "JFK", "America/New_York", 5,
            20, 0, 23, 0) with { CanReveal = false };
        var visible = Shift(11, Puj, "PUJ", "America/Santo_Domingo", 6,
            8, 0, 16, 0);

        var warning = Assert.Single(Evaluate([hidden, visible],
            new DateOnly(2026, 10, 6)),
            item => item.Kind == ScheduleWarningKind.ShortRest);
        Assert.True(warning.HasRestrictedEvidence);
        Assert.Null(warning.MeasuredMinutes);
        Assert.DoesNotContain(warning.Evidence, evidence => evidence.ShiftId == hidden.Id);
        Assert.Contains(warning.Evidence, evidence => evidence.ShiftId == visible.Id);
    }

    [Fact]
    public void UnevaluableHiddenContextIsMarkedRestrictedWithoutItsDetails()
    {
        var hidden = Shift(12, Jfk, "JFK", "America/New_York", 1,
            1, 30, 8, 0, 11) with { CanReveal = false };
        var visible = Shift(13, Puj, "PUJ", "America/Santo_Domingo", 2,
            8, 0, 16, 0, 11);

        var warning = Assert.Single(Evaluate([hidden, visible],
            new DateOnly(2026, 11, 2)));
        Assert.Equal(ScheduleWarningKind.Unevaluable, warning.Kind);
        Assert.True(warning.HasRestrictedEvidence);
        Assert.Null(warning.MeasuredMinutes);
        Assert.DoesNotContain(warning.Evidence, item => item.ShiftId == hidden.Id);
    }

    private static IReadOnlyList<ScheduleWarning> Evaluate(
        IReadOnlyList<ScheduleShift> shifts, DateOnly day) =>
        ScheduleWarningEvaluator.Evaluate(shifts, Puj,
            TimeZoneInfo.FindSystemTimeZoneById("America/Santo_Domingo"),
            day, day, Rule);

    private static ScheduleShift Shift(int id, Guid stationId, string stationCode,
        string zone, int day, int startHour, int startMinute, int endHour,
        int endMinute, int month = 10, int year = 2026) =>
        new(Guid.Parse($"50000000-0000-7000-8000-{id:000000000000}"),
            Agent, "Riley Ramp", "DEV-RA-001", stationId, stationCode, zone,
            new DateOnly(year, month, day), new TimeOnly(startHour, startMinute),
            new TimeOnly(endHour, endMinute), true);
}
