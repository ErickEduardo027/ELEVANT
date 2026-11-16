using Elevant.Application.Finance;
using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

/// <summary>ADR-0034: the surcharges AVIAM's Service Order describes, detected from the recorded times.</summary>
public sealed class AutomaticSurchargePolicyTests
{
    private static readonly TimeZoneInfo SantoDomingo = TimeZoneInfo.FindSystemTimeZoneById("America/Santo_Domingo");
    private static readonly IReadOnlyDictionary<string, int> Grace =
        new Dictionary<string, int> { [AutomaticSurchargeCodes.Overtime] = 15, [AutomaticSurchargeCodes.Delay] = 30 };

    // Santo Domingo is UTC-4 all year.
    private static DateTimeOffset Local(int year, int month, int day, int hour, int minute = 0) =>
        new(year, month, day, hour, minute, 0, TimeSpan.FromHours(-4));

    private static IReadOnlyList<string> Detect(DateTimeOffset start, DateTimeOffset? end = null,
        DateTimeOffset? scheduled = null, DateTimeOffset? actual = null, int? allowed = null,
        params DateOnly[] holidays) =>
        AutomaticSurchargePolicy.Detect(new AutomaticSurchargeInput(start, end ?? start.AddMinutes(45), scheduled, actual,
            SantoDomingo, holidays.ToHashSet(), allowed), Grace);

    [Theory]
    [InlineData(22, 0, true)]
    [InlineData(23, 30, true)]
    [InlineData(0, 0, true)]
    [InlineData(5, 59, true)]
    [InlineData(6, 0, false)]
    [InlineData(21, 59, false)]
    public void Night_runs_from_22_00_to_05_59_station_time(int hour, int minute, bool night)
    {
        // A Thursday, no holiday.
        var codes = Detect(Local(2026, 11, 5, hour, minute));
        Assert.Equal(night, codes.Contains(AutomaticSurchargeCodes.Night));
        Assert.DoesNotContain(AutomaticSurchargeCodes.Holiday, codes);
    }

    [Fact]
    public void Night_is_read_in_the_station_zone_not_in_utc()
    {
        // 02:30 UTC is 22:30 the previous day in Santo Domingo.
        Assert.Contains(AutomaticSurchargeCodes.Night,
            Detect(new DateTimeOffset(2026, 11, 6, 2, 30, 0, TimeSpan.Zero)));
    }

    [Fact]
    public void Sundays_and_holidays_count_between_06_00_and_21_59_and_never_with_night()
    {
        Assert.Equal([AutomaticSurchargeCodes.Holiday], Detect(Local(2026, 11, 8, 10)));
        Assert.Equal([AutomaticSurchargeCodes.Night], Detect(Local(2026, 11, 8, 23)));
        Assert.Equal([AutomaticSurchargeCodes.Holiday],
            Detect(Local(2026, 11, 6, 9), holidays: new DateOnly(2026, 11, 6)));
        Assert.Empty(Detect(Local(2026, 11, 6, 9), holidays: new DateOnly(2026, 11, 7)));
    }

    [Fact]
    public void Package_exceeded_needs_an_allowance_and_counts_after_its_grace()
    {
        var start = Local(2026, 11, 5, 10);
        Assert.Empty(Detect(start, start.AddMinutes(200)));
        Assert.Empty(Detect(start, start.AddMinutes(90), allowed: 75));
        Assert.Equal([AutomaticSurchargeCodes.Overtime], Detect(start, start.AddMinutes(91), allowed: 75));
    }

    [Fact]
    public void Arrival_delay_counts_after_its_grace()
    {
        var start = Local(2026, 11, 5, 10);
        var scheduled = Local(2026, 11, 5, 9, 30);
        Assert.Empty(Detect(start, scheduled: scheduled, actual: scheduled.AddMinutes(30)));
        Assert.Equal([AutomaticSurchargeCodes.Delay], Detect(start, scheduled: scheduled, actual: scheduled.AddMinutes(31)));
        Assert.Empty(Detect(start, scheduled: scheduled, actual: scheduled.AddMinutes(-10)));
    }

    [Fact]
    public void Minutes_never_go_negative_and_unknown_inputs_stay_unknown()
    {
        var start = Local(2026, 11, 5, 10);
        Assert.Equal(0m, AutomaticSurchargePolicy.GroundMinutes(start, start.AddMinutes(-5)));
        Assert.Equal(80m, AutomaticSurchargePolicy.GroundMinutes(start, start.AddMinutes(80).AddSeconds(59)));
        Assert.Null(AutomaticSurchargePolicy.GroundMinutes(start, null));
        Assert.Equal(5m, AutomaticSurchargePolicy.OverrunMinutes(80, 75));
        Assert.Equal(0m, AutomaticSurchargePolicy.OverrunMinutes(60, 75));
        Assert.Null(AutomaticSurchargePolicy.OverrunMinutes(80, null));
    }

    [Theory]
    [InlineData(14, false)]
    [InlineData(15, true)]
    [InlineData(720, true)]
    [InlineData(721, false)]
    public void Finance_allowances_stay_between_15_minutes_and_12_hours(int minutes, bool valid) =>
        Assert.Equal(valid, FinanceCloseRulesPolicy.IsValidMinutes(minutes));

    [Fact]
    public void Holiday_names_and_categories_are_normalized()
    {
        Assert.Equal("Día de la Independencia", FinanceCloseRulesPolicy.NormalizeName("  Día  de la   Independencia "));
        Assert.Null(FinanceCloseRulesPolicy.NormalizeName(" x "));
        Assert.Equal(AircraftSizeCategory.Widebody, FinanceCloseRulesPolicy.ParseCategory("widebody"));
        Assert.Null(FinanceCloseRulesPolicy.ParseCategory("Jumbo"));
        Assert.Null(FinanceCloseRulesPolicy.ParseCategory("7"));
    }
}
