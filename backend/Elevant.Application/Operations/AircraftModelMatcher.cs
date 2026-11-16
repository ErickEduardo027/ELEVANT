namespace Elevant.Application.Operations;

/// <summary>An active aircraft type the provider's model text can be matched against.</summary>
public sealed record AircraftTypeCandidate(Guid Id, string IcaoCode, string Manufacturer, string Model);

/// <summary>
/// Suggests the aircraft type of a flight from the model the provider reported («Boeing 737-800»), so OCC
/// types it once (2-B). The text is compared without spaces, hyphens or case against each type's
/// «manufacturer model», its model and its ICAO designator; the longest match wins. A tie or no match
/// suggests nothing: OCC always confirms the type before importing.
/// </summary>
public static class AircraftModelMatcher
{
    private const int MinimumToken = 3;

    public static Guid? Suggest(string? providerModel, IReadOnlyCollection<AircraftTypeCandidate> types)
    {
        ArgumentNullException.ThrowIfNull(types);
        var model = Normalize(providerModel);
        if (model.Length < MinimumToken) return null;
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

    private static string Normalize(string? value) =>
        value is null ? string.Empty : string.Concat(value.Where(char.IsLetterOrDigit)).ToUpperInvariant();
}
