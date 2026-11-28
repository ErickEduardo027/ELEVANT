using System.Collections.Concurrent;
using Elevant.Application.Abstractions.Operations;
using Elevant.Infrastructure.Integrations.AviationWeather;

namespace Elevant.Infrastructure.Integrations.WeatherRadar;

/// <summary>
/// The radar frames over a region from the Iowa Environmental Mesonet (plan M6 of 27 November 2026): the scans of the
/// region's NEXRAD (<see cref="RegionWeatherArea.RadarSite"/>; for Punta Cana, San Juan's TJUA, which reaches Punta Cana at
/// its edge) as XYZ tiles of the IEM's cache (<see cref="IemRadarParser"/>). Read only when someone asks for them, with
/// the rules of the region's METARs (<see cref="AviationWeatherRegionSource"/>):
/// <list type="bullet">
/// <item>One GET of the site's index (<c>{BaseUrl}json/radar.py?operation=list&amp;…</c>), never redirected; the client
/// gives up after ten seconds and reads at most 1 MiB. The API never fetches a tile: the screens load them.</item>
/// <item>The frames are kept in memory per site for five minutes, about a scan, so a region costs at most twelve requests
/// an hour however many screens read it; meanwhile every other request waits for the one read.</item>
/// <item>A 429, another status, a timeout or an answer that cannot be read is a failure, waited out
/// (<see cref="AviationWeatherBackOff"/>); meanwhile the frames kept are served up to thirty minutes after they were read,
/// marked.</item>
/// </list>
/// The IEM publishes no rate limit and asks for caching; the tiles of a scan are cached by it for 14 days. Nothing is
/// logged and nothing is persisted.
/// </summary>
public sealed class IemRadarSource : IRegionRadarSource, IDisposable
{
    /// <summary>How long the frames are kept: a scan comes every five to ten minutes.</summary>
    public static TimeSpan Lifetime { get; } = TimeSpan.FromMinutes(5);

    /// <summary>How long after they were read the frames are still served while the service fails.</summary>
    public static TimeSpan StaleLimit { get; } = TimeSpan.FromMinutes(30);

    private readonly HttpClient _http;
    private readonly TimeProvider _time;
    private readonly ConcurrentDictionary<string, OnDemandReport<RegionRadarFrames>> _sites = new(StringComparer.Ordinal);

    public IemRadarSource(HttpClient http, Uri baseUrl, TimeProvider time)
    {
        ArgumentNullException.ThrowIfNull(http);
        ArgumentNullException.ThrowIfNull(baseUrl);
        ArgumentNullException.ThrowIfNull(time);
        _http = http;
        BaseUrl = AviationWeatherSource.DataApiAddress(baseUrl) ??
            throw new ArgumentException("The IEM address must be absolute, https and without a query.", nameof(baseUrl));
        _time = time;
    }

    /// <summary>The address of the IEM the reads go to, and the tiles come from; it always ends with a slash.</summary>
    internal Uri BaseUrl { get; }

    /// <summary>
    /// The frames over <paramref name="area"/>. A region without a radar site, or whose site is not four letters, has none
    /// to serve and nothing is sent.
    /// </summary>
    public async Task<RegionWeatherLayer<RegionRadarFrames>?> ReadAsync(RegionWeatherArea area,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(area);
        cancellationToken.ThrowIfCancellationRequested();
        if (area.RadarSite is not { } radarSite || IemRadarParser.IemSite(radarSite) is not { } site)
            return RegionWeatherLayer<RegionRadarFrames>.Without(null);

        var report = _sites.GetOrAdd(site, static _ => new(Lifetime, StaleLimit, static (_, _) => true));
        var served = await report.ServeAsync(async () =>
        {
            var answer = await AviationWeatherHttp.GetAsync(_http, IemRadarParser.Query(BaseUrl, site, _time.GetUtcNow()),
                root => IemRadarParser.Parse(root, BaseUrl, radarSite), _time);
            // A 204 is an index without scans.
            return answer is { Succeeded: true, Report: null }
                ? ReportAnswer<RegionRadarFrames>.Of(new(IemRadarParser.Provider(radarSite), IemRadarParser.MaxZoom, []))
                : answer;
        }, _time, cancellationToken);
        return new(served.Report, served.KeptAfterFailure, served.LastFailure, served.RetryAt);
    }

    public void Dispose() => _http.Dispose();
}
