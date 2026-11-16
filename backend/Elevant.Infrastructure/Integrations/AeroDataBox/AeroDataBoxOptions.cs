namespace Elevant.Infrastructure.Integrations.AeroDataBox;

/// <summary>
/// AeroDataBox direct API (ADR-0028). The key comes only from secret configuration
/// (<c>AeroDataBox__ApiKey</c>); with <see cref="Enabled"/> false or no key nothing is called.
/// </summary>
public sealed class AeroDataBoxOptions
{
    public const string SectionName = "AeroDataBox";

    public bool Enabled { get; set; }

    public string? ApiKey { get; set; }

    public string BaseUrl { get; set; } = "https://api.aerodatabox.com/";

    /// <summary>Units the feed may spend in a UTC day.</summary>
    public int DailyUnitLimit { get; set; } = 1200;

    /// <summary>Units the feed may spend in a UTC month; the Starter plan has 40 000.</summary>
    public int MonthlyUnitLimit { get; set; } = 38000;

    // On-demand reference reads (ADR-0028, note of 15 November 2026): each has its own caps, which never take units from
    // the feed's budget, and none may take every operation of the provider this month past PlanMonthlyUnitLimit.

    /// <summary>Units in a UTC month that all AeroDataBox operations together may reach before a reference read is refused.</summary>
    public int PlanMonthlyUnitLimit { get; set; } = 38000;

    public int FleetDailyUnitLimit { get; set; } = 60;

    public int FleetMonthlyUnitLimit { get; set; } = 600;

    public int AircraftDailyUnitLimit { get; set; } = 60;

    public int AircraftMonthlyUnitLimit { get; set; } = 900;

    public int RoutesDailyUnitLimit { get; set; } = 12;

    public int RoutesMonthlyUnitLimit { get; set; } = 200;

    public int DelaysDailyUnitLimit { get; set; } = 60;

    public int DelaysMonthlyUnitLimit { get; set; } = 1200;
}
