using System.Globalization;

namespace Elevant.Infrastructure.Persistence.Seed.History;

/// <summary>
/// Window and volumes of the synthetic Development history. <see cref="Default"/> is the approved plan (six months at
/// PUJ); <see cref="Small"/> is the reduced shape the integration tests run. A generator derives every row from these
/// values and from the database, never from the clock, so two clean databases receive the same history.
/// </summary>
public sealed record DevelopmentHistoryOptions
{
    public DevelopmentHistoryOptions(DateOnly windowStart, DateOnly windowEnd, int operationsPerDay, int airlineCount,
        int agentCount)
    {
        if (windowEnd < windowStart) throw new ArgumentOutOfRangeException(nameof(windowEnd));
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(operationsPerDay);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(airlineCount);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(agentCount);
        WindowStart = windowStart;
        WindowEnd = windowEnd;
        OperationsPerDay = operationsPerDay;
        AirlineCount = airlineCount;
        AgentCount = agentCount;
    }

    /// <summary>First local business day of the history (inclusive).</summary>
    public DateOnly WindowStart { get; }

    /// <summary>Last local business day of the history (inclusive).</summary>
    public DateOnly WindowEnd { get; }

    /// <summary>Baseline operations per day at PUJ before the weekday and season factors.</summary>
    public int OperationsPerDay { get; }

    /// <summary>Synthetic airlines the commercial chunk adds (fewer when the catalog runs out of unused ones).</summary>
    public int AirlineCount { get; }

    /// <summary>Synthetic ramp agents the workforce chunk adds.</summary>
    public int AgentCount { get; }

    /// <summary>
    /// Test hook: the run stops with <see cref="DevelopmentHistoryInterruptedException"/> right after this chunk
    /// commits, leaving a consistent prefix for the next run to resume.
    /// </summary>
    public string? FailAfterChunk { get; init; }

    /// <summary>The approved plan: 2026-06-01 → 2026-11-21, ~25 operations a day, 10 airlines, 25 agents.</summary>
    public static DevelopmentHistoryOptions Default { get; } =
        new(new DateOnly(2026, 6, 1), new DateOnly(2026, 11, 21), 25, 10, 25);

    /// <summary>Two weeks ending 2026-11-21 with 6 operations a day, 4 airlines and 8 agents.</summary>
    public static DevelopmentHistoryOptions Small { get; } =
        new(new DateOnly(2026, 11, 8), new DateOnly(2026, 11, 21), 6, 4, 8);

    /// <summary>Every local day of the window, in order.</summary>
    public IEnumerable<DateOnly> Days()
    {
        for (var day = WindowStart; day <= WindowEnd; day = day.AddDays(1)) yield return day;
    }

    /// <summary>
    /// The ISO weeks the window touches, clipped to it, in order. <c>Name</c> is <c>2026-W22</c>: the suffix of
    /// the weekly operations chunks (<c>ops:2026-W22</c>).
    /// </summary>
    public IReadOnlyList<HistoryPeriod> IsoWeeks()
    {
        var weeks = new List<HistoryPeriod>();
        var day = WindowStart;
        while (day <= WindowEnd)
        {
            var date = day.ToDateTime(TimeOnly.MinValue);
            var name = string.Create(CultureInfo.InvariantCulture,
                $"{ISOWeek.GetYear(date)}-W{ISOWeek.GetWeekOfYear(date):00}");
            var sunday = day.AddDays((7 - (int)day.DayOfWeek) % 7);
            var end = sunday < WindowEnd ? sunday : WindowEnd;
            weeks.Add(new HistoryPeriod(name, day, end));
            day = end.AddDays(1);
        }
        return weeks;
    }

    /// <summary>The calendar months the window touches, clipped to it, in order; <c>Name</c> is <c>2026-06</c>.</summary>
    public IReadOnlyList<HistoryPeriod> Months()
    {
        var months = new List<HistoryPeriod>();
        var day = WindowStart;
        while (day <= WindowEnd)
        {
            var last = new DateOnly(day.Year, day.Month, DateTime.DaysInMonth(day.Year, day.Month));
            var end = last < WindowEnd ? last : WindowEnd;
            months.Add(new HistoryPeriod(string.Create(CultureInfo.InvariantCulture, $"{day:yyyy-MM}"), day, end));
            day = end.AddDays(1);
        }
        return months;
    }

    /// <summary>Stable text of the options, part of each chunk sentinel's payload hash.</summary>
    internal string Fingerprint() => string.Create(CultureInfo.InvariantCulture,
        $"{WindowStart:yyyy-MM-dd}|{WindowEnd:yyyy-MM-dd}|{OperationsPerDay}|{AirlineCount}|{AgentCount}");
}

/// <summary>A named, inclusive range of local days inside the history window.</summary>
public sealed record HistoryPeriod(string Name, DateOnly From, DateOnly To);

/// <summary>The run stopped on purpose after <see cref="DevelopmentHistoryOptions.FailAfterChunk"/> committed.</summary>
public sealed class DevelopmentHistoryInterruptedException : Exception
{
    public DevelopmentHistoryInterruptedException() : base("The Development history run was interrupted on purpose.") { }

    public DevelopmentHistoryInterruptedException(string chunk)
        : base($"The Development history run stopped on purpose after chunk «{chunk}».") => Chunk = chunk;

    public DevelopmentHistoryInterruptedException(string message, Exception innerException) : base(message, innerException) { }

    public string? Chunk { get; }
}
