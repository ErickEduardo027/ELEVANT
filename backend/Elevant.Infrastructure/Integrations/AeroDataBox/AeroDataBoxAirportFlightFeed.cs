using System.Globalization;
using System.Net;
using System.Text.Json;
using Elevant.Application.Abstractions.Integrations;
using Elevant.Domain.Enumerations;

namespace Elevant.Infrastructure.Integrations.AeroDataBox;

/// <summary>
/// AeroDataBox FIDS (<c>GET /flights/airports/iata/{code}/{fromLocal}/{toLocal}</c>, tier 2,
/// 2 units a call), ADR-0028. One call returns arrivals and departures of up to 12 hours; the
/// query leaves out codeshares, cargo, private flights and live positions to keep the answer small,
/// and asks for the other airport of each leg, which costs nothing extra.
/// </summary>
public sealed class AeroDataBoxAirportFlightFeed(HttpClient httpClient, AeroDataBoxOptions options) : IAirportFlightFeed
{
    public const string ProviderName = "AeroDataBox";

    public string Provider => ProviderName;

    public bool IsConfigured => options.Enabled && !string.IsNullOrWhiteSpace(options.ApiKey);

    public int UnitsPerCall => 2;

    public TimeSpan MaxWindow => TimeSpan.FromHours(12);

    public async Task<AirportFeedResponse> GetFlightsAsync(string airportIataCode, DateTime fromLocal, DateTime toLocal,
        CancellationToken cancellationToken = default)
    {
        if (!IsConfigured) return AirportFeedResponse.Failure(ProviderCallOutcome.Unauthorized, 0, null);
        if (airportIataCode is not { Length: 3 } || toLocal <= fromLocal || toLocal - fromLocal > MaxWindow)
            throw new ArgumentException("The airport code or the window is invalid.");

        using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(new Uri(options.BaseUrl),
            $"flights/airports/iata/{Uri.EscapeDataString(airportIataCode.ToUpperInvariant())}/{Local(fromLocal)}/{Local(toLocal)}" +
            "?direction=Both&withLeg=true&withCancelled=true&withCodeshared=false&withCargo=false&withPrivate=false&withLocation=false"));
        request.Headers.Add("X-Api-Key", options.ApiKey);
        request.Headers.Accept.ParseAdd("application/json");

        HttpResponseMessage response;
        try
        {
            response = await httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException &&
                                          !cancellationToken.IsCancellationRequested)
        {
            return AirportFeedResponse.Failure(ProviderCallOutcome.Failed, 0, null);
        }

        using (response)
        {
            var status = (int)response.StatusCode;
            switch (response.StatusCode)
            {
                case HttpStatusCode.OK:
                    await using (var stream = await response.Content.ReadAsStreamAsync(cancellationToken))
                    {
                        try
                        {
                            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
                            return new AirportFeedResponse(ProviderCallOutcome.Succeeded, UnitsPerCall, status, null,
                                Parse(document.RootElement));
                        }
                        catch (JsonException)
                        {
                            return AirportFeedResponse.Failure(ProviderCallOutcome.Failed, UnitsPerCall, status);
                        }
                    }
                case HttpStatusCode.NoContent:
                    return new AirportFeedResponse(ProviderCallOutcome.NoContent, UnitsPerCall, status, null, []);
                case HttpStatusCode.Unauthorized:
                    return AirportFeedResponse.Failure(ProviderCallOutcome.Unauthorized, 0, status);
                case HttpStatusCode.TooManyRequests or HttpStatusCode.Forbidden or HttpStatusCode.PaymentRequired:
                    var body = await response.Content.ReadAsStringAsync(cancellationToken);
                    if (body.Contains("quota", StringComparison.OrdinalIgnoreCase) ||
                        body.Contains("limit exceeded", StringComparison.OrdinalIgnoreCase) ||
                        response.StatusCode == HttpStatusCode.PaymentRequired)
                        return AirportFeedResponse.Failure(ProviderCallOutcome.QuotaExceeded, 0, status);
                    return response.StatusCode == HttpStatusCode.Forbidden
                        ? AirportFeedResponse.Failure(ProviderCallOutcome.Unauthorized, 0, status)
                        : AirportFeedResponse.Failure(ProviderCallOutcome.RateLimited, 0, status, RetryAfter(response));
                default:
                    // A rejected query (400, 451) was still answered: count it, so a bad request cannot loop for free.
                    return AirportFeedResponse.Failure(ProviderCallOutcome.Failed, status < 500 ? UnitsPerCall : 0, status,
                        RetryAfter(response));
            }
        }
    }

    /// <summary>Normalizes a FIDS document; legs without a scheduled time are skipped.</summary>
    public static IReadOnlyList<FeedFlight> Parse(JsonElement root)
    {
        var flights = new List<FeedFlight>();
        foreach (var (property, direction) in new[] { ("arrivals", FlightDirection.Arrival), ("departures", FlightDirection.Departure) })
        {
            if (!root.TryGetProperty(property, out var items) || items.ValueKind != JsonValueKind.Array) continue;
            foreach (var item in items.EnumerateArray())
            {
                var number = Text(item, "number");
                if (number is null) continue;
                var opposite = Object(item, direction == FlightDirection.Arrival ? "departure" : "arrival");
                var here = Object(item, "movement") ?? Object(item, direction == FlightDirection.Arrival ? "arrival" : "departure");
                if (here is not { } movement || Time(movement, "scheduledTime") is not { } scheduled) continue;
                var counterpart = Airport(opposite is { } leg ? Object(leg, "airport") : null) ?? Airport(Object(movement, "airport"));
                var airline = Object(item, "airline") is { } airlineElement && Text(airlineElement, "name") is { } airlineName
                    ? new FeedAirline(airlineName, Code(airlineElement, "iata", 2), Code(airlineElement, "icao", 3))
                    : null;
                var aircraft = Object(item, "aircraft");
                flights.Add(new FeedFlight(direction, Normalize(number), airline, counterpart, scheduled,
                    Time(movement, "revisedTime"), Time(movement, "runwayTime"), Text(item, "status") ?? "Unknown",
                    aircraft is { } a ? Text(a, "reg")?.ToUpperInvariant() : null, aircraft is { } m ? Text(m, "model") : null,
                    Text(movement, "terminal"), Text(movement, "gate"),
                    item.TryGetProperty("isCargo", out var cargo) && cargo.ValueKind == JsonValueKind.True,
                    Text(item, "codeshareStatus") ?? "Unknown"));
            }
        }
        return flights;
    }

    private static FeedAirport? Airport(JsonElement? element)
    {
        if (element is not { } airport || Text(airport, "name") is not { } name) return null;
        var location = Object(airport, "location");
        return new FeedAirport(Code(airport, "iata", 3), Code(airport, "icao", 4), name,
            Text(airport, "municipalityName"), Code(airport, "countryCode", 2), Text(airport, "timeZone"),
            location is { } l && l.TryGetProperty("lat", out var lat) && lat.TryGetDecimal(out var latitude) ? latitude : null,
            location is { } o && o.TryGetProperty("lon", out var lon) && lon.TryGetDecimal(out var longitude) ? longitude : null);
    }

    private static DateTimeOffset? Time(JsonElement movement, string property) =>
        Object(movement, property) is { } time && Text(time, "utc") is { } utc &&
        DateTimeOffset.TryParse(utc, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var value)
            ? value
            : null;

    private static JsonElement? Object(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.Object ? value : null;

    private static string? Text(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String &&
        !string.IsNullOrWhiteSpace(value.GetString())
            ? value.GetString()!.Trim()
            : null;

    private static string? Code(JsonElement element, string property, int length) =>
        Text(element, property)?.ToUpperInvariant() is { } code && code.Length == length ? code : null;

    /// <summary>«DM 161» → «DM161».</summary>
    private static string Normalize(string number) => number.Replace(" ", string.Empty, StringComparison.Ordinal).ToUpperInvariant();

    private static string Local(DateTime value) => value.ToString("yyyy-MM-dd'T'HH:mm", CultureInfo.InvariantCulture);

    private static TimeSpan? RetryAfter(HttpResponseMessage response) =>
        response.Headers.RetryAfter?.Delta ??
        (response.Headers.RetryAfter?.Date is { } date ? date - DateTimeOffset.UtcNow : null);
}

/// <summary>The feed when AeroDataBox is disabled or has no key: reports itself unconfigured and never calls.</summary>
public sealed class DisabledAirportFlightFeed : IAirportFlightFeed
{
    public string Provider => AeroDataBoxAirportFlightFeed.ProviderName;

    public bool IsConfigured => false;

    public int UnitsPerCall => 2;

    public TimeSpan MaxWindow => TimeSpan.FromHours(12);

    public Task<AirportFeedResponse> GetFlightsAsync(string airportIataCode, DateTime fromLocal, DateTime toLocal,
        CancellationToken cancellationToken = default) =>
        Task.FromResult(AirportFeedResponse.Failure(ProviderCallOutcome.Unauthorized, 0, null));
}
