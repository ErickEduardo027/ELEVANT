namespace Elevant.Infrastructure.Integrations.OpenMeteo;

/// <summary>
/// The <c>OpenMeteo</c> section (plan M6 of 27 November 2026): the wind grid of the OCC's region, read from the forecast
/// API of Open-Meteo (data CC BY 4.0). Off by default, and while it is off nothing is ever called. Open-Meteo's free tier
/// is for non-commercial use only: Production must not turn it on without its commercial plan (and its key), which is
/// why only <c>appsettings.Development.json</c> turns it on. <see cref="BaseUrl"/> is checked on every start, also while
/// the section is off, and a wrong value stops the start.
/// </summary>
public sealed class OpenMeteoOptions
{
    public const string SectionName = "OpenMeteo";

    public bool Enabled { get; set; }

    /// <summary>The address of the forecast API, absolute and https; the read adds <c>forecast?…</c> to it. The slash at its end may be left out.</summary>
    public string BaseUrl { get; set; } = "https://api.open-meteo.com/v1/";
}
