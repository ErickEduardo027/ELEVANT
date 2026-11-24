using System.Text.RegularExpressions;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations;

/// <summary>
/// An active aircraft type the provider's model text can be matched against; <paramref name="Size"/> is its size
/// category, which the stand suggestion of the import checks (CN-28).
/// </summary>
public sealed record AircraftTypeCandidate(Guid Id, string IcaoCode, string Manufacturer, string Model,
    AircraftSizeCategory? Size = null);

/// <summary>
/// Suggests the aircraft type of a flight from the model the provider reported («Boeing 737-800»), so OCC
/// types it once (2-B). The text is compared without spaces, hyphens or case against each type's
/// «manufacturer model», its model and its ICAO designator; the longest match wins. A tie or no match
/// suggests nothing: OCC always confirms the type before importing.
/// </summary>
public static partial class AircraftModelMatcher
{
    private const int MinimumToken = 3;

    /// <summary>Words after the family's number that keep the text generic: «Airbus A320 family», «Boeing 737 series».</summary>
    private static readonly HashSet<string> FamilyWords = new(StringComparer.Ordinal) { "FAMILY", "FAMILIA", "SERIES", "SERIE" };

    public static Guid? Suggest(string? providerModel, IReadOnlyCollection<AircraftTypeCandidate> types)
    {
        ArgumentNullException.ThrowIfNull(types);
        var model = Normalize(providerModel);
        // «Airbus A320 family» names a family, not its A320 (CN-28).
        if (model.Length < MinimumToken || NamesFamily(providerModel)) return null;
        var best = 0;
        Guid? suggestion = null;
        var tied = false;
        foreach (var type in types)
        {
            var score = new[] { Normalize(type.Manufacturer + type.Model), Normalize(type.Model), Normalize(type.IcaoCode) }
                .Where(token => token.Length >= MinimumToken && model.Contains(token, StringComparison.Ordinal))
                .Select(token => token.Length).DefaultIfEmpty(0).Max();
            if (score == 0) continue;
            if (score > best)
            {
                (best, suggestion, tied) = (score, type.Id, false);
            }
            else if (score == best && suggestion != type.Id)
            {
                tied = true;
            }
        }
        return tied ? null : suggestion;
    }

    /// <summary>
    /// The catalog types a generic model text names (CN-28): «Boeing 737» is every type whose model starts with 737
    /// (737-800, 737 MAX 8), «Airbus A320 family» the A318, A319, A320 and A321 with their neo. The text is generic when
    /// nothing but a family word follows the family's number («A320», «737», «E190»): «Boeing 737-800» names a variant
    /// and is no family. When the text names a manufacturer of the catalog, only that manufacturer's types count. Empty
    /// for any other text.
    /// </summary>
    public static IReadOnlyList<Guid> Family(string? providerModel, IReadOnlyCollection<AircraftTypeCandidate> types)
    {
        ArgumentNullException.ThrowIfNull(types);
        var text = (providerModel ?? string.Empty).ToUpperInvariant();
        var match = FamilyNumber().Match(text);
        if (!match.Success) return [];
        var rest = Normalize(text[(match.Index + match.Length)..]);
        var family = rest.Length > 0;
        if (family && !FamilyWords.Contains(rest)) return [];
        var token = match.Groups[1].Value + match.Groups[2].Value;
        string[] prefixes = family && token == "A320" ? ["A318", "A319", "A32"] : [token];
        var named = Normalize(text[..match.Index]);
        var manufacturers = types.Select(type => Normalize(type.Manufacturer))
            .Where(name => name.Length >= MinimumToken && named.Contains(name, StringComparison.Ordinal))
            .ToHashSet(StringComparer.Ordinal);
        return types.Where(type => manufacturers.Count == 0 || manufacturers.Contains(Normalize(type.Manufacturer)))
            .Where(type =>
            {
                var model = Normalize(type.Model);
                var manufacturer = Normalize(type.Manufacturer);
                if (manufacturer.Length > 0 && model.StartsWith(manufacturer, StringComparison.Ordinal))
                    model = model[manufacturer.Length..];
                return prefixes.Any(prefix => model.StartsWith(prefix, StringComparison.Ordinal));
            })
            .Select(type => type.Id).Distinct().ToArray();
    }

    /// <summary>Whether the text is a family's number followed by a family word: «Airbus A320 family», «737 series».</summary>
    public static bool NamesFamily(string? providerModel)
    {
        var text = (providerModel ?? string.Empty).ToUpperInvariant();
        var match = FamilyNumber().Match(text);
        return match.Success && FamilyWords.Contains(Normalize(text[(match.Index + match.Length)..]));
    }

    internal static string Normalize(string? value) =>
        value is null ? string.Empty : string.Concat(value.Where(char.IsLetterOrDigit)).ToUpperInvariant();

    /// <summary>A family's number: an optional letter and three digits, not inside a longer code («A320», «737», «E190»).</summary>
    [GeneratedRegex("(?<![A-Z0-9])([A-Z]?)([0-9]{3})(?![0-9])")]
    private static partial Regex FamilyNumber();
}

/// <summary>Where the suggested aircraft type of a proposed flight comes from (CN-28).</summary>
public static class AircraftTypeSuggestionSources
{
    /// <summary>The live aircraft of the air picture that is this flight broadcasts the type's ICAO designator.</summary>
    public const string Live = "Live";

    /// <summary>The provider's model text names the type (<see cref="AircraftModelMatcher.Suggest"/>).</summary>
    public const string ProviderModel = "ProviderModel";

    /// <summary>The provider's text is generic and the airline operated one type of that family most at the station.</summary>
    public const string History = "History";
}

/// <summary>The suggested aircraft type and its source (<see cref="AircraftTypeSuggestionSources"/>).</summary>
public sealed record AircraftTypeSuggestion(Guid TypeId, string Source);

/// <summary>
/// The aircraft type OCC finds preselected when it imports a proposed flight (CN-28), in this order:
/// <list type="number">
/// <item>«en vuelo»: the live aircraft that is this flight broadcasts an ICAO type designator that is exactly one active
/// type's.</item>
/// <item>«modelo del proveedor»: the provider's model text names one type (<see cref="AircraftModelMatcher.Suggest"/>).</item>
/// <item>«historial»: the text is generic (<see cref="AircraftModelMatcher.Family"/>) and, among the types of that family,
/// one carries at least <see cref="HistoryMinimumShare"/> of the airline's flights at the station in the recent history,
/// with at least <see cref="HistoryMinimumFlights"/> flights.</item>
/// </list>
/// Nothing otherwise. Pure; nothing is imported automatically: OCC confirms or changes the type.
/// </summary>
public static class AircraftTypeSuggester
{
    /// <summary>The fewest flights of the family the history needs to suggest a type.</summary>
    public const int HistoryMinimumFlights = 3;

    /// <summary>The share of the family's flights the most frequent type needs.</summary>
    public const double HistoryMinimumShare = 0.6;

    /// <summary>How far back the history is read, in days.</summary>
    public const int HistoryDays = 90;

    /// <param name="liveTypeIcao">The ICAO type the live aircraft of this flight broadcasts, when one matched.</param>
    /// <param name="providerModel">The provider's model text.</param>
    /// <param name="types">The active aircraft types.</param>
    /// <param name="history">The airline's flights at the station by type, in the recent history.</param>
    public static AircraftTypeSuggestion? Suggest(string? liveTypeIcao, string? providerModel,
        IReadOnlyCollection<AircraftTypeCandidate> types, IReadOnlyDictionary<Guid, int>? history)
    {
        ArgumentNullException.ThrowIfNull(types);
        var live = AircraftModelMatcher.Normalize(liveTypeIcao);
        if (live.Length > 0)
        {
            var matches = types.Where(type => AircraftModelMatcher.Normalize(type.IcaoCode) == live)
                .Select(type => type.Id).Distinct().ToArray();
            if (matches.Length == 1) return new AircraftTypeSuggestion(matches[0], AircraftTypeSuggestionSources.Live);
        }
        if (AircraftModelMatcher.Suggest(providerModel, types) is { } named)
            return new AircraftTypeSuggestion(named, AircraftTypeSuggestionSources.ProviderModel);
        if (history is null || history.Count == 0) return null;
        var family = AircraftModelMatcher.Family(providerModel, types);
        if (family.Count == 0) return null;
        var flown = family.Select(id => (Id: id, Flights: history.TryGetValue(id, out var count) ? count : 0))
            .Where(item => item.Flights > 0).OrderByDescending(item => item.Flights).ThenBy(item => item.Id).ToArray();
        var total = flown.Sum(item => item.Flights);
        if (total < HistoryMinimumFlights) return null;
        var top = flown[0];
        return top.Flights >= HistoryMinimumShare * total
            ? new AircraftTypeSuggestion(top.Id, AircraftTypeSuggestionSources.History)
            : null;
    }
}
