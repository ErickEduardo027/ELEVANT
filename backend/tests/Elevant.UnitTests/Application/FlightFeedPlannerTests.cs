using Elevant.Application.Abstractions.Integrations;
using Elevant.Application.Integration;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

/// <summary>ADR-0028: when the paid feed is read, so the plan's units last the month.</summary>
public sealed class FlightFeedPlannerTests
{
    // Punta Cana: UTC-4 all year.
    private static readonly TimeZoneInfo Zone = TimeZoneInfo.CreateCustomTimeZone("AST", TimeSpan.FromHours(-4), "AST", "AST");

    private static DateTimeOffset LocalTime(int day, int hour, int minute = 0) =>
        new(2026, 11, day, hour, minute, 0, TimeSpan.FromHours(-4));

    private static FlightFeedPlannerInput Input(DateTimeOffset now, IReadOnlyList<DateTimeOffset>? flights = null,
        IReadOnlyList<FlightFeedFetch>? fetches = null, int today = 0, int month = 0, bool contractsToday = true,
        bool contractsTomorrow = true, DateTimeOffset? pausedUntil = null) =>
        new(now.ToUniversalTime(), Zone, contractsToday, contractsTomorrow, flights ?? [], fetches ?? [], today, month,
            FlightFeedBudget.Default, 2, TimeSpan.FromHours(12), pausedUntil);

    private static FlightFeedFetch Fetch(DateTime from, DateTime to, DateTimeOffset at) => new(from, to, at.ToUniversalTime());

    private static FlightFeedFetch[] BothHalves(int day, DateTimeOffset at)
    {
        var date = new DateTime(2026, 11, day);
        return [.. FlightFeedPlanner.Halves(date).Select(half => Fetch(half.From, half.To, at))];
    }

    [Fact]
    public void ReadsEachHalfOfTodayOnceThenNothingWithoutFlights()
    {
        var now = LocalTime(3, 6);
        var first = FlightFeedPlanner.Next(Input(now));
        Assert.Equal(("day_import", new DateTime(2026, 11, 3, 0, 0, 0), new DateTime(2026, 11, 3, 11, 59, 0)),
            (first.Reason, first.FromLocal!.Value, first.ToLocal!.Value));
        var second = FlightFeedPlanner.Next(Input(now, fetches: [Fetch(first.FromLocal.Value, first.ToLocal.Value, now)]));
        Assert.Equal((new DateTime(2026, 11, 3, 12, 0, 0), new DateTime(2026, 11, 3, 23, 59, 0)),
            (second.FromLocal!.Value, second.ToLocal!.Value));
        Assert.Equal("no_contracted_flights", FlightFeedPlanner.Next(Input(now, fetches: BothHalves(3, now))).Reason);
    }

    [Fact]
    public void SkipsAMorningHalfThatEndedLongAgo()
    {
        var now = LocalTime(3, 15);
        var decision = FlightFeedPlanner.Next(Input(now));
        Assert.Equal(new DateTime(2026, 11, 3, 12, 0, 0), decision.FromLocal);
    }

    [Fact]
    public void RefreshesEveryFifteenMinutesNearAFlightAndHourlyOtherwise()
    {
        var now = LocalTime(3, 10);
        var imported = BothHalves(3, LocalTime(3, 5));
        var near = new[] { LocalTime(3, 11, 30) };
        var refresh = FlightFeedPlanner.Next(Input(now, near, imported));
        Assert.Equal(("refresh_near", new DateTime(2026, 11, 3, 8, 0, 0), new DateTime(2026, 11, 3, 20, 0, 0)),
            (refresh.Reason, refresh.FromLocal!.Value, refresh.ToLocal!.Value));

        var refreshed = imported.Append(Fetch(refresh.FromLocal.Value, refresh.ToLocal.Value, now)).ToArray();
        Assert.Equal("up_to_date", FlightFeedPlanner.Next(Input(now.AddMinutes(14), near, refreshed)).Reason);
        Assert.True(FlightFeedPlanner.Next(Input(now.AddMinutes(15), near, refreshed)).ShouldFetch);

        var far = new[] { LocalTime(3, 18) };
        Assert.Equal("up_to_date", FlightFeedPlanner.Next(Input(now.AddMinutes(59), far, refreshed)).Reason);
        Assert.Equal("refresh_far", FlightFeedPlanner.Next(Input(now.AddMinutes(60), far, refreshed)).Reason);
    }

    [Fact]
    public void StopsOnceTheDaysContractedFlightsAreOver()
    {
        var now = LocalTime(3, 17);
        var decision = FlightFeedPlanner.Next(Input(now, [LocalTime(3, 9)], BothHalves(3, LocalTime(3, 5)), contractsTomorrow: false));
        Assert.Equal("day_done", decision.Reason);
    }

    [Fact]
    public void ImportsTomorrowOnceFromSixInTheEvening()
    {
        var imported = BothHalves(3, LocalTime(3, 5));
        Assert.Equal("no_contracted_flights", FlightFeedPlanner.Next(Input(LocalTime(3, 17, 59), fetches: imported)).Reason);
        var decision = FlightFeedPlanner.Next(Input(LocalTime(3, 18), fetches: imported));
        Assert.Equal(("next_day_import", new DateTime(2026, 11, 4, 0, 0, 0)), (decision.Reason, decision.FromLocal!.Value));
        Assert.Equal("no_contracted_flights",
            FlightFeedPlanner.Next(Input(LocalTime(3, 19), fetches: [.. imported, .. BothHalves(4, LocalTime(3, 18))])).Reason);
    }

    [Fact]
    public void DoublesTheIntervalAtEightyPercentAndStopsAtTheLimit()
    {
        var now = LocalTime(3, 10);
        var near = new[] { LocalTime(3, 11) };
        var fetches = BothHalves(3, now.AddMinutes(-20));
        Assert.True(FlightFeedPlanner.Next(Input(now, near, fetches, today: 900)).ShouldFetch);
        Assert.Equal("up_to_date", FlightFeedPlanner.Next(Input(now, near, fetches, today: 960)).Reason);
        Assert.Equal("up_to_date", FlightFeedPlanner.Next(Input(now, near, fetches, month: 30400)).Reason);
        Assert.True(FlightFeedPlanner.Next(Input(now.AddMinutes(10), near, fetches, today: 960)).ShouldFetch);
        Assert.Equal("budget_exhausted", FlightFeedPlanner.Next(Input(now, near, fetches, today: 1199)).Reason);
        Assert.Equal("budget_exhausted", FlightFeedPlanner.Next(Input(now, near, fetches, month: 37999)).Reason);
    }

    [Fact]
    public void NeverCallsWhilePausedOrWithoutContracts()
    {
        var now = LocalTime(3, 10);
        Assert.Equal("paused", FlightFeedPlanner.Next(Input(now, pausedUntil: now.AddMinutes(5))).Reason);
        Assert.True(FlightFeedPlanner.Next(Input(now, pausedUntil: now.AddMinutes(-1))).ShouldFetch);
        Assert.Equal("no_contracts", FlightFeedPlanner.Next(Input(now, contractsToday: false, contractsTomorrow: false)).Reason);
    }

    [Fact]
    public void AStationAtFullActivityStaysFarBelowTheMonthlyPlan()
    {
        // Contracted flights every 90 minutes from 06:00 to 23:00 local: the worst realistic day.
        var flights = Enumerable.Range(0, 12).Select(index => LocalTime(3, 6).AddMinutes(90 * index)).ToArray();
        var fetches = new List<FlightFeedFetch>();
        var units = 0;
        for (var minute = 0; minute < 24 * 60; minute++)
        {
            var now = LocalTime(3, 0).AddMinutes(minute);
            var decision = FlightFeedPlanner.Next(Input(now, flights, fetches, today: units));
            if (!decision.ShouldFetch) continue;
            fetches.Add(Fetch(decision.FromLocal!.Value, decision.ToLocal!.Value, now));
            units += 2;
        }
        Assert.InRange(units, 100, 200);
        Assert.True(units * 31 < FlightFeedBudget.Default.MonthlyUnits / 4, $"{units} units a day");
    }

    [Theory]
    [InlineData(ProviderCallOutcome.Succeeded, 0, null, 0)]
    [InlineData(ProviderCallOutcome.Failed, 0, 1d, 1)]
    [InlineData(ProviderCallOutcome.Failed, 3, 8d, 4)]
    [InlineData(ProviderCallOutcome.Failed, 9, 60d, 10)]
    [InlineData(ProviderCallOutcome.Unauthorized, 0, 360d, 1)]
    public void BacksOffWithoutRetryLoops(ProviderCallOutcome outcome, int previous, double? minutes, int failures)
    {
        var now = new DateTimeOffset(2026, 11, 3, 15, 0, 0, TimeSpan.Zero);
        var (paused, count, _) = FlightFeedSynchronizer.PauseAfter(AirportFeedResponse.Failure(outcome, 0, 500), previous, now);
        Assert.Equal(minutes is null ? null : now.AddMinutes(minutes.Value), paused);
        Assert.Equal(failures, count);
    }

    [Fact]
    public void AQuotaErrorStopsUntilTheNextUtcDayAndARateLimitHonoursRetryAfter()
    {
        var now = new DateTimeOffset(2026, 11, 3, 15, 0, 0, TimeSpan.Zero);
        Assert.Equal(new DateTimeOffset(2026, 11, 4, 0, 5, 0, TimeSpan.Zero),
            FlightFeedSynchronizer.PauseAfter(AirportFeedResponse.Failure(ProviderCallOutcome.QuotaExceeded, 0, 429), 0, now).PausedUntil);
        Assert.Equal(now.AddSeconds(30), FlightFeedSynchronizer.PauseAfter(
            AirportFeedResponse.Failure(ProviderCallOutcome.RateLimited, 0, 429, TimeSpan.FromSeconds(30)), 0, now).PausedUntil);
    }
}
