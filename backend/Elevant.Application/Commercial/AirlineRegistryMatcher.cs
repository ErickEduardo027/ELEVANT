using System.Globalization;
using System.Text;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Commercial;

/// <summary>
/// Decides whether a registry knows an airline (ADR-0023). Codes decide the candidates; the name
/// is compared without accents, punctuation or generic words («Airlines», «S.A.», «Líneas Aéreas»…)
/// so «Copa» matches «Copa Airlines» but not «Air Century».
/// </summary>
public static class AirlineRegistryMatcher
{
    private static readonly HashSet<string> GenericWords = new(StringComparer.Ordinal)
    {
        "airline", "airlines", "airway", "airways", "aerolinea", "aerolineas", "linea", "lineas", "aerea",
        "aereas", "aereo", "aereos", "air", "aviation", "aviacion", "transportes", "transporte", "compania",
        "company", "co", "corp", "corporation", "group", "grupo", "sa", "srl", "sas", "inc", "ltd", "llc",
        "de", "del", "la", "las", "el", "los", "the", "and", "y",
    };

    public static AirlineRegistryCheck Evaluate(string name, string? iataCode, string? icaoCode,
        IReadOnlyList<AirlineRegistryCandidate> candidates, string source, DateTimeOffset checkedAt)
    {
        var iata = Code(iataCode);
        var icao = Code(icaoCode);
        if (iata is null && icao is null)
            return Result(AirlineRegistryStatus.NotFound, source, null, ["La aerolínea no tiene código IATA ni ICAO para consultar."], checkedAt);

        bool HasIata(AirlineRegistryCandidate candidate) => iata is null || candidate.IataCodes.Contains(iata, StringComparer.Ordinal);
        bool HasIcao(AirlineRegistryCandidate candidate) => icao is null || candidate.IcaoCodes.Contains(icao, StringComparer.Ordinal);
        var both = candidates.Where(candidate => HasIata(candidate) && HasIcao(candidate)).ToArray();

        var found = both.FirstOrDefault(candidate => candidate.Active && SameName(name, candidate.Name));
        if (found is not null) return Result(AirlineRegistryStatus.Found, source, found, [], checkedAt);

        var activeOther = both.FirstOrDefault(candidate => candidate.Active);
        if (activeOther is not null)
            return Result(AirlineRegistryStatus.Mismatch, source, activeOther,
                [$"Con esos códigos el registro muestra «{activeOther.Name}», no «{name.Trim()}»."], checkedAt);

        var defunct = both.FirstOrDefault(candidate => SameName(name, candidate.Name)) ?? both.FirstOrDefault();
        if (defunct is not null)
            return Result(AirlineRegistryStatus.Defunct, source, defunct,
                [$"«{defunct.Name}» figura como aerolínea que ya no opera."], checkedAt);

        // Only one of the codes is known: report what the registry says about each one.
        var differences = new List<string>();
        var byIata = iata is null ? null : candidates.FirstOrDefault(candidate => candidate.Active && candidate.IataCodes.Contains(iata, StringComparer.Ordinal));
        var byIcao = icao is null ? null : candidates.FirstOrDefault(candidate => candidate.Active && candidate.IcaoCodes.Contains(icao, StringComparer.Ordinal));
        if (byIata is not null)
            differences.Add($"El IATA {iata} corresponde a «{byIata.Name}» (ICAO {Join(byIata.IcaoCodes)}).");
        if (byIcao is not null && byIcao != byIata)
            differences.Add($"El ICAO {icao} corresponde a «{byIcao.Name}» (IATA {Join(byIcao.IataCodes)}).");
        if (differences.Count > 0)
            return Result(AirlineRegistryStatus.Mismatch, source, byIata ?? byIcao, differences, checkedAt);

        return Result(AirlineRegistryStatus.NotFound, source, null,
            [$"Ninguna aerolínea del registro usa {Describe(iata, icao)}."], checkedAt);
    }

    /// <summary>True when the meaningful words of both names overlap (half of the shorter one or more).</summary>
    public static bool SameName(string left, string right)
    {
        var a = Words(left);
        var b = Words(right);
        if (a.Count == 0 || b.Count == 0) return false;
        var shared = a.Intersect(b, StringComparer.Ordinal).Count();
        return shared * 2 >= Math.Min(a.Count, b.Count) && shared > 0;
    }

    private static HashSet<string> Words(string value)
    {
        var plain = new StringBuilder();
        foreach (var character in value.Normalize(NormalizationForm.FormD))
        {
            if (CharUnicodeInfo.GetUnicodeCategory(character) == UnicodeCategory.NonSpacingMark) continue;
            plain.Append(char.IsLetterOrDigit(character) ? char.ToLowerInvariant(character) : ' ');
        }
        var all = plain.ToString().Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var meaningful = all.Where(word => !GenericWords.Contains(word)).ToHashSet(StringComparer.Ordinal);
        // A name made only of generic words («Air Lines») is compared as written.
        return meaningful.Count > 0 ? meaningful : all.ToHashSet(StringComparer.Ordinal);
    }

    private static string? Code(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim().ToUpperInvariant();

    private static string Join(IReadOnlyList<string> codes) => codes.Count == 0 ? "sin dato" : string.Join("/", codes);

    private static string Describe(string? iata, string? icao) =>
        (iata, icao) switch
        {
            ({ } a, { } b) => $"el IATA {a} ni el ICAO {b}",
            ({ } a, null) => $"el IATA {a}",
            _ => $"el ICAO {icao}",
        };

    private static AirlineRegistryCheck Result(AirlineRegistryStatus status, string source,
        AirlineRegistryCandidate? match, IReadOnlyList<string> differences, DateTimeOffset checkedAt) =>
        new(status.ToString(), source, match?.Name, match?.IataCodes.FirstOrDefault(), match?.IcaoCodes.FirstOrDefault(),
            match?.Country, match?.EntityUrl, differences, checkedAt);
}

/// <summary>
/// Asks the registries in order (Wikidata, then the offline OpenFlights copy) and keeps the first
/// answer that finds the airline; otherwise the most informative answer. Unavailable only when no
/// registry could answer.
/// </summary>
public sealed class AirlineRegistryLookup(IEnumerable<IAirlineRegistrySource> sources, TimeProvider timeProvider)
    : IAirlineRegistryLookup
{
    private static readonly string[] Preference =
        [nameof(AirlineRegistryStatus.Found), nameof(AirlineRegistryStatus.Mismatch),
            nameof(AirlineRegistryStatus.Defunct), nameof(AirlineRegistryStatus.NotFound)];

    public async Task<AirlineRegistryCheck> CheckAsync(string name, string? iataCode, string? icaoCode,
        CancellationToken cancellationToken = default)
    {
        var answers = new List<AirlineRegistryCheck>();
        foreach (var source in sources)
        {
            var candidates = await source.FindAsync(iataCode, icaoCode, cancellationToken);
            if (candidates is null) continue;
            var check = AirlineRegistryMatcher.Evaluate(name, iataCode, icaoCode, candidates, source.Name,
                timeProvider.GetUtcNow());
            if (check.Status == nameof(AirlineRegistryStatus.Found)) return check;
            answers.Add(check);
        }
        return answers.OrderBy(answer => Array.IndexOf(Preference, answer.Status)).FirstOrDefault()
            ?? new AirlineRegistryCheck(AirlineRegistryCheck.Unavailable, null, null, null, null, null, null,
                ["Ningún registro público respondió. Inténtalo más tarde."], timeProvider.GetUtcNow());
    }
}
