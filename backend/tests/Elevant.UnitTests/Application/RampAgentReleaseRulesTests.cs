using Elevant.Application.Identity;

namespace Elevant.UnitTests.Application;

/// <summary>2-N06, 2-N08, 2-N22: the instants the release path takes and what an approved absence admits.</summary>
public sealed class RampAgentReleaseRulesTests
{
    private const string Zone = "America/Santo_Domingo";

    [Fact]
    public void AShiftIsReadInItsStationsZoneAndANightShiftEndsTheNextDay()
    {
        var (start, end) = RampAgentReleaseRules.ShiftWindow(new DateOnly(2026, 11, 5), new TimeOnly(22, 0),
            new TimeOnly(6, 0), Zone);
        Assert.Equal(new DateTimeOffset(2026, 11, 6, 2, 0, 0, TimeSpan.Zero), start);
        Assert.Equal(new DateTimeOffset(2026, 11, 6, 10, 0, 0, TimeSpan.Zero), end);
        var (dayStart, dayEnd) = RampAgentReleaseRules.ShiftWindow(new DateOnly(2026, 11, 5), new TimeOnly(6, 0),
            new TimeOnly(14, 0), Zone);
        Assert.Equal(TimeSpan.FromHours(8), dayEnd - dayStart);
    }

    [Fact]
    public void AnAbsenceTakesItsLocalDaysWithTheNightShiftsAtItsEdges()
    {
        var first = new DateOnly(2026, 11, 10);
        var last = new DateOnly(2026, 11, 12);
        var (from, until) = RampAgentReleaseRules.AbsenceWindow(first, last, Zone);
        // Local midnight in the Dominican Republic is 04:00 UTC.
        Assert.Equal(new DateTimeOffset(2026, 11, 10, 4, 0, 0, TimeSpan.Zero), from);
        Assert.Equal(new DateTimeOffset(2026, 11, 13, 4, 0, 0, TimeSpan.Zero), until);

        // The night shift of the day before keeps its hours after midnight; the last night goes with the absence.
        var previousNight = new DateTimeOffset(2026, 11, 10, 10, 0, 0, TimeSpan.Zero);
        var lastNight = new DateTimeOffset(2026, 11, 13, 10, 0, 0, TimeSpan.Zero);
        var (edgeFrom, edgeUntil) = RampAgentReleaseRules.AbsenceWindow(first, last, Zone, previousNight, lastNight);
        Assert.Equal(previousNight, edgeFrom);
        Assert.Equal(lastNight, edgeUntil);
        Assert.Throws<ArgumentException>(() => RampAgentReleaseRules.AbsenceWindow(last, first, Zone));
    }

    [Theory]
    [InlineData(AbsenceAmendmentAction.Cancel, 5, 9, null, null)]
    [InlineData(AbsenceAmendmentAction.Cancel, 1, 9, null, null)]
    [InlineData(AbsenceAmendmentAction.Cancel, 0, 9, null, "absence_started")]
    [InlineData(AbsenceAmendmentAction.Cancel, -3, -1, null, "absence_ended")]
    [InlineData(AbsenceAmendmentAction.Shorten, -3, 9, 2, null)]
    [InlineData(AbsenceAmendmentAction.Shorten, -3, 9, 0, null)]
    [InlineData(AbsenceAmendmentAction.Shorten, -3, 9, -1, null)]
    [InlineData(AbsenceAmendmentAction.Shorten, -3, 9, -2, "absence_end_invalid")]
    [InlineData(AbsenceAmendmentAction.Shorten, -3, 9, 9, "absence_end_invalid")]
    [InlineData(AbsenceAmendmentAction.Shorten, 5, 9, 4, "absence_end_invalid")]
    [InlineData(AbsenceAmendmentAction.Shorten, 5, 9, 6, null)]
    [InlineData(AbsenceAmendmentAction.Shorten, -3, 9, null, "absence_end_invalid")]
    [InlineData(AbsenceAmendmentAction.Shorten, -5, -2, -3, "absence_ended")]
    public void AnApprovedAbsenceIsCancelledBeforeItStartsAndShortenedWhileItLasts(AbsenceAmendmentAction action,
        int startsIn, int endsIn, int? newEndIn, string? code)
    {
        // Relative to «today»: a new last day is never before yesterday nor before the first day.
        var today = new DateOnly(2026, 11, 6);
        Assert.Equal(code, AbsenceAmendmentRules.Check(action, today.AddDays(startsIn), today.AddDays(endsIn),
            newEndIn is { } days ? today.AddDays(days) : null, today));
    }

    [Theory]
    [InlineData(0, 30)]
    [InlineData(-4, 30)]
    [InlineData(366, 30)]
    [InlineData(7, 7)]
    [InlineData(365, 365)]
    public void TheExpiryNoticeDaysFallBackToThirty(int configured, int applied) =>
        Assert.Equal(applied, new HumanResourcesDocumentOptions { DocumentExpiryNoticeDays = configured }.NoticeDays);
}
