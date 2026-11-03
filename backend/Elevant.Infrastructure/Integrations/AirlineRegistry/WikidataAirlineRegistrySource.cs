using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.RegularExpressions;
using Elevant.Application.Abstractions.Commercial;

namespace Elevant.Infrastructure.Integrations.AirlineRegistry;

/// <summary>
/// Looks airlines up in Wikidata (CC0, no key) by IATA (P229) or ICAO (P230) designator: label,
/// country (P17 → ISO P297) and dissolution date (P576). The query text is built only from
/// validated codes, the endpoint is fixed and every failure returns null so the next registry
/// answers (ADR-0023).
/// </summary>
public sealed partial class WikidataAirlineRegistrySource(HttpClient httpClient) : IAirlineRegistrySource
{
    private const string Endpoint = "https://query.wikidata.org/sparql";
    internal const string UserAgent = "ELEVANT-AVIAM/1.0 (airline registry check; ground handling platform)";

    public string Name => "Wikidata";

    public int Order => 10;

    public async Task<IReadOnlyList<AirlineRegistryCandidate>?> FindAsync(string? iataCode, string? icaoCode,
        CancellationToken cancellationToken = default)
    {
        var iata = iataCode?.Trim().ToUpperInvariant();
        var icao = icaoCode?.Trim().ToUpperInvariant();
        var filters = new List<string>();
        if (!string.IsNullOrEmpty(iata) && IataPattern().IsMatch(iata)) filters.Add($"{{ ?item wdt:P229 \"{iata}\" }}");
        if (!string.IsNullOrEmpty(icao) && IcaoPattern().IsMatch(icao)) filters.Add($"{{ ?item wdt:P230 \"{icao}\" }}");
        if (filters.Count == 0) return [];

        var query = "SELECT ?item ?itemLabel ?iata ?icao ?countryCode ?dissolved WHERE { " +
            string.Join(" UNION ", filters) +
            " OPTIONAL { ?item wdt:P229 ?iata } OPTIONAL { ?item wdt:P230 ?icao }" +
            " OPTIONAL { ?item wdt:P17 ?country . ?country wdt:P297 ?countryCode }" +
            " OPTIONAL { ?item wdt:P576 ?dissolved }" +
            " SERVICE wikibase:label { bd:serviceParam wikibase:language \"es,en\". } } LIMIT 200";
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{Endpoint}?query={Uri.EscapeDataString(query)}");
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/sparql-results+json"));
        request.Headers.UserAgent.ParseAdd(UserAgent);
        try
        {
            using var response = await httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (!response.IsSuccessStatusCode) return null;
            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var json = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
            return Parse(json.RootElement);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception) when (exception is HttpRequestException or OperationCanceledException or
            JsonException or InvalidOperationException or KeyNotFoundException)
        {
            return null;
        }
    }

    /// <summary>Groups the SPARQL rows by entity; one airline can carry several codes.</summary>
    internal static IReadOnlyList<AirlineRegistryCandidate> Parse(JsonElement root)
    {
        var items = new Dictionary<string, (string Name, HashSet<string> Iata, HashSet<string> Icao, string? Country, bool Dissolved)>(StringComparer.Ordinal);
        foreach (var row in root.GetProperty("results").GetProperty("bindings").EnumerateArray())
        {
            static string? Value(JsonElement binding, string key) =>
                binding.TryGetProperty(key, out var value) ? value.GetProperty("value").GetString() : null;
            var item = Value(row, "item");
            if (item is null || !item.StartsWith("http://www.wikidata.org/entity/Q", StringComparison.Ordinal)) continue;
            if (!items.TryGetValue(item, out var entry))
                entry = (Value(row, "itemLabel") ?? item, new HashSet<string>(StringComparer.Ordinal),
                    new HashSet<string>(StringComparer.Ordinal), null, false);
            if (Value(row, "iata") is { } iata) entry.Iata.Add(iata.ToUpperInvariant());
            if (Value(row, "icao") is { } icao) entry.Icao.Add(icao.ToUpperInvariant());
            entry.Country ??= Value(row, "countryCode");
            entry.Dissolved |= Value(row, "dissolved") is not null;
            items[item] = entry;
        }
        return items.Select(pair => new AirlineRegistryCandidate(pair.Value.Name,
                pair.Value.Iata.Order(StringComparer.Ordinal).ToArray(), pair.Value.Icao.Order(StringComparer.Ordinal).ToArray(),
                pair.Value.Country, !pair.Value.Dissolved,
                "https://www.wikidata.org/wiki/" + pair.Key["http://www.wikidata.org/entity/".Length..]))
            .ToArray();
    }

    [GeneratedRegex("^[A-Z0-9]{2}$")]
    private static partial Regex IataPattern();

    [GeneratedRegex("^[A-Z]{3}$")]
    private static partial Regex IcaoPattern();
}
