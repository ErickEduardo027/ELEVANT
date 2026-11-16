namespace Elevant.Infrastructure.Integrations.AviationWeather;

/// <summary>
/// The <c>AviationWeather</c> section (ADR-0043, contracts 1.4): the METAR and the TAF of the OCC, read from the Data API
/// of aviationweather.gov. Off by default, and while it is off nothing is ever called. <see cref="BaseUrl"/> is checked
/// on every start, also while the section is off, and a wrong value stops the start.
/// </summary>
public sealed class AviationWeatherOptions
{
    public const string SectionName = "AviationWeather";

    public bool Enabled { get; set; }

    /// <summary>
    /// The address of the Data API, absolute and https; the reads add <c>metar?…</c> and <c>taf?…</c> to it. The slash
    /// at its end may be left out.
    /// </summary>
    public string BaseUrl { get; set; } = "https://aviationweather.gov/api/data/";
}
