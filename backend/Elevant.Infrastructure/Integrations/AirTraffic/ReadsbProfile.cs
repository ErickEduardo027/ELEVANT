using System.Globalization;
using Elevant.Application.Abstractions.Operations;

namespace Elevant.Infrastructure.Integrations.AirTraffic;

/// <summary>
/// A network that answers in readsb's v2 JSON (ADR-0042, contracts 1.3): the point query it takes, the credit it
/// requires, whether it takes a key and how many requests a UTC day may send it. Only these two exist; the
/// configuration names them in <c>AirTraffic:Providers</c>.
/// </summary>
public sealed class ReadsbProfile
{
    private readonly string _pointQuery;
    private readonly int? _dailyLimitWithoutKey;
    private readonly int? _dailyLimitWithKey;

    private ReadsbProfile(string name, string pointQuery, AirTrafficAttribution attribution, bool takesKey,
        int? dailyLimitWithoutKey, int? dailyLimitWithKey)
    {
        Name = name;
        _pointQuery = pointQuery;
        Attribution = attribution;
        TakesKey = takesKey;
        _dailyLimitWithoutKey = dailyLimitWithoutKey;
        _dailyLimitWithKey = dailyLimitWithKey;
    }

    /// <summary>
    /// adsb.fi open data, the network of the demonstration (owner decision 6): personal and non-commercial use, «cite
    /// adsb.fi and link to its home page», at most one request a second, no key and no daily limit.
    /// </summary>
    public static ReadsbProfile AdsbFi { get; } = new("AdsbFi",
        "https://opendata.adsb.fi/api/v3/lat/{0}/lon/{1}/dist/{2}",
        new AirTrafficAttribution("adsb.fi", "https://adsb.fi", "Uso personal y no comercial", null),
        takesKey: false, dailyLimitWithoutKey: null, dailyLimitWithKey: null);

    /// <summary>
    /// adsb.lol, the alternative ready by configuration: ODbL 1.0; 500 requests a day for an address without a key and
    /// 1 000 with a key (<c>x-api-key</c>). The plain daily counter stops ten per cent before either limit.
    /// </summary>
    public static ReadsbProfile AdsbLol { get; } = new("AdsbLol",
        "https://api.adsb.lol/v2/point/{0}/{1}/{2}",
        new AirTrafficAttribution("adsb.lol", "https://adsb.lol", "ODbL 1.0", "https://opendatacommons.org/licenses/odbl/1-0/"),
        takesKey: true, dailyLimitWithoutKey: 450, dailyLimitWithKey: 900);

    /// <summary>Every profile, in the order the configuration error names them.</summary>
    public static IReadOnlyList<ReadsbProfile> All { get; } = [AdsbFi, AdsbLol];

    /// <summary>The name <c>AirTraffic:Providers</c> uses: <c>AdsbFi</c> or <c>AdsbLol</c>.</summary>
    public string Name { get; }

    public AirTrafficAttribution Attribution { get; }

    /// <summary>Whether the network takes the <c>x-api-key</c> header; a key is never sent to any other network.</summary>
    public bool TakesKey { get; }

    /// <summary>The requests a UTC day may send, with or without a key; null when the network has no daily limit.</summary>
    public int? DailyLimit(bool withKey) => withKey && TakesKey ? _dailyLimitWithKey : _dailyLimitWithoutKey;

    /// <summary>
    /// The point query of the area: the centre with four decimals and a dot whatever the culture of the process, and the
    /// radius in whole nautical miles.
    /// </summary>
    public Uri PointQuery(AirTrafficArea area)
    {
        ArgumentNullException.ThrowIfNull(area);
        return new Uri(string.Format(CultureInfo.InvariantCulture, _pointQuery, Coordinate(area.Latitude),
            Coordinate(area.Longitude), area.RadiusNm));
    }

    /// <summary>
    /// The profile of a configured name: only the exact names, without regard to case or surrounding spaces; null for
    /// anything else.
    /// </summary>
    public static ReadsbProfile? Find(string? name)
    {
        var trimmed = name?.Trim();
        return All.SingleOrDefault(profile => string.Equals(profile.Name, trimmed, StringComparison.OrdinalIgnoreCase));
    }

    private static string Coordinate(double degrees)
    {
        var rounded = Math.Round(degrees, 4, MidpointRounding.AwayFromZero);
        // «-0.0000» is not a coordinate a network expects.
        return (rounded == 0 ? 0 : rounded).ToString("F4", CultureInfo.InvariantCulture);
    }
}
