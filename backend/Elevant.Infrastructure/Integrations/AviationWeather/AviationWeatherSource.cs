using System.Collections.Concurrent;
using System.Net;
using Elevant.Application.Abstractions.Operations;

namespace Elevant.Infrastructure.Integrations.AviationWeather;

/// <summary>
/// The METAR and the TAF of an airport from the Data API of aviationweather.gov (ADR-0043, contracts 1.4), read only
/// when someone asks for that airport's weather:
/// <list type="bullet">
/// <item>One GET of <c>{BaseUrl}metar?ids={ICAO}&amp;format=json</c> and one of <c>{BaseUrl}taf?ids={ICAO}&amp;format=json</c>,
/// sent side by side and never redirected; the client gives up after ten seconds.</item>
/// <item>Each answer is kept in memory per airport, the METAR for five minutes and the TAF for thirty, so an airport
/// costs at most two requests every five minutes however many screens read it. While a report is being read, every other
/// request for it waits for that one read; a caller that gives up stops waiting, and the read goes on for the others.</item>
/// <item>An empty list (or a 204) is an answer: the service has no report now, and that is kept like a report.</item>
/// <item>A 429, another status, a timeout or an answer that cannot be read is a failure. The source then waits
/// (<see cref="AviationWeatherBackOff"/>) before it asks again, never in a loop, and meanwhile serves what it kept: the
/// METAR up to two hours after it was read, marked as kept after a failure, and the TAF up to twelve hours.</item>
/// <item>A TAF is never served after its validity ends.</item>
/// </list>
/// Nothing is logged, so no message ever names the service, and nothing is persisted: a restart starts empty. The memory
/// of a report and the GET are the ones the region read uses too (<see cref="OnDemandReport{T}"/> and
/// <see cref="AviationWeatherHttp"/>).
/// </summary>
public sealed class AviationWeatherSource : IAerodromeWeatherSource, IDisposable
{
    /// <summary>How long a METAR answer is served before the service is asked again.</summary>
    public static TimeSpan MetarLifetime { get; } = TimeSpan.FromMinutes(5);

    /// <summary>How long a TAF answer is served before the service is asked again.</summary>
    public static TimeSpan TafLifetime { get; } = TimeSpan.FromMinutes(30);

    /// <summary>How long after it was read a METAR is still served while the service fails.</summary>
    public static TimeSpan MetarStaleLimit { get; } = TimeSpan.FromHours(2);

    /// <summary>How long after it was read a TAF is still served while the service fails.</summary>
    public static TimeSpan TafStaleLimit { get; } = TimeSpan.FromHours(12);

    /// <summary>The longest a read may take, the answer included.</summary>
    public static TimeSpan Timeout { get; } = TimeSpan.FromSeconds(10);

    /// <summary>The largest answer read; the reports of one airport are a few kilobytes, those of a region some dozens.</summary>
    public const long MaxAnswerBytes = 1024 * 1024;

    private readonly HttpClient _http;
    private readonly TimeProvider _time;
    private readonly ConcurrentDictionary<string, AirportState> _airports = new(StringComparer.Ordinal);

    public AviationWeatherSource(HttpClient http, Uri baseUrl, TimeProvider time)
    {
        ArgumentNullException.ThrowIfNull(http);
        ArgumentNullException.ThrowIfNull(baseUrl);
        ArgumentNullException.ThrowIfNull(time);
        _http = http;
        BaseUrl = DataApiAddress(baseUrl) ??
            throw new ArgumentException("The Data API address must be absolute, https and without a query.", nameof(baseUrl));
        _time = time;
    }

    /// <summary>The address of the Data API the reads go to; it always ends with a slash.</summary>
    internal Uri BaseUrl { get; }

    /// <summary>
    /// The client the Data API is read with: no redirects, a ten-second limit for the whole answer, compressed answers
    /// accepted and a ceiling on their size.
    /// </summary>
    public static HttpClient CreateHttpClient() =>
        new(CreateHandler()) { Timeout = Timeout, MaxResponseContentBufferSize = MaxAnswerBytes };

    internal static HttpClientHandler CreateHandler() =>
        new() { AllowAutoRedirect = false, AutomaticDecompression = DecompressionMethods.All };

    /// <summary>
    /// The address of the Data API as the reads use it, ending with a slash; null unless it is absolute, https and
    /// without a query or a fragment.
    /// </summary>
    internal static Uri? DataApiAddress(string? text) =>
        Uri.TryCreate(text?.Trim(), UriKind.Absolute, out var address) ? DataApiAddress(address) : null;

    /// <inheritdoc cref="DataApiAddress(string?)"/>
    internal static Uri? DataApiAddress(Uri address)
    {
        if (!address.IsAbsoluteUri || address.Scheme != Uri.UriSchemeHttps || address.Query.Length > 0 ||
            address.Fragment.Length > 0)
            return null;
        return address.AbsolutePath.EndsWith('/') ? address : new Uri(address.AbsoluteUri + "/");
    }

    /// <summary>The METAR query of an airport: <c>{BaseUrl}metar?ids={ICAO}&amp;format=json</c>.</summary>
    internal Uri MetarQuery(string icao) => Query(BaseUrl, "metar", icao);

    /// <summary>The TAF query of an airport: <c>{BaseUrl}taf?ids={ICAO}&amp;format=json</c>.</summary>
    internal Uri TafQuery(string icao) => Query(BaseUrl, "taf", icao);

    /// <summary>
    /// The weather of the airport: its ICAO code in upper case, and a code that is not four letters is never sent (the
    /// answer has no report). Each report is served from memory while it is current or while the service is waited out;
    /// otherwise it is read once for every caller, without the caller's cancellation. Only that cancellation is thrown.
    /// </summary>
    public async Task<AerodromeWeatherData?> ReadAsync(string icaoCode, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var icao = icaoCode?.Trim().ToUpperInvariant() ?? string.Empty;
        if (!IsIcaoCode(icao)) return new AerodromeWeatherData(icao, null, false, null, null);

        var airport = _airports.GetOrAdd(icao, static _ => new AirportState());
        var metar = airport.Metar.ServeAsync(() => AviationWeatherHttp.GetAsync(_http, MetarQuery(icao),
            root => AviationWeatherParser.ParseMetar(root, icao), _time), _time, cancellationToken);
        var taf = airport.Taf.ServeAsync(() => AviationWeatherHttp.GetAsync(_http, TafQuery(icao),
            root => AviationWeatherParser.ParseTaf(root, icao), _time), _time, cancellationToken);
        await Task.WhenAll(metar, taf);
        var servedMetar = await metar;
        var servedTaf = await taf;
        return new AerodromeWeatherData(icao, servedMetar.Report, servedMetar.KeptAfterFailure, servedTaf.Report,
            Latest(servedMetar.RetrievedAt, servedTaf.RetrievedAt));
    }

    public void Dispose() => _http.Dispose();

    /// <summary>Four letters in upper case, as an ICAO location indicator is written.</summary>
    internal static bool IsIcaoCode(string code) => code.Length == 4 && code.All(char.IsAsciiLetterUpper);

    /// <summary>A query of the Data API: <c>{baseUrl}{product}?ids={ids}&amp;format=json</c>.</summary>
    internal static Uri Query(Uri baseUrl, string product, string ids) => new(baseUrl, $"{product}?ids={ids}&format=json");

    /// <summary>The later of two instants; null only when both are.</summary>
    internal static DateTimeOffset? Latest(DateTimeOffset? left, DateTimeOffset? right) =>
        left is null ? right : right is null ? left : left > right ? left : right;

    /// <summary>The memory of one airport: its METAR and its TAF, each with its own lifetime and stale limit.</summary>
    private sealed class AirportState
    {
        public OnDemandReport<AerodromeMetar> Metar { get; } = new(MetarLifetime, MetarStaleLimit, static (_, _) => true);

        /// <summary>A TAF is never served after its validity ends.</summary>
        public OnDemandReport<AerodromeTaf> Taf { get; } = new(TafLifetime, TafStaleLimit,
            static (taf, now) => now < taf.ValidTo);
    }
}
