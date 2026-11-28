namespace Elevant.Infrastructure.Integrations.WeatherRadar;

/// <summary>
/// The <c>WeatherRadar</c> section (plan M6 of 27 November 2026): the radar frames of the OCC's region, San Juan's NEXRAD
/// (TJUA, NOAA National Weather Service) as tiles of the Iowa Environmental Mesonet. Off by default, and while it is off
/// nothing is ever called. <see cref="BaseUrl"/> is checked on every start, also while the section is off, and a wrong
/// value stops the start; the tiles the screens load come from that same address, which the private web's
/// Content-Security-Policy already allows.
/// </summary>
public sealed class WeatherRadarOptions
{
    public const string SectionName = "WeatherRadar";

    public bool Enabled { get; set; }

    /// <summary>The address of the Iowa Environmental Mesonet, absolute and https; the slash at its end may be left out.</summary>
    public string BaseUrl { get; set; } = "https://mesonet.agron.iastate.edu/";
}
