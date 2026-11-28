using System.Collections.Concurrent;
using System.Collections.ObjectModel;
using Elevant.Application.Abstractions.Operations;

namespace Elevant.Infrastructure.Integrations.AviationWeather;

/// <summary>
/// The METAR and the TAF of every airport of a region from the Data API of aviationweather.gov (plan M6 of 27 November
/// 2026), read only when someone asks for that region's weather, with the rules of the airport read
/// (<see cref="AviationWeatherSource"/>):
/// <list type="bullet">
/// <item>One GET of <c>{BaseUrl}metar?ids={A,B,…}&amp;format=json</c> and one of <c>{BaseUrl}taf?ids={A,B,…}&amp;format=json</c>
/// for the whole region, its ICAO codes in upper case, once each and sorted, sent side by side and never redirected; the
/// client gives up after ten seconds and reads at most 1 MiB.</item>
/// <item>Each answer is kept in memory per region, the METARs for five minutes and the TAFs for thirty, so a region costs
/// at most two requests every five minutes however many screens read it. While a report is being read, every other
/// request for it waits for that one read; a caller that gives up stops waiting, and the read goes on for the others.</item>
/// <item>An airport the answer has no readable report of has none; an empty list (or a 204) is an answer without
/// reports, kept like one.</item>
/// <item>A 429, another status, a timeout or an answer that cannot be read is a failure, waited out
/// (<see cref="AviationWeatherBackOff"/>) before the service is asked again, never in a loop. Meanwhile the source serves
/// what it kept: the METARs up to two hours after they were read, marked as kept after a failure, and the TAFs up to
/// twelve hours.</item>
/// <item>A TAF is never served after its validity ends.</item>
/// </list>
/// Nothing is logged, so no message ever names the service, and nothing is persisted: a restart starts empty.
/// </summary>
public sealed class AviationWeatherRegionSource : IRegionWeatherSource, IDisposable
{
    /// <summary>The most airports one region may have: their codes all travel in one query.</summary>
    public const int MaxAirports = 64;

    private readonly HttpClient _http;
    private readonly TimeProvider _time;
    private readonly ConcurrentDictionary<string, RegionState> _regions = new(StringComparer.Ordinal);

    public AviationWeatherRegionSource(HttpClient http, Uri baseUrl, TimeProvider time)
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

    /// <summary>
    /// The ICAO codes a region's queries carry, as <c>ids</c>: each code trimmed and in upper case, only the four-letter
    /// ones, once each and sorted, joined by commas. More than <see cref="MaxAirports"/> is refused.
    /// </summary>
    internal static string Ids(IReadOnlyList<string> icaoCodes)
    {
        ArgumentNullException.ThrowIfNull(icaoCodes);
        var codes = icaoCodes.Select(code => code?.Trim().ToUpperInvariant() ?? string.Empty)
            .Where(AviationWeatherSource.IsIcaoCode).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal)
            .ToArray();
        if (codes.Length > MaxAirports)
            throw new ArgumentOutOfRangeException(nameof(icaoCodes), codes.Length,
                $"A region has at most {MaxAirports} airports.");
        return string.Join(',', codes);
    }

    /// <summary>The METAR query of a region: <c>{BaseUrl}metar?ids={A,B,…}&amp;format=json</c>.</summary>
    internal Uri MetarQuery(IReadOnlyList<string> icaoCodes) => AviationWeatherSource.Query(BaseUrl, "metar", Ids(icaoCodes));

    /// <summary>The TAF query of a region: <c>{BaseUrl}taf?ids={A,B,…}&amp;format=json</c>.</summary>
    internal Uri TafQuery(IReadOnlyList<string> icaoCodes) => AviationWeatherSource.Query(BaseUrl, "taf", Ids(icaoCodes));

    /// <summary>
    /// The weather of the region's airports, by ICAO code in upper case. A code that is not four letters is never sent (it
    /// has no report), and without any four-letter code nothing is sent at all. Each report is served from memory while it
    /// is current or while the service is waited out; otherwise it is read once for every caller, without the caller's
    /// cancellation. Only that cancellation is thrown.
    /// </summary>
    public async Task<RegionWeatherData?> ReadAsync(IReadOnlyList<string> icaoCodes,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var ids = Ids(icaoCodes);
        if (ids.Length == 0) return RegionWeatherData.Without(null);
        var airports = ids.Split(',');

        var region = _regions.GetOrAdd(ids, static _ => new RegionState());
        var metars = region.Metars.ServeAsync(() => AviationWeatherHttp.GetAsync(_http,
            AviationWeatherSource.Query(BaseUrl, "metar", ids), root => AviationWeatherParser.ParseMetars(root, airports),
            _time), _time, cancellationToken);
        var tafs = region.Tafs.ServeAsync(() => AviationWeatherHttp.GetAsync(_http,
            AviationWeatherSource.Query(BaseUrl, "taf", ids), root => AviationWeatherParser.ParseTafs(root, airports),
            _time), _time, cancellationToken);
        await Task.WhenAll(metars, tafs);
        var servedMetars = await metars;
        var servedTafs = await tafs;
        return new RegionWeatherData(servedMetars.Report ?? ReadOnlyDictionary<string, AerodromeMetar>.Empty,
            servedMetars.KeptAfterFailure, Valid(servedTafs.Report, _time.GetUtcNow()), servedMetars.LastFailure,
            servedMetars.RetryAt);
    }

    public void Dispose() => _http.Dispose();

    /// <summary>The TAFs still valid at <paramref name="now"/>: a TAF is never served after its validity ends.</summary>
    private static IReadOnlyDictionary<string, AerodromeTaf> Valid(IReadOnlyDictionary<string, AerodromeTaf>? tafs,
        DateTimeOffset now)
    {
        if (tafs is null || tafs.Count == 0) return ReadOnlyDictionary<string, AerodromeTaf>.Empty;
        if (tafs.Values.All(taf => now < taf.ValidTo)) return tafs;
        return new ReadOnlyDictionary<string, AerodromeTaf>(tafs.Where(item => now < item.Value.ValidTo)
            .ToDictionary(item => item.Key, item => item.Value, StringComparer.Ordinal));
    }

    /// <summary>
    /// The memory of one region: its METARs and its TAFs, each with the lifetime and the stale limit of an airport's
    /// (<see cref="AviationWeatherSource"/>). The TAFs past their validity are left out when they are served.
    /// </summary>
    private sealed class RegionState
    {
        public OnDemandReport<IReadOnlyDictionary<string, AerodromeMetar>> Metars { get; } =
            new(AviationWeatherSource.MetarLifetime, AviationWeatherSource.MetarStaleLimit, static (_, _) => true);

        public OnDemandReport<IReadOnlyDictionary<string, AerodromeTaf>> Tafs { get; } =
            new(AviationWeatherSource.TafLifetime, AviationWeatherSource.TafStaleLimit, static (_, _) => true);
    }
}
