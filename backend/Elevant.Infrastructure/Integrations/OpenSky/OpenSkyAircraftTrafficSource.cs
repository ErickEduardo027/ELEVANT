using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations;

namespace Elevant.Infrastructure.Integrations.OpenSky;

/// <summary>Single-flight, bounded OpenSky reader. The client cannot choose the provider URL or area.</summary>
public sealed class OpenSkyAircraftTrafficSource : IOccAircraftTrafficSource, IDisposable
{
    private const string TokenUrl = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
    private const string StatesUrl = "https://opensky-network.org/api/states/all?lamin=17&lomin=-73&lamax=21&lomax=-67&extended=1";
    private static readonly TimeSpan MinimumInterval = TimeSpan.FromMinutes(2);
    private static readonly TimeSpan StaleGrace = TimeSpan.FromMinutes(10);
    private readonly HttpClient _httpClient;
    private readonly OpenSkyOptions _options;
    private readonly TimeProvider _timeProvider;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private OccAircraftTrafficData? _lastSuccess;
    private DateTimeOffset _nextFetchAt;
    private string? _accessToken;
    private DateTimeOffset _tokenExpiresAt;

    public OpenSkyAircraftTrafficSource(HttpClient httpClient, OpenSkyOptions options, TimeProvider timeProvider)
    {
        _httpClient = httpClient;
        _options = options;
        _timeProvider = timeProvider;
    }

    public async Task<OccAircraftTrafficData?> ReadAsync(CancellationToken cancellationToken = default)
    {
        if (!_options.Enabled || string.IsNullOrWhiteSpace(_options.ClientId) ||
            string.IsNullOrWhiteSpace(_options.ClientSecret)) return null;

        await _gate.WaitAsync(cancellationToken);
        try
        {
            var now = _timeProvider.GetUtcNow();
            if (now < _nextFetchAt) return Cached(now, refreshFailed: false);
            _nextFetchAt = now.Add(MinimumInterval);
            try
            {
                var traffic = await FetchStatesAsync(cancellationToken);
                _lastSuccess = traffic;
                return Cached(_timeProvider.GetUtcNow(), refreshFailed: false);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception exception) when (exception is HttpRequestException or
                OperationCanceledException or JsonException or FormatException or InvalidOperationException)
            {
                return Cached(_timeProvider.GetUtcNow(), refreshFailed: true);
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    private OccAircraftTrafficData? Cached(DateTimeOffset now, bool refreshFailed)
    {
        if (_lastSuccess is null || now - _lastSuccess.RetrievedAt > StaleGrace) return null;
        var stale = refreshFailed || now - _lastSuccess.RetrievedAt >= MinimumInterval ||
            now - _lastSuccess.ProviderTime >= MinimumInterval;
        return _lastSuccess with { Stale = stale };
    }

    private async Task<OccAircraftTrafficData> FetchStatesAsync(CancellationToken cancellationToken)
    {
        for (var attempt = 0; attempt < 2; attempt++)
        {
            var token = await GetTokenAsync(cancellationToken);
            using var request = new HttpRequestMessage(HttpMethod.Get, StatesUrl);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (response.StatusCode == HttpStatusCode.Unauthorized && attempt == 0)
            {
                _accessToken = null;
                continue;
            }
            if (response.StatusCode == HttpStatusCode.TooManyRequests)
            {
                SetProviderBackoff(response);
                throw new HttpRequestException("OpenSky quota unavailable.");
            }
            if (!response.IsSuccessStatusCode)
            {
                if (response.StatusCode == HttpStatusCode.Forbidden)
                    _nextFetchAt = _timeProvider.GetUtcNow().AddMinutes(5);
                throw new HttpRequestException("OpenSky state request unavailable.");
            }
            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
            return ParseStates(document.RootElement, _timeProvider.GetUtcNow());
        }
        throw new HttpRequestException("OpenSky authorization unavailable.");
    }

    private async Task<string> GetTokenAsync(CancellationToken cancellationToken)
    {
        if (_accessToken is not null && _timeProvider.GetUtcNow() < _tokenExpiresAt)
            return _accessToken;
        using var request = new HttpRequestMessage(HttpMethod.Post, TokenUrl)
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["grant_type"] = "client_credentials",
                ["client_id"] = _options.ClientId!,
                ["client_secret"] = _options.ClientSecret!,
            }),
        };
        using var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        if (!response.IsSuccessStatusCode)
            throw new HttpRequestException("OpenSky token unavailable.");
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
        var root = document.RootElement;
        var token = root.TryGetProperty("access_token", out var accessToken) &&
            accessToken.ValueKind == JsonValueKind.String ? accessToken.GetString() : null;
        if (string.IsNullOrWhiteSpace(token)) throw new JsonException("OpenSky token missing.");
        var lifetime = root.TryGetProperty("expires_in", out var expiry) && expiry.TryGetInt32(out var seconds)
            ? seconds : 1800;
        _accessToken = token;
        _tokenExpiresAt = _timeProvider.GetUtcNow().AddSeconds(Math.Max(0, lifetime - 30));
        return token;
    }

    private void SetProviderBackoff(HttpResponseMessage response)
    {
        var delay = MinimumInterval;
        if (response.Headers.TryGetValues("X-Rate-Limit-Retry-After-Seconds", out var values) &&
            int.TryParse(values.FirstOrDefault(), NumberStyles.None, CultureInfo.InvariantCulture, out var seconds) &&
            seconds > 0)
            delay = TimeSpan.FromSeconds(seconds);
        else if (response.Headers.RetryAfter?.Delta is TimeSpan delta && delta > TimeSpan.Zero)
            delay = delta;
        else if (response.Headers.RetryAfter?.Date is DateTimeOffset date)
            delay = date - _timeProvider.GetUtcNow();
        _nextFetchAt = _timeProvider.GetUtcNow().Add(delay > MinimumInterval ? delay : MinimumInterval);
    }

    private static OccAircraftTrafficData ParseStates(JsonElement root, DateTimeOffset retrievedAt)
    {
        var providerTime = root.TryGetProperty("time", out var value)
            ? UnixTime(value) : null;
        if (providerTime is null) throw new JsonException("Provider time missing.");
        if (!root.TryGetProperty("states", out var states) || states.ValueKind == JsonValueKind.Null)
            return new OccAircraftTrafficData(providerTime.Value, retrievedAt, false, []);
        if (states.ValueKind != JsonValueKind.Array) throw new JsonException("Invalid state vectors.");

        var aircraft = new Dictionary<string, OccAircraftStateData>(StringComparer.OrdinalIgnoreCase);
        foreach (var row in states.EnumerateArray())
        {
            if (row.ValueKind != JsonValueKind.Array || row.GetArrayLength() < 17) continue;
            var icao24 = TextAt(row, 0)?.ToLowerInvariant();
            var longitude = NumberAt(row, 5);
            var latitude = NumberAt(row, 6);
            if (icao24 is null || icao24.Length != 6 || !icao24.All(Uri.IsHexDigit) ||
                longitude is null or < -73 or > -67 || latitude is null or < 17 or > 21 ||
                row[8].ValueKind is not (JsonValueKind.True or JsonValueKind.False)) continue;

            var state = new OccAircraftStateData(
                icao24, TextAt(row, 1), TextAt(row, 2), latitude.Value, longitude.Value,
                UnixTime(row[3]), UnixTime(row[4]), NumberAt(row, 7), NumberAt(row, 13),
                NumberAt(row, 9), NumberAt(row, 10), NumberAt(row, 11),
                row[8].GetBoolean(), TextAt(row, 14), IntegerAt(row, 16), IntegerAt(row, 17));
            if (!aircraft.TryGetValue(icao24, out var previous) ||
                (state.LastContactAt ?? DateTimeOffset.MinValue) > (previous.LastContactAt ?? DateTimeOffset.MinValue))
                aircraft[icao24] = state;
        }
        return new OccAircraftTrafficData(providerTime.Value, retrievedAt, false, aircraft.Values.ToArray());
    }

    private static string? TextAt(JsonElement row, int index) =>
        row.GetArrayLength() > index && row[index].ValueKind == JsonValueKind.String
            ? row[index].GetString()?.Trim() is { Length: > 0 } value ? value : null
            : null;

    private static double? NumberAt(JsonElement row, int index) =>
        row.GetArrayLength() > index && row[index].ValueKind == JsonValueKind.Number &&
        row[index].TryGetDouble(out var value) && double.IsFinite(value) ? value : null;

    private static int? IntegerAt(JsonElement row, int index) =>
        row.GetArrayLength() > index && row[index].ValueKind == JsonValueKind.Number &&
        row[index].TryGetInt32(out var value) ? value : null;

    private static DateTimeOffset? UnixTime(JsonElement value) =>
        value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var seconds) &&
        seconds >= 0 && seconds <= 253402300799L ? DateTimeOffset.FromUnixTimeSeconds(seconds) : null;

    public void Dispose()
    {
        _gate.Dispose();
        _httpClient.Dispose();
    }
}
