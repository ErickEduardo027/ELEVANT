using System.Globalization;
using System.Text.Json;
using Elevant.Application.Abstractions.Operations;
using Elevant.Infrastructure.Integrations.AviationWeather;

namespace Elevant.Infrastructure.Integrations.WeatherRadar;

/// <summary>
/// The radar frames of one NEXRAD from the Iowa Environmental Mesonet (plan M6 of 27 November 2026), as its documentation
/// gives them (<c>/json/radar.py</c> and <c>/ogc/</c>, read on 27 November 2026): the index of the site's archived base
/// reflectivity scans (<c>N0B</c>, which replaced <c>N0Q</c>) and the tiles of each scan in its TMS cache, by the exact UTC
/// minute of the scan (<c>ridge::{SITE}-N0B-{yyyyMMddHHmm}</c>, served by <c>/c/tile.py/1.0.0/</c> with a cache of 14 days;
/// a minute without a scan answers 503). The tiles are XYZ, as MapLibre asks for them. Pure: it never calls anything.
/// RainViewer was weighed first and left out: its free API is for personal and educational use only.
/// </summary>
public static class IemRadarParser
{
    /// <summary>The product drawn: base reflectivity at the lowest tilt, the one the IEM keeps for every site.</summary>
    public const string Product = "N0B";

    /// <summary>The most frames served: about an hour of scans.</summary>
    public const int MaxFrames = 12;

    /// <summary>The deepest zoom of the tiles; MapLibre stretches them beyond it.</summary>
    public const int MaxZoom = 10;

    /// <summary>How far back the index is asked for: room for <see cref="MaxFrames"/> scans in clear-air mode too.</summary>
    public static TimeSpan Window { get; } = TimeSpan.FromHours(2);

    private static readonly string[] ScanFormats = ["yyyy-MM-dd'T'HH:mm'Z'", "yyyy-MM-dd'T'HH:mm:ss'Z'"];

    /// <summary>The site as the IEM names it: the ICAO code without its first letter (<c>TJUA</c> is <c>JUA</c>); null unless four letters.</summary>
    public static string? IemSite(string? radarSite) =>
        radarSite?.Trim().ToUpperInvariant() is { Length: 4 } site && site.All(char.IsAsciiLetterUpper) ? site[1..] : null;

    /// <summary>The provider the frames travel with: <c>iem-</c> and the ICAO code in lower case (<c>iem-tjua</c>).</summary>
    public static string Provider(string radarSite) => "iem-" + radarSite.Trim().ToLowerInvariant();

    /// <summary>
    /// The index query of <paramref name="iemSite"/>'s scans from <see cref="Window"/> before <paramref name="now"/>:
    /// <c>{baseUrl}json/radar.py?operation=list&amp;product=N0B&amp;radar={SITE}&amp;start={…}Z&amp;end={…}Z</c>, to the minute.
    /// </summary>
    public static Uri Query(Uri baseUrl, string iemSite, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(baseUrl);
        var end = now.UtcDateTime;
        var start = end - Window;
        return new Uri(baseUrl, string.Create(CultureInfo.InvariantCulture,
            $"json/radar.py?operation=list&product={Product}&radar={iemSite}&start={start:yyyy-MM-dd'T'HH:mm}Z&end={end:yyyy-MM-dd'T'HH:mm}Z"));
    }

    /// <summary>The tiles of one scan: <c>{baseUrl}c/tile.py/1.0.0/ridge::{SITE}-N0B-{yyyyMMddHHmm}/{z}/{x}/{y}.png</c>.</summary>
    public static string TileUrlTemplate(Uri baseUrl, string iemSite, DateTimeOffset scan)
    {
        ArgumentNullException.ThrowIfNull(baseUrl);
        return new Uri(baseUrl, string.Create(CultureInfo.InvariantCulture,
            $"c/tile.py/1.0.0/ridge::{iemSite}-{Product}-{scan.UtcDateTime:yyyyMMddHHmm}/")).AbsoluteUri + "{z}/{x}/{y}.png";
    }

    /// <summary>
    /// The frames of one index answer, <c>{"scans": [{"ts": "2026-11-28T01:34Z"}, …]}</c>: the latest
    /// <see cref="MaxFrames"/> scans, oldest first, once each, each with the address of its tiles. A scan whose time cannot
    /// be read is left out. Not an object with a list of scans: unreadable. No scan: a report without frames (the site
    /// sent none, or is down).
    /// </summary>
    public static (AviationWeatherReadKind Kind, RegionRadarFrames? Frames) Parse(JsonElement root, Uri baseUrl,
        string radarSite)
    {
        ArgumentNullException.ThrowIfNull(baseUrl);
        if (IemSite(radarSite) is not { } site) throw new ArgumentException("The radar site must be four letters.", nameof(radarSite));
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("scans", out var scans) ||
            scans.ValueKind != JsonValueKind.Array)
            return (AviationWeatherReadKind.Unreadable, null);

        var times = new SortedSet<DateTimeOffset>();
        foreach (var scan in scans.EnumerateArray())
        {
            if (scan.ValueKind == JsonValueKind.Object && AviationWeatherParser.Text(scan, "ts") is { } text &&
                DateTimeOffset.TryParseExact(text, ScanFormats, CultureInfo.InvariantCulture,
                    DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var time))
                // The tiles are named by the minute: two scans in one minute are one frame.
                times.Add(new DateTimeOffset(time.Year, time.Month, time.Day, time.Hour, time.Minute, 0, TimeSpan.Zero));
        }
        var frames = times.TakeLast(MaxFrames)
            .Select(time => new RegionRadarFrame(time, TileUrlTemplate(baseUrl, site, time)))
            .ToArray();
        return (AviationWeatherReadKind.Report, new RegionRadarFrames(Provider(radarSite), MaxZoom, frames));
    }
}
