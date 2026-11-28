using System.Collections.Concurrent;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations.Weather;
using Elevant.Infrastructure.Integrations.AviationWeather;

namespace Elevant.Infrastructure.Integrations.OpenMeteo;

/// <summary>
/// The wind grid over a region from the forecast API of Open-Meteo (plan M6 of 27 November 2026), read only when someone
/// asks for it, with the rules of the region's METARs (<see cref="AviationWeatherRegionSource"/>):
/// <list type="bullet">
/// <item>One GET of <c>{BaseUrl}forecast?latitude=…&amp;longitude=…&amp;current=wind_speed_10m,wind_direction_10m&amp;…</c>
/// with every point of the grid (<see cref="RegionWindGridShape"/>: 10 by 8, 80 locations), never redirected; the client
/// gives up after ten seconds and reads at most 1 MiB.</item>
/// <item>The grid is kept in memory per box for an hour, so a region costs 24 requests a day (1,920 locations against the
/// free tier's 10,000) however many screens read it; meanwhile every other request waits for the one read.</item>
/// <item>A 429, another status (the service answers its errors as a 400), a timeout or an answer that cannot be read is a
/// failure, waited out (<see cref="AviationWeatherBackOff"/>); meanwhile the grid kept is served up to three hours after
/// it was read, marked.</item>
/// </list>
/// Open-Meteo's free tier is for non-commercial use only: this source runs where <c>OpenMeteo:Enabled</c> is on, which
/// only Development does; Production needs the commercial plan first. Nothing is logged and nothing is persisted.
/// </summary>
public sealed class OpenMeteoWindSource : IRegionWindSource, IDisposable
{
    /// <summary>How long a grid is kept: the service's model runs hourly.</summary>
    public static TimeSpan Lifetime { get; } = TimeSpan.FromHours(1);

    /// <summary>How long after it was read a grid is still served while the service fails.</summary>
    public static TimeSpan StaleLimit { get; } = TimeSpan.FromHours(3);

    private readonly HttpClient _http;
    private readonly TimeProvider _time;
    private readonly ConcurrentDictionary<RegionWeatherArea, OnDemandReport<RegionWindGrid>> _areas = new();

    public OpenMeteoWindSource(HttpClient http, Uri baseUrl, TimeProvider time)
    {
        ArgumentNullException.ThrowIfNull(http);
        ArgumentNullException.ThrowIfNull(baseUrl);
        ArgumentNullException.ThrowIfNull(time);
        _http = http;
        BaseUrl = AviationWeatherSource.DataApiAddress(baseUrl) ??
            throw new ArgumentException("The forecast API address must be absolute, https and without a query.", nameof(baseUrl));
        _time = time;
    }

    /// <summary>The address of the forecast API the reads go to; it always ends with a slash.</summary>
    internal Uri BaseUrl { get; }

    /// <summary>The query of a box's grid.</summary>
    internal Uri Query(RegionWeatherArea area) => OpenMeteoWindParser.Query(BaseUrl,
        OpenMeteoWindParser.Points(area, RegionWindGridShape.Columns, RegionWindGridShape.Rows));

    public async Task<RegionWeatherLayer<RegionWindGrid>?> ReadAsync(RegionWeatherArea area,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(area);
        cancellationToken.ThrowIfCancellationRequested();
        var report = _areas.GetOrAdd(area, static _ => new(Lifetime, StaleLimit, static (_, _) => true));
        var served = await report.ServeAsync(async () =>
        {
            var answer = await AviationWeatherHttp.GetAsync(_http, Query(area),
                root => OpenMeteoWindParser.Parse(root, area, RegionWindGridShape.Columns, RegionWindGridShape.Rows), _time);
            // A grid is never an empty answer: a 204 cannot be read.
            return answer is { Succeeded: true, Report: null } ? ReportAnswer<RegionWindGrid>.Failure() : answer;
        }, _time, cancellationToken);
        return new(served.Report, served.KeptAfterFailure, served.LastFailure, served.RetryAt);
    }

    public void Dispose() => _http.Dispose();
}
