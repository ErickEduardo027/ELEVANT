using System.Net;
using System.Text.Json;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations.AirPicture;

namespace Elevant.Infrastructure.Integrations.AirTraffic;

/// <summary>
/// One network of the readsb v2 family (ADR-0042, contracts 1.3), by its <see cref="ReadsbProfile"/>: one GET of the
/// point query per read, never a redirect and never a track. The key goes only to a network that takes one, in
/// <c>x-api-key</c>, and is never written anywhere else. adsb.lol's plain daily counter refuses a read before the network
/// would, without calling it.
/// </summary>
public sealed class ReadsbAirTrafficProvider : IAirTrafficProvider, IDisposable
{
    /// <summary>
    /// A generic product name: it names neither the project nor a person, an address or a link (the networks see it).
    /// </summary>
    public const string UserAgent = "air-traffic-reader/1.0";

    /// <summary>The longest a read may take, the answer included.</summary>
    public static TimeSpan Timeout { get; } = TimeSpan.FromSeconds(10);

    /// <summary>The largest answer read; a 250 NM circle around Punta Cana is a small fraction of it.</summary>
    public const long MaxAnswerBytes = 8 * 1024 * 1024;

    private const string KeyHeader = "x-api-key";
    private readonly HttpClient _http;
    private readonly string? _key;
    private readonly TimeProvider _time;
    private readonly Lock _counterGate = new();
    private DateOnly _counterDay;
    private int _requestsOfDay;

    public ReadsbAirTrafficProvider(HttpClient http, ReadsbProfile profile, string? key, TimeProvider time)
    {
        ArgumentNullException.ThrowIfNull(http);
        ArgumentNullException.ThrowIfNull(profile);
        ArgumentNullException.ThrowIfNull(time);
        _http = http;
        Profile = profile;
        _key = profile.TakesKey && !string.IsNullOrWhiteSpace(key) ? key.Trim() : null;
        _time = time;
        DailyLimit = profile.DailyLimit(_key is not null);
    }

    public bool IsConfigured => true;

    public AirTrafficAttribution? Attribution => Profile.Attribution;

    internal ReadsbProfile Profile { get; }

    /// <summary>Whether reads carry a key: only with one configured, and only for a network that takes it.</summary>
    internal bool SendsKey => _key is not null;

    /// <summary>The requests a UTC day may send this network; null without a daily limit.</summary>
    internal int? DailyLimit { get; }

    /// <summary>
    /// The client every network is read with: no redirects, a ten-second limit for the whole answer, compressed answers
    /// accepted and a ceiling on their size.
    /// </summary>
    public static HttpClient CreateHttpClient() =>
        new(CreateHandler()) { Timeout = Timeout, MaxResponseContentBufferSize = MaxAnswerBytes };

    internal static HttpClientHandler CreateHandler() =>
        new() { AllowAutoRedirect = false, AutomaticDecompression = DecompressionMethods.All };

    public async Task<AirTrafficReadResult> ReadAsync(AirTrafficArea area, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(area);
        if (!double.IsFinite(area.Latitude) || area.Latitude is < -90 or > 90 ||
            !double.IsFinite(area.Longitude) || area.Longitude is < -180 or > 180 ||
            area.RadiusNm is < 1 or > AirTrafficSettings.MaxRadiusNm)
            throw new ArgumentOutOfRangeException(nameof(area), "The area must be a position on Earth and a radius from 1 to 250 NM.");

        // No Retry-After: the network asked for nothing, and a long wait here would keep the next network of the list
        // from taking over. A refused read costs no request, however often it is tried.
        if (!TryCountRequest())
            return AirTrafficReadResult.Failure(AirTrafficOutcome.QuotaExceeded, Attribution);

        using var request = new HttpRequestMessage(HttpMethod.Get, Profile.PointQuery(area));
        request.Headers.Accept.ParseAdd("application/json");
        request.Headers.UserAgent.ParseAdd(UserAgent);
        if (_key is not null) request.Headers.TryAddWithoutValidation(KeyHeader, _key);

        HttpResponseMessage response;
        try
        {
            // The whole answer is read here, so the client's limit covers it too.
            response = await _http.SendAsync(request, HttpCompletionOption.ResponseContentRead, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception) when (exception is HttpRequestException or OperationCanceledException or IOException)
        {
            // A timeout, a refused connection or an answer too large: the message is never logged, it may name the host.
            return AirTrafficReadResult.Failure(AirTrafficOutcome.Failed, Attribution);
        }

        using (response)
        {
            var receivedAt = _time.GetUtcNow();
            switch (response.StatusCode)
            {
                case HttpStatusCode.OK:
                    return await ReadAnswerAsync(response, receivedAt, cancellationToken);
                case HttpStatusCode.TooManyRequests:
                    return AirTrafficReadResult.Failure(AirTrafficOutcome.RateLimited, Attribution, RetryAfter(response, receivedAt));
                case HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden:
                    return AirTrafficReadResult.Failure(AirTrafficOutcome.Unauthorized, Attribution);
                default:
                    return AirTrafficReadResult.Failure(AirTrafficOutcome.Failed, Attribution);
            }
        }
    }

    private async Task<AirTrafficReadResult> ReadAnswerAsync(HttpResponseMessage response, DateTimeOffset receivedAt,
        CancellationToken cancellationToken)
    {
        try
        {
            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
            return ReadsbV2Parser.Parse(document.RootElement, receivedAt) is { } answer
                ? new AirTrafficReadResult(AirTrafficOutcome.Succeeded, Attribution, answer.ObservedAt, answer.Aircraft, null)
                : AirTrafficReadResult.Failure(AirTrafficOutcome.Failed, Attribution);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception) when (exception is JsonException or HttpRequestException or IOException)
        {
            return AirTrafficReadResult.Failure(AirTrafficOutcome.Failed, Attribution);
        }
    }

    /// <summary>
    /// Counts one request of the current UTC day; false when the day's requests are spent. A network without a daily
    /// limit is never refused. Every request sent counts, whatever the network answers.
    /// </summary>
    private bool TryCountRequest()
    {
        if (DailyLimit is not { } limit) return true;
        var today = DateOnly.FromDateTime(_time.GetUtcNow().UtcDateTime);
        lock (_counterGate)
        {
            if (today != _counterDay)
            {
                _counterDay = today;
                _requestsOfDay = 0;
            }
            if (_requestsOfDay >= limit) return false;
            _requestsOfDay++;
            return true;
        }
    }

    /// <summary>What <c>Retry-After</c> asks for, as a delay or as a date; never negative.</summary>
    private static TimeSpan? RetryAfter(HttpResponseMessage response, DateTimeOffset now)
    {
        var delay = response.Headers.RetryAfter?.Delta ??
            (response.Headers.RetryAfter?.Date is { } date ? date - now : null);
        return delay is { } value && value < TimeSpan.Zero ? TimeSpan.Zero : delay;
    }

    public void Dispose() => _http.Dispose();
}
