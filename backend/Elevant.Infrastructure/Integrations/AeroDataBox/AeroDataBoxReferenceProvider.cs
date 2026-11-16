using System.Globalization;
using System.Net;
using System.Text.Json;
using Elevant.Application.Abstractions.Integrations;
using Elevant.Domain.Enumerations;

namespace Elevant.Infrastructure.Integrations.AeroDataBox;

/// <summary>
/// The on-demand reference reads of AeroDataBox (ADR-0028, note of 15 November 2026), with the same key and the same
/// direct gateway as the FIDS feed. Units per call, from the public documentation and price list:
/// <list type="bullet">
/// <item><c>GET /airlines/{code}/aircrafts?pageSize=25</c> (airline fleet, tier 3): 6 units;</item>
/// <item><c>GET /aircrafts/reg/{registration}</c> (single aircraft, tier 1): 1 unit;</item>
/// <item><c>GET /airports/icao/{code}/stats/routes/daily</c> (routes and daily destinations, tier 3): 6 units;</item>
/// <item><c>GET /airports/{iata|icao}/{code}/delays</c> (current delays, tier 3): 6 units.</item>
/// </list>
/// Nothing here is called at startup; <see cref="Application.Integration.AviationReference.AviationReferenceReader"/>
/// is its only caller.
/// </summary>
public sealed class AeroDataBoxReferenceProvider(HttpClient httpClient, AeroDataBoxOptions options) : IAviationReferenceProvider
{
    /// <summary>The fleet page size of the Starter plan.</summary>
    public const int FleetPageSize = 25;

    public const int FleetUnits = 6;
    public const int AircraftUnits = 1;
    public const int RoutesUnits = 6;
    public const int DelaysUnits = 6;

    public string Provider => AeroDataBoxAirportFlightFeed.ProviderName;

    public bool IsConfigured => options.Enabled && !string.IsNullOrWhiteSpace(options.ApiKey);

    public Task<ReferenceCall<AirlineFleetFacts>> GetAirlineFleetAsync(string airlineCode,
        CancellationToken cancellationToken = default) =>
        SendAsync($"airlines/{Uri.EscapeDataString(airlineCode.ToUpperInvariant())}/aircrafts?pageSize={FleetPageSize}&pageOffset=0&withRegistrations=false",
            FleetUnits, ParseFleet, cancellationToken);

    public Task<ReferenceCall<AircraftFacts>> GetAircraftAsync(string registration, CancellationToken cancellationToken = default) =>
        SendAsync($"aircrafts/reg/{Uri.EscapeDataString(registration.ToUpperInvariant())}?withImage=false&withRegistrations=false",
            AircraftUnits, ParseAircraft, cancellationToken);

    public Task<ReferenceCall<AirportRouteFacts>> GetDailyRoutesAsync(string airportIcao,
        CancellationToken cancellationToken = default) =>
        SendAsync($"airports/icao/{Uri.EscapeDataString(airportIcao.ToUpperInvariant())}/stats/routes/daily", RoutesUnits,
            ParseRoutes, cancellationToken);

    public Task<ReferenceCall<AirportDelayFacts>> GetDelaysAsync(string airportCode, CancellationToken cancellationToken = default)
    {
        var code = airportCode.ToUpperInvariant();
        return SendAsync($"airports/{(code.Length == 3 ? "iata" : "icao")}/{Uri.EscapeDataString(code)}/delays", DelaysUnits,
            ParseDelays, cancellationToken);
    }

    private async Task<ReferenceCall<T>> SendAsync<T>(string path, int units, Func<JsonElement, T?> parse,
        CancellationToken cancellationToken)
        where T : class
    {
        if (!IsConfigured) return ReferenceCall<T>.Failure(ProviderCallOutcome.Unauthorized, 0, null);
        using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(new Uri(options.BaseUrl), path));
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
            return ReferenceCall<T>.Failure(ProviderCallOutcome.Failed, 0, null);
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
                            var value = parse(document.RootElement);
                            return value is null
                                ? new ReferenceCall<T>(ProviderCallOutcome.NoContent, units, status, null, null)
                                : new ReferenceCall<T>(ProviderCallOutcome.Succeeded, units, status, null, value);
                        }
                        catch (JsonException)
                        {
                            return ReferenceCall<T>.Failure(ProviderCallOutcome.Failed, units, status);
                        }
                    }
                case HttpStatusCode.NoContent or HttpStatusCode.NotFound:
                    return new ReferenceCall<T>(ProviderCallOutcome.NoContent, units, status, null, null);
                case HttpStatusCode.Unauthorized:
                    return ReferenceCall<T>.Failure(ProviderCallOutcome.Unauthorized, 0, status);
                case HttpStatusCode.TooManyRequests or HttpStatusCode.Forbidden or HttpStatusCode.PaymentRequired:
                    var body = await response.Content.ReadAsStringAsync(cancellationToken);
                    if (body.Contains("quota", StringComparison.OrdinalIgnoreCase) ||
                        body.Contains("limit exceeded", StringComparison.OrdinalIgnoreCase) ||
                        response.StatusCode == HttpStatusCode.PaymentRequired)
                        return ReferenceCall<T>.Failure(ProviderCallOutcome.QuotaExceeded, 0, status);
                    return response.StatusCode == HttpStatusCode.Forbidden
                        ? ReferenceCall<T>.Failure(ProviderCallOutcome.Unauthorized, 0, status)
                        : ReferenceCall<T>.Failure(ProviderCallOutcome.RateLimited, 0, status, RetryAfter(response));
                default:
                    // A rejected query (400, 451) was still answered: count it, as the FIDS feed does.
                    return ReferenceCall<T>.Failure(ProviderCallOutcome.Failed, status < 500 ? units : 0, status,
                        RetryAfter(response));
            }
        }
    }

    /// <summary>A fleet page (<c>AircraftContractPagedCollectionContract</c>); null when it lists no aircraft.</summary>
    public static AirlineFleetFacts? ParseFleet(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object) return null;
        var sample = root.TryGetProperty("items", out var items) && items.ValueKind == JsonValueKind.Array
            ? items.EnumerateArray().Select(ParseAircraft).OfType<AircraftFacts>().ToArray()
            : [];
        var total = Int(root, "totalCount") ?? sample.Length;
        return total <= 0 && sample.Length == 0 ? null : new AirlineFleetFacts(Math.Max(total, sample.Length), sample);
    }

    /// <summary>One aircraft (<c>AircraftContract</c>); null without a registration.</summary>
    public static AircraftFacts? ParseAircraft(JsonElement item)
    {
        if (item.ValueKind != JsonValueKind.Object || Text(item, "reg") is not { } registration) return null;
        return new AircraftFacts(registration.ToUpperInvariant(),
            item.TryGetProperty("active", out var active) && active.ValueKind == JsonValueKind.True,
            Text(item, "model"), Text(item, "typeName"), Text(item, "icaoCode")?.ToUpperInvariant(),
            Text(item, "iataType")?.ToUpperInvariant(), Text(item, "airlineName"), Text(item, "serial"),
            Text(item, "hexIcao")?.ToUpperInvariant(), Int(item, "numSeats"), Int(item, "numEngines"),
            Text(item, "engineType"),
            item.TryGetProperty("ageYears", out var age) && age.ValueKind == JsonValueKind.Number && age.TryGetDouble(out var years) &&
            double.IsFinite(years) && years >= 0
                ? Math.Round(years, 1)
                : null,
            Date(item, "firstFlightDate"), Date(item, "deliveryDate"), Date(item, "registrationDate"),
            item.TryGetProperty("isFreighter", out var freighter) && freighter.ValueKind == JsonValueKind.True);
    }

    /// <summary>The daily routes (<c>DailyRouteStatContract</c>), most frequent first; null without routes.</summary>
    public static AirportRouteFacts? ParseRoutes(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("routes", out var routes) ||
            routes.ValueKind != JsonValueKind.Array)
            return null;
        var list = new List<AirportRoute>();
        foreach (var route in routes.EnumerateArray())
        {
            if (route.ValueKind != JsonValueKind.Object || Object(route, "destination") is not { } destination ||
                Text(destination, "name") is not { } name)
                continue;
            if (!route.TryGetProperty("averageDailyFlights", out var daily) || !daily.TryGetDouble(out var flights) ||
                !double.IsFinite(flights) || flights <= 0)
                continue;
            var location = Object(destination, "location");
            double? lat = location is { } l && l.TryGetProperty("lat", out var la) && la.TryGetDouble(out var a) && a is >= -90 and <= 90 ? a : null;
            double? lon = location is { } o && o.TryGetProperty("lon", out var lo) && lo.TryGetDouble(out var b) && b is >= -180 and <= 180 ? b : null;
            var operators = route.TryGetProperty("operators", out var airlines) && airlines.ValueKind == JsonValueKind.Array
                ? airlines.EnumerateArray().Where(airline => airline.ValueKind == JsonValueKind.Object)
                    .Select(airline => Text(airline, "name")).OfType<string>().Distinct(StringComparer.Ordinal).Take(12).ToArray()
                : [];
            list.Add(new AirportRoute(Code(destination, "iata", 3), Code(destination, "icao", 4), name,
                Text(destination, "municipalityName"), Code(destination, "countryCode", 2), lat is null || lon is null ? null : lat,
                lat is null || lon is null ? null : lon, Math.Round(flights, 1), operators));
        }
        return list.Count == 0
            ? null
            : new AirportRouteFacts([.. list.OrderByDescending(route => route.AverageDailyFlights).ThenBy(route => route.Name, StringComparer.Ordinal).Take(80)]);
    }

    /// <summary>The current delays (<c>AirportDelayContract</c>); null without both batches.</summary>
    public static AirportDelayFacts? ParseDelays(JsonElement root)
    {
        // The documentation describes a single item; a one-item array is accepted as well.
        if (root.ValueKind == JsonValueKind.Array) root = root.EnumerateArray().FirstOrDefault();
        if (root.ValueKind != JsonValueKind.Object) return null;
        if (Object(root, "arrivalsDelayInformation") is not { } arrivals ||
            Object(root, "departuresDelayInformation") is not { } departures ||
            Utc(root, "from") is not { } from || Utc(root, "to") is not { } to)
            return null;
        return new AirportDelayFacts(Text(root, "airportIcao")?.ToUpperInvariant() ?? string.Empty, from, to, Batch(arrivals),
            Batch(departures));
    }

    private static DelayBatch Batch(JsonElement batch) =>
        new(Math.Max(0, Int(batch, "numTotal") ?? 0), Math.Max(0, Int(batch, "numQualifiedTotal") ?? 0),
            Math.Max(0, Int(batch, "numCancelled") ?? 0), Minutes(Text(batch, "medianDelay")),
            batch.TryGetProperty("delayIndex", out var index) && index.TryGetDouble(out var value) && double.IsFinite(value)
                ? Math.Round(Math.Clamp(value, 0, 5), 2)
                : null);

    /// <summary>«00:12:30» → 13, «-00:04:00» → −4; null when it is not a time span.</summary>
    private static int? Minutes(string? span) =>
        span is not null && TimeSpan.TryParse(span, CultureInfo.InvariantCulture, out var value)
            ? (int)Math.Round(value.TotalMinutes, MidpointRounding.AwayFromZero)
            : null;

    private static DateTimeOffset? Utc(JsonElement element, string property) =>
        Object(element, property) is { } time && Text(time, "utc") is { } utc &&
        DateTimeOffset.TryParse(utc, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var value)
            ? value
            : null;

    private static DateOnly? Date(JsonElement element, string property) =>
        Text(element, property) is { } text &&
        DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var value)
            ? DateOnly.FromDateTime(value.UtcDateTime)
            : null;

    private static int? Int(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number)
            ? number
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

    private static TimeSpan? RetryAfter(HttpResponseMessage response) =>
        response.Headers.RetryAfter?.Delta ??
        (response.Headers.RetryAfter?.Date is { } date ? date - DateTimeOffset.UtcNow : null);
}
