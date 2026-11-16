namespace Elevant.Application.Integration;

/// <summary>Unit limits of the paid feed. The plan has 40 000 units a month; 38 000 leaves a margin.</summary>
public sealed record FlightFeedBudget(int DailyUnits, int MonthlyUnits)
{
    public static readonly FlightFeedBudget Default = new(1200, 38000);
}

/// <summary>A successful read of a station window in the station's local time.</summary>
public sealed record FlightFeedFetch(DateTime FromLocal, DateTime ToLocal, DateTimeOffset OccurredAt);

/// <summary>Everything the planner needs to decide the next call for one station.</summary>
/// <param name="ContractedFlightTimesToday">Scheduled (or revised) UTC times of today's legs of contracted airlines.</param>
/// <param name="RecentFetches">Successful reads of this station in the last two days.</param>
public sealed record FlightFeedPlannerInput(
    DateTimeOffset NowUtc,
    TimeZoneInfo Zone,
    bool HasContractsToday,
    bool HasContractsTomorrow,
    IReadOnlyList<DateTimeOffset> ContractedFlightTimesToday,
    IReadOnlyList<FlightFeedFetch> RecentFetches,
    int UnitsToday,
    int UnitsThisMonth,
    FlightFeedBudget Budget,
    int UnitsPerCall,
    TimeSpan MaxWindow,
    DateTimeOffset? PausedUntil);

/// <summary>The window to read now, in station local time, or why nothing is read.</summary>
public sealed record FlightFeedDecision(DateTime? FromLocal, DateTime? ToLocal, string Reason)
{
    public bool ShouldFetch => FromLocal is not null;

    public static FlightFeedDecision Skip(string reason) => new(null, null, reason);
}

/// <summary>
/// Decides when the paid feed is read (ADR-0028), so the plan's units last the month:
/// <list type="number">
/// <item>Each half of today (00:00–11:59, 12:00–23:59) is read once, if the station has a
/// contract today and the half has not ended more than two hours ago.</item>
/// <item>From 18:00 local, each half of tomorrow is read once, if a contract covers tomorrow.</item>
/// <item>The active window (two hours back, ten ahead) is refreshed every 15 minutes while a
/// contracted flight is within three hours, every 60 minutes while later flights remain today,
/// and never once the day's contracted flights are over.</item>
/// <item>At 80 % of the daily or monthly budget the refresh interval doubles; a call that would
/// pass either limit, or a pause after a provider error, stops all calls.</item>
/// </list>
/// Arrivals and departures come in the same call, so one read covers both.
/// </summary>
public static class FlightFeedPlanner
{
    public static readonly TimeSpan NearFlight = TimeSpan.FromHours(3);
    public static readonly TimeSpan NearCadence = TimeSpan.FromMinutes(15);
    public static readonly TimeSpan FarCadence = TimeSpan.FromMinutes(60);
    public const int NextDayImportHour = 18;
    private const double PressureRatio = 0.8;

    public static FlightFeedDecision Next(FlightFeedPlannerInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        if (input.PausedUntil is { } paused && paused > input.NowUtc) return FlightFeedDecision.Skip("paused");
        if (input.UnitsToday + input.UnitsPerCall > input.Budget.DailyUnits ||
            input.UnitsThisMonth + input.UnitsPerCall > input.Budget.MonthlyUnits)
            return FlightFeedDecision.Skip("budget_exhausted");
        if (!input.HasContractsToday && !input.HasContractsTomorrow) return FlightFeedDecision.Skip("no_contracts");

        var nowLocal = Minute(TimeZoneInfo.ConvertTime(input.NowUtc, input.Zone).DateTime);
        var today = nowLocal.Date;

        if (input.HasContractsToday)
            foreach (var (from, to) in Halves(today))
                if (to > nowLocal.AddHours(-2) && !Fetched(input, from, to))
                    return new(from, to, "day_import");

        if (input.HasContractsTomorrow && nowLocal.Hour >= NextDayImportHour)
            foreach (var (from, to) in Halves(today.AddDays(1)))
                if (!Fetched(input, from, to))
                    return new(from, to, "next_day_import");

        if (!input.HasContractsToday || input.ContractedFlightTimesToday.Count == 0)
            return FlightFeedDecision.Skip("no_contracted_flights");
        var near = input.ContractedFlightTimesToday.Any(time => (time - input.NowUtc).Duration() <= NearFlight);
        var later = input.ContractedFlightTimesToday.Any(time => time - input.NowUtc > NearFlight);
        if (!near && !later) return FlightFeedDecision.Skip("day_done");

        var cadence = near ? NearCadence : FarCadence;
        var pressure = Math.Max((double)input.UnitsToday / input.Budget.DailyUnits,
            (double)input.UnitsThisMonth / input.Budget.MonthlyUnits);
        if (pressure >= PressureRatio) cadence *= 2;

        var lastCovering = input.RecentFetches
            .Where(fetch => fetch.FromLocal <= nowLocal && nowLocal <= fetch.ToLocal)
            .Select(fetch => (DateTimeOffset?)fetch.OccurredAt).Max();
        if (lastCovering is { } last && input.NowUtc - last < cadence) return FlightFeedDecision.Skip("up_to_date");

        var windowFrom = nowLocal.AddHours(-2);
        return new(windowFrom, windowFrom + input.MaxWindow, near ? "refresh_near" : "refresh_far");
    }

    /// <summary>The two halves of a local day, each within the provider's 12-hour limit.</summary>
    public static IEnumerable<(DateTime From, DateTime To)> Halves(DateTime day)
    {
        yield return (day, day.AddHours(11).AddMinutes(59));
        yield return (day.AddHours(12), day.AddHours(23).AddMinutes(59));
    }

    private static bool Fetched(FlightFeedPlannerInput input, DateTime from, DateTime to) =>
        input.RecentFetches.Any(fetch => fetch.FromLocal <= from && fetch.ToLocal >= to);

    private static DateTime Minute(DateTime value) =>
        new(value.Year, value.Month, value.Day, value.Hour, value.Minute, 0, DateTimeKind.Unspecified);
}
