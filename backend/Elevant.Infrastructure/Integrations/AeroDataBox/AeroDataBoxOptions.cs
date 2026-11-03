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
}
