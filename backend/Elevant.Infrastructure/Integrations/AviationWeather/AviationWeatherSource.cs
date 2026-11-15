using System.Collections.Concurrent;
using System.Net;
using System.Text.Json;
using Elevant.Application.Abstractions.Operations;
using Elevant.Infrastructure.Integrations.AirTraffic;

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
/// Nothing is logged, so no message ever names the service, and nothing is persisted: a restart starts empty.
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

    /// <summary>The largest answer read; the reports of one airport are a few kilobytes.</summary>
    public const long MaxAnswerBytes = 1024 * 1024;

    private static readonly Product<AerodromeMetar> Metar = new("metar", MetarLifetime, MetarStaleLimit,
        AviationWeatherParser.ParseMetar, static (_, _) => true);

    private static readonly Product<AerodromeTaf> Taf = new("taf", TafLifetime, TafStaleLimit,
        AviationWeatherParser.ParseTaf, static (taf, now) => now < taf.ValidTo);

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

    private static Uri? DataApiAddress(Uri address)
    {
        if (!address.IsAbsoluteUri || address.Scheme != Uri.UriSchemeHttps || address.Query.Length > 0 ||
            address.Fragment.Length > 0)
            return null;
        return address.AbsolutePath.EndsWith('/') ? address : new Uri(address.AbsoluteUri + "/");
    }

    /// <summary>The METAR query of an airport: <c>{BaseUrl}metar?ids={ICAO}&amp;format=json</c>.</summary>
    internal Uri MetarQuery(string icao) => Query(Metar, icao);

    /// <summary>The TAF query of an airport: <c>{BaseUrl}taf?ids={ICAO}&amp;format=json</c>.</summary>
    internal Uri TafQuery(string icao) => Query(Taf, icao);

    /// <summary>
    /// The weather of the airport: its ICAO code in upper case, and a code that is not four letters is never sent (the
    /// answer has no report). Each report is served from memory while it is current or while the service is waited out;
    /// otherwise it is read once for every caller, without the caller's cancellation. Only that cancellation is thrown.
    /// </summary>
    public async Task<AerodromeWeatherData?> ReadAsync(string icaoCode, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var icao = icaoCode?.Trim().ToUpperInvariant() ?? string.Empty;
        if (icao.Length != 4 || !icao.All(char.IsAsciiLetterUpper)) return new AerodromeWeatherData(icao, null, false, null, null);

        var airport = _airports.GetOrAdd(icao, static _ => new AirportState());
        var metar = ServeAsync(airport.Metar, Metar, icao, cancellationToken);
        var taf = ServeAsync(airport.Taf, Taf, icao, cancellationToken);
        await Task.WhenAll(metar, taf);
        var (metarReport, metarKept, metarRetrievedAt) = await metar;
        var (tafReport, _, tafRetrievedAt) = await taf;
        return new AerodromeWeatherData(icao, metarReport, metarKept, tafReport, Latest(metarRetrievedAt, tafRetrievedAt));
    }

    private async Task<Served<T>> ServeAsync<T>(ReportState<T> state, Product<T> product, string icao,
        CancellationToken cancellationToken) where T : class
    {
        TaskCompletionSource? started = null;
        Task read;
        lock (state.Gate)
        {
            var now = _time.GetUtcNow();
            if (state.IsCurrent(now, product.Lifetime) || state.IsWaiting(now)) return state.Serve(now, product);
            if (state.InFlight is null)
            {
                started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
                state.InFlight = started;
            }
            read = state.InFlight.Task;
        }
        // Started outside the lock, so a read that ends at once never finds its own report state locked.
        if (started is not null) _ = RefreshAsync(state, product, icao, started);
        await read.WaitAsync(cancellationToken);
        lock (state.Gate) return state.Serve(_time.GetUtcNow(), product);
    }

    /// <summary>
    /// The one read of a report that every caller waits for. It is sent without any caller's cancellation (the client's
    /// own limit ends it) and records its outcome before it lets the callers go. It never throws: a failure of the
    /// service is an outcome, and a fault of this code reaches the callers through <paramref name="read"/>.
    /// </summary>
    private async Task RefreshAsync<T>(ReportState<T> state, Product<T> product, string icao, TaskCompletionSource read)
        where T : class
    {
        var answer = Answer<T>.Failure(null);
        Exception? fault = null;
        try
        {
            answer = await AskAsync(product, icao);
        }
        catch (Exception exception)
        {
            // Not an answer of the service: the callers get it, and the report waits as after a failure.
            fault = exception;
        }
        lock (state.Gate)
        {
            state.Record(answer, _time.GetUtcNow());
            state.InFlight = null;
        }
        if (fault is null) read.TrySetResult();
        else read.TrySetException(fault);
    }

    private async Task<Answer<T>> AskAsync<T>(Product<T> product, string icao) where T : class
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, Query(product, icao));
        request.Headers.Accept.ParseAdd("application/json");
        request.Headers.UserAgent.ParseAdd(ReadsbAirTrafficProvider.UserAgent);

        HttpResponseMessage response;
        try
        {
            // The whole answer is read here, so the client's limit covers it too.
            response = await _http.SendAsync(request, HttpCompletionOption.ResponseContentRead, CancellationToken.None);
        }
        catch (Exception exception) when (exception is HttpRequestException or OperationCanceledException or IOException)
        {
            // A timeout, a refused connection or an answer too large: the message is never logged, it may name the host.
            return Answer<T>.Failure(null);
        }

        using (response)
        {
            switch (response.StatusCode)
            {
                case HttpStatusCode.OK:
                    return await ReadAnswerAsync(response, product, icao);
                case HttpStatusCode.NoContent:
                    return Answer<T>.NoReport;
                case HttpStatusCode.TooManyRequests:
                    return Answer<T>.Failure(RetryAfter(response, _time.GetUtcNow()));
                default:
                    return Answer<T>.Failure(null);
            }
        }
    }

    private static async Task<Answer<T>> ReadAnswerAsync<T>(HttpResponseMessage response, Product<T> product, string icao)
        where T : class
    {
        try
        {
            await using var stream = await response.Content.ReadAsStreamAsync();
            using var document = await JsonDocument.ParseAsync(stream);
            var (kind, report) = product.Parse(document.RootElement, icao);
            return kind switch
            {
                AviationWeatherReadKind.Report => Answer<T>.Of(report),
                AviationWeatherReadKind.NoReport => Answer<T>.NoReport,
                _ => Answer<T>.Failure(null),
            };
        }
        catch (Exception exception) when (exception is JsonException or HttpRequestException or IOException or
                                          OperationCanceledException)
        {
            return Answer<T>.Failure(null);
        }
    }

    private Uri Query<T>(Product<T> product, string icao) where T : class =>
        new(BaseUrl, $"{product.Path}?ids={icao}&format=json");

    /// <summary>What <c>Retry-After</c> asks for, as a delay or as a date; never negative.</summary>
    private static TimeSpan? RetryAfter(HttpResponseMessage response, DateTimeOffset now)
    {
        var delay = response.Headers.RetryAfter?.Delta ??
            (response.Headers.RetryAfter?.Date is { } date ? date - now : null);
        return delay is { } value && value < TimeSpan.Zero ? TimeSpan.Zero : delay;
    }

    private static DateTimeOffset? Latest(DateTimeOffset? left, DateTimeOffset? right) =>
        left is null ? right : right is null ? left : left > right ? left : right;

    public void Dispose() => _http.Dispose();

    /// <summary>One report of the Data API: its query path, how long it is served and when it may no longer be.</summary>
    private sealed class Product<T>(string path, TimeSpan lifetime, TimeSpan staleLimit,
        Func<JsonElement, string, (AviationWeatherReadKind Kind, T? Report)> parse, Func<T, DateTimeOffset, bool> servable)
        where T : class
    {
        public string Path { get; } = path;

        public TimeSpan Lifetime { get; } = lifetime;

        public TimeSpan StaleLimit { get; } = staleLimit;

        public (AviationWeatherReadKind Kind, T? Report) Parse(JsonElement root, string icao) => parse(root, icao);

        public bool IsServable(T report, DateTimeOffset now) => servable(report, now);
    }

    /// <summary>What the service answered: a report or none (both succeed), or a failure with its <c>Retry-After</c>.</summary>
    private readonly record struct Answer<T>(bool Succeeded, T? Report, TimeSpan? RetryAfter) where T : class
    {
        public static Answer<T> NoReport => new(true, null, null);

        public static Answer<T> Of(T? report) => new(true, report, null);

        public static Answer<T> Failure(TimeSpan? retryAfter) => new(false, null, retryAfter);
    }

    /// <summary>What a caller is served of one report.</summary>
    private readonly record struct Served<T>(T? Report, bool KeptAfterFailure, DateTimeOffset? RetrievedAt) where T : class;

    private sealed class AirportState
    {
        public ReportState<AerodromeMetar> Metar { get; } = new();

        public ReportState<AerodromeTaf> Taf { get; } = new();
    }

    /// <summary>
    /// The memory of one report of one airport: the last answer and when it came, the failures in a row since, when the
    /// service may be asked again and the read on its way. Every member is used under <see cref="Gate"/>.
    /// </summary>
    private sealed class ReportState<T> where T : class
    {
        public Lock Gate { get; } = new();

        public T? Report { get; private set; }

        /// <summary>When the service last answered; null before it ever did.</summary>
        public DateTimeOffset? RetrievedAt { get; private set; }

        public int Failures { get; private set; }

        public DateTimeOffset? NextAttemptAt { get; private set; }

        public TaskCompletionSource? InFlight { get; set; }

        /// <summary>
        /// Whether the last read was answered less than <paramref name="lifetime"/> ago. A clock set back never keeps an
        /// answer current: it is read again.
        /// </summary>
        public bool IsCurrent(DateTimeOffset now, TimeSpan lifetime) =>
            Failures == 0 && RetrievedAt is { } at && now >= at && now - at < lifetime;

        /// <summary>Whether the wait after a failure still runs; a clock set back never stretches it beyond the longest.</summary>
        public bool IsWaiting(DateTimeOffset now) =>
            NextAttemptAt is { } next && next > now && next - now <= AviationWeatherBackOff.MaxWait;

        public void Record(Answer<T> answer, DateTimeOffset now)
        {
            if (answer.Succeeded)
            {
                Report = answer.Report;
                RetrievedAt = now;
                Failures = 0;
                NextAttemptAt = null;
                return;
            }
            if (Failures < int.MaxValue) Failures++;
            NextAttemptAt = now + AviationWeatherBackOff.Next(Failures, answer.RetryAfter);
        }

        /// <summary>
        /// The report as it may be served now: after a failure only within its stale limit, and marked as kept; never
        /// once its product says it may not be (a TAF past its validity).
        /// </summary>
        public Served<T> Serve(DateTimeOffset now, Product<T> product)
        {
            if (Report is not { } report || !product.IsServable(report, now)) return new(null, false, RetrievedAt);
            if (Failures == 0) return new(report, false, RetrievedAt);
            return RetrievedAt is { } at && now - at < product.StaleLimit
                ? new(report, true, RetrievedAt)
                : new(null, false, RetrievedAt);
        }
    }
}
