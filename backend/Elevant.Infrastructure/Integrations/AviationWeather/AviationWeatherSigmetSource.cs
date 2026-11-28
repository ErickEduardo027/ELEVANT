using System.Collections.Concurrent;
using Elevant.Application.Abstractions.Operations;

namespace Elevant.Infrastructure.Integrations.AviationWeather;

/// <summary>
/// The international SIGMETs over a region from the Data API of aviationweather.gov (plan M6 of 27 November 2026), read
/// only when someone asks for them, with the rules of the region's METARs (<see cref="AviationWeatherRegionSource"/>):
/// <list type="bullet">
/// <item>One GET of <c>{BaseUrl}isigmet?format=json</c>, every SIGMET in force worldwide (the service has no box to ask
/// for), never redirected; the client gives up after ten seconds and reads at most 4 MiB. Only the SIGMETs that touch the
/// region's box are kept (<see cref="AviationWeatherSigmetParser"/>).</item>
/// <item>The answer is kept in memory per box for ten minutes, so a region costs at most six requests an hour however many
/// screens read it; meanwhile every other request waits for the one read.</item>
/// <item>An empty list (or a 204) is an answer without SIGMETs. A 429, another status, a timeout or an answer that cannot
/// be read is a failure, waited out (<see cref="AviationWeatherBackOff"/>); meanwhile the SIGMETs kept are served up to two
/// hours after they were read, marked. The reader leaves out those past their validity.</item>
/// </list>
/// Nothing is logged, so no message ever names the service, and nothing is persisted: a restart starts empty.
/// </summary>
public sealed class AviationWeatherSigmetSource : IRegionSigmetSource, IDisposable
{
    /// <summary>How long an answer is kept.</summary>
    public static TimeSpan Lifetime { get; } = TimeSpan.FromMinutes(10);

    /// <summary>How long after it was read an answer is still served while the service fails.</summary>
    public static TimeSpan StaleLimit { get; } = TimeSpan.FromHours(2);

    /// <summary>The largest answer read: the worldwide list is some hundred kilobytes.</summary>
    public const long MaxAnswerBytes = 4 * 1024 * 1024;

    private readonly HttpClient _http;
    private readonly TimeProvider _time;
    private readonly ConcurrentDictionary<RegionWeatherArea, OnDemandReport<IReadOnlyList<RegionSigmet>>> _areas = new();

    public AviationWeatherSigmetSource(HttpClient http, Uri baseUrl, TimeProvider time)
    {
        ArgumentNullException.ThrowIfNull(http);
        ArgumentNullException.ThrowIfNull(baseUrl);
        ArgumentNullException.ThrowIfNull(time);
        _http = http;
        BaseUrl = AviationWeatherSource.DataApiAddress(baseUrl) ??
            throw new ArgumentException("The Data API address must be absolute, https and without a query.", nameof(baseUrl));
        _time = time;
    }

    /// <summary>The address of the Data API the reads go to; it always ends with a slash.</summary>
    internal Uri BaseUrl { get; }

    /// <summary>The query of the international SIGMETs: <c>{BaseUrl}isigmet?format=json</c>.</summary>
    internal Uri Query => new(BaseUrl, "isigmet?format=json");

    /// <summary>The client the SIGMETs are read with: the Data API's, with room for the worldwide list.</summary>
    public static HttpClient CreateHttpClient() => new(AviationWeatherSource.CreateHandler())
    {
        Timeout = AviationWeatherSource.Timeout, MaxResponseContentBufferSize = MaxAnswerBytes,
    };

    public async Task<RegionWeatherLayer<IReadOnlyList<RegionSigmet>>?> ReadAsync(RegionWeatherArea area,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(area);
        cancellationToken.ThrowIfCancellationRequested();
        var report = _areas.GetOrAdd(area, static _ => new(Lifetime, StaleLimit, static (_, _) => true));
        var served = await report.ServeAsync(async () =>
        {
            var answer = await AviationWeatherHttp.GetAsync(_http, Query,
                root => AviationWeatherSigmetParser.Parse(root, area), _time);
            // A 204 is a list without SIGMETs, as an empty one.
            return answer is { Succeeded: true, Report: null } ? ReportAnswer<IReadOnlyList<RegionSigmet>>.Of([]) : answer;
        }, _time, cancellationToken);
        return new(served.Report, served.KeptAfterFailure, served.LastFailure, served.RetryAt);
    }

    public void Dispose() => _http.Dispose();
}
