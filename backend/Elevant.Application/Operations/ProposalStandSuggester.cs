using System.Text.RegularExpressions;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations;

/// <summary>Where the suggested stand of a proposed arrival comes from (CN-28).</summary>
public static class StandSuggestionSources
{
    /// <summary>«puerta del aeropuerto»: the gate the provider announced is a stand of the station, free for the flight.</summary>
    public const string Gate = "Gate";

    /// <summary>«sugerida»: a free stand of the announced terminal that fits the aircraft.</summary>
    public const string Free = "Free";
}

/// <summary>An active stand of an active terminal of the station.</summary>
public sealed record StandOption(long Id, Guid PublicId, string Code, string? TerminalCode, AircraftSizeCategory? MaxAircraftSize);

/// <summary>
/// A stand another flight holds, with the planned window of that flight; a missing bound means it holds the stand at any
/// time (it fails closed, as <c>StandAvailability.Occupying</c>).
/// </summary>
public sealed record HeldStand(long StandId, string Code, AircraftSizeCategory? AircraftSize, DateTimeOffset? StartsAt,
    DateTimeOffset? EndsAt);

/// <summary>An arrival to place: its key, the gate and terminal the provider announced, its aircraft size and its window.</summary>
public sealed record StandRequest(string Key, string? Gate, string? Terminal, AircraftSizeCategory? AircraftSize,
    DateTimeOffset StartsAt, DateTimeOffset EndsAt);

/// <summary>The suggested stand and its source (<see cref="StandSuggestionSources"/>).</summary>
public sealed record StandSuggestion(Guid StandId, string Source);

/// <summary>
/// The stand OCC finds preselected when it imports a proposed arrival (CN-28). Pure; nothing is assigned until OCC
/// imports, and the import checks the stand again.
/// <list type="number">
/// <item>«puerta del aeropuerto»: the announced gate names a stand of the station by its normalized code
/// (<see cref="StandCodes.Normalize"/>, ADR-0041): «B20» and «B020» are B20, and a bare number with the terminal's letter
/// («20» in terminal B) is tried as B20 first and as «20» after. Only when that stand is free for the flight.</item>
/// <item>«sugerida»: otherwise a stand of the announced terminal (any stand when none was announced; none when the
/// terminal is not one of the station's) that is free for the flight's window: no other flight holds it, the
/// combined-stand rules allow it (<see cref="StandConstraintPolicy"/>, ADR-0030) and its size fits the aircraft. The one
/// whose size limit matches the aircraft's comes first, so a narrow-body does not take a wide-body stand, then the
/// natural order of the codes (A2 before A10).</item>
/// </list>
/// The arrivals are placed in the order of their windows, and each suggestion holds its stand for the arrivals after it,
/// so two overlapping arrivals are never suggested the same stand.
/// </summary>
public static partial class ProposalStandSuggester
{
    public static IReadOnlyDictionary<string, StandSuggestion> Suggest(IReadOnlyList<StandOption> stands,
        IReadOnlyList<HeldStand> held, IReadOnlyList<StandRule> rules, IReadOnlyList<StandRequest> requests)
    {
        ArgumentNullException.ThrowIfNull(stands);
        ArgumentNullException.ThrowIfNull(held);
        ArgumentNullException.ThrowIfNull(rules);
        ArgumentNullException.ThrowIfNull(requests);
        var result = new Dictionary<string, StandSuggestion>(StringComparer.Ordinal);
        if (stands.Count == 0) return result;
        var byCode = stands.GroupBy(stand => StandCodes.Normalize(stand.Code), StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.OrderBy(stand => stand.Id).First(), StringComparer.Ordinal);
        var ordered = stands.OrderBy(stand => stand, NaturalOrder.Instance).ToArray();
        var holding = held.ToList();
        foreach (var request in requests.OrderBy(item => item.StartsAt).ThenBy(item => item.Key, StringComparer.Ordinal))
        {
            if (result.ContainsKey(request.Key)) continue;
            var occupied = holding.Where(item => Overlaps(item, request))
                .Select(item => new OccupiedStand(item.StandId, item.Code, item.AircraftSize)).ToArray();
            bool Fits(StandOption stand) =>
                occupied.All(item => item.StandId != stand.Id) &&
                StandConstraintPolicy.Evaluate(new StandPlacement(stand.Id, stand.Code, stand.MaxAircraftSize,
                    request.AircraftSize), occupied, rules).Count == 0;

            StandSuggestion? suggestion = null;
            StandOption? chosen = GateCodes(request.Gate, request.Terminal)
                .Select(code => byCode.GetValueOrDefault(code)).FirstOrDefault(stand => stand is not null);
            if (chosen is not null && Fits(chosen))
            {
                suggestion = new StandSuggestion(chosen.PublicId, StandSuggestionSources.Gate);
            }
            else
            {
                var terminal = TerminalCode(request.Terminal);
                var pool = terminal is null
                    ? ordered
                    : ordered.Where(stand => TerminalCode(stand.TerminalCode) == terminal).ToArray();
                chosen = pool.Where(Fits)
                    .OrderBy(stand => request.AircraftSize is { } size && stand.MaxAircraftSize == size ? 0 : 1)
                    .FirstOrDefault();
                if (chosen is not null) suggestion = new StandSuggestion(chosen.PublicId, StandSuggestionSources.Free);
            }
            if (suggestion is null || chosen is null) continue;
            result[request.Key] = suggestion;
            holding.Add(new HeldStand(chosen.Id, chosen.Code, request.AircraftSize, request.StartsAt, request.EndsAt));
        }
        return result;
    }

    /// <summary>
    /// The stand codes a gate may name, most specific first: a bare number («20», «9A») with the terminal's letters is
    /// the terminal's stand («B20») first and the bare code after; any other gate is its own normalized code.
    /// </summary>
    public static IReadOnlyList<string> GateCodes(string? gate, string? terminal)
    {
        var code = StandCodes.Normalize(gate);
        if (code.Length == 0) return [];
        var letters = TerminalCode(terminal);
        if (letters is not null && letters.All(char.IsAsciiLetterUpper) && BareNumber().IsMatch(code))
            return [StandCodes.Normalize(letters + code), code];
        return [code];
    }

    /// <summary>A terminal as the provider or the station writes it: «B», «Terminal B» and «t-b» are B; null when blank.</summary>
    public static string? TerminalCode(string? terminal)
    {
        var text = AircraftModelMatcher.Normalize(terminal);
        if (text.StartsWith("TERMINAL", StringComparison.Ordinal)) text = text["TERMINAL".Length..];
        return text.Length == 0 ? null : text;
    }

    private static bool Overlaps(HeldStand held, StandRequest request) =>
        held.StartsAt is not { } start || held.EndsAt is not { } end ||
        (start < request.EndsAt && request.StartsAt < end);

    [GeneratedRegex("^[0-9]+[A-Z]?$")]
    private static partial Regex BareNumber();

    /// <summary>Stand codes in natural order: letters, then the number as a number, then the rest («A2» before «A10»).</summary>
    private sealed partial class NaturalOrder : IComparer<StandOption>
    {
        public static NaturalOrder Instance { get; } = new();

        public int Compare(StandOption? left, StandOption? right)
        {
            if (ReferenceEquals(left, right)) return 0;
            if (left is null) return -1;
            if (right is null) return 1;
            var (leftPrefix, leftNumber, leftRest) = Parts(StandCodes.Normalize(left.Code));
            var (rightPrefix, rightNumber, rightRest) = Parts(StandCodes.Normalize(right.Code));
            var order = string.CompareOrdinal(leftPrefix, rightPrefix);
            if (order == 0) order = leftNumber.CompareTo(rightNumber);
            if (order == 0) order = string.CompareOrdinal(leftRest, rightRest);
            return order != 0 ? order : left.Id.CompareTo(right.Id);
        }

        private static (string Prefix, long Number, string Suffix) Parts(string code)
        {
            var match = Shape().Match(code);
            return match.Success && long.TryParse(match.Groups[2].Value, out var number)
                ? (match.Groups[1].Value, number, match.Groups[3].Value)
                : (code, -1, string.Empty);
        }

        [GeneratedRegex("^([A-Z]*)([0-9]{1,9})(.*)$")]
        private static partial Regex Shape();
    }
}
