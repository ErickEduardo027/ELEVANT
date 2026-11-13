using System.Globalization;

namespace Elevant.Application.Operations.DemoStation;

/// <summary>A terminal the station already has, as the plan reads it.</summary>
public sealed record ExistingTerminal(long Id, string Code, bool IsActive);

/// <summary>
/// A stand the station already has, as the plan reads it. <paramref name="TerminalId"/> is null for a stand without a
/// terminal; <paramref name="Placed"/> says OCC placed it on the map (its latitude is set).
/// </summary>
public sealed record ExistingStand(long Id, string Code, long? TerminalId, bool IsActive, bool Placed);

/// <summary>
/// A station against the Punta Cana catalogue (ADR-0041), as the card «Posiciones de Punta Cana» reads it.
/// <paramref name="Terminals"/>: the catalogue's terminals the station has active, out of
/// <paramref name="CatalogTerminals"/>. <paramref name="Stands"/>: the catalogue's stands it has as an active stand of an
/// active terminal, out of <paramref name="CatalogStands"/>; the others are <paramref name="MissingStands"/>, spelt and
/// ordered as the catalogue has them. <paramref name="ActiveStands"/>: every active stand of an active terminal, of which
/// <paramref name="LocatedStands"/> are located (<see cref="PuntaCanaStationLayout.IsLocated"/>) and
/// <paramref name="UnmatchedStands"/>, with the code they have, are not the catalogue's stand: a code outside it, or a
/// second stand with a code the catalogue already matched. <paramref name="Complete"/>: the catalogue's terminals are
/// active and no stand is missing; stands outside the catalogue never count against it.
/// </summary>
public sealed record DemoStationLayoutState(int CatalogTerminals, int Terminals, int CatalogStands, int Stands,
    int ActiveStands, int LocatedStands, IReadOnlyList<string> MissingStands, IReadOnlyList<string> UnmatchedStands,
    bool Complete);

/// <summary>
/// What «Cargar posiciones de Punta Cana» does at a station (ADR-0041, contracts 1.2). It only creates: the catalogue's
/// terminals and stands the station lacks, active, without coordinates. An existing row is never changed, reactivated,
/// deactivated or deleted, so running the plan over its own result creates nothing.
/// <list type="bullet">
/// <item>A terminal is the station's terminal with the same code in capitals. When it is inactive it is not created
/// again, and the stands of it that the station lacks stay missing.</item>
/// <item>A stand is any stand of the station, in any terminal, whose code <see cref="StandCodes.Normalize"/> makes the
/// catalogue's: «A01» is the catalogue's «A1». An active one is adopted as it is (<see cref="Adopted"/>); of two, the
/// one of an active terminal comes first, then the one with the lowest id, and the other one is unmatched. An inactive
/// one is neither created again nor reactivated: the stand stays missing.</item>
/// </list>
/// <see cref="TerminalIds"/>: by the catalogue's code, the existing active terminal where that terminal's stands to
/// create go; the others go to the terminals the plan creates. <see cref="State"/>: the station once the plan is applied.
/// </summary>
public sealed record DemoStationPlan(IReadOnlyList<DemoLayoutTerminal> TerminalsToCreate,
    IReadOnlyList<DemoLayoutStand> StandsToCreate, IReadOnlyDictionary<string, long> Adopted,
    IReadOnlyDictionary<string, long> TerminalIds, DemoStationLayoutState State)
{
    /// <summary>The plan for a station that has <paramref name="terminals"/> and <paramref name="stands"/>.</summary>
    public static DemoStationPlan For(IReadOnlyCollection<ExistingTerminal> terminals,
        IReadOnlyCollection<ExistingStand> stands)
    {
        ArgumentNullException.ThrowIfNull(terminals);
        ArgumentNullException.ThrowIfNull(stands);
        var terminalIds = new Dictionary<string, long>(StringComparer.Ordinal);
        var terminalsToCreate = new List<DemoLayoutTerminal>();
        foreach (var terminal in PuntaCanaStationLayout.Terminals)
        {
            if (TerminalOf(terminals, terminal.Code) is not { } existing) terminalsToCreate.Add(terminal);
            else if (existing.IsActive) terminalIds[terminal.Code] = existing.Id;
        }
        // A code the station has, in any notation and in any state, is never created again: an active stand is adopted
        // as it is, an inactive one stays as OCC left it (a second row would also break the unique code of the station).
        var known = stands.Select(stand => StandCodes.Normalize(stand.Code)).ToHashSet(StringComparer.Ordinal);
        var open = terminalIds.Keys.Concat(terminalsToCreate.Select(terminal => terminal.Code))
            .ToHashSet(StringComparer.Ordinal);
        var standsToCreate = PuntaCanaStationLayout.Stands
            .Where(stand => !known.Contains(stand.Code) && open.Contains(stand.TerminalCode)).ToArray();
        var adopted = Adopt(stands, ActiveTerminalIds(terminals))
            .ToDictionary(pair => pair.Key, pair => pair.Value.Id, StringComparer.Ordinal);

        // The station once the plan is applied: the new rows are active and unplaced, each stand in its terminal.
        var terminalsAfter = terminals.ToList();
        var targets = new Dictionary<string, long>(terminalIds, StringComparer.Ordinal);
        var nextTerminalId = terminals.Select(terminal => terminal.Id).DefaultIfEmpty(0).Max();
        foreach (var terminal in terminalsToCreate)
        {
            terminalsAfter.Add(new ExistingTerminal(++nextTerminalId, terminal.Code, true));
            targets[terminal.Code] = nextTerminalId;
        }
        var standsAfter = stands.ToList();
        var nextStandId = stands.Select(stand => stand.Id).DefaultIfEmpty(0).Max();
        foreach (var stand in standsToCreate)
            standsAfter.Add(new ExistingStand(++nextStandId, stand.Code, targets[stand.TerminalCode], true, false));

        return new DemoStationPlan(terminalsToCreate, standsToCreate, adopted, terminalIds,
            Describe(terminalsAfter, standsAfter));
    }

    /// <summary>
    /// The state of a station that has <paramref name="terminals"/> and <paramref name="stands"/>, read with the rules of
    /// <see cref="For"/>: what the card and the demo flight options show before anything is loaded.
    /// </summary>
    public static DemoStationLayoutState Describe(IReadOnlyCollection<ExistingTerminal> terminals,
        IReadOnlyCollection<ExistingStand> stands)
    {
        ArgumentNullException.ThrowIfNull(terminals);
        ArgumentNullException.ThrowIfNull(stands);
        var activeTerminals = ActiveTerminalIds(terminals);
        var usable = stands.Where(stand => Usable(stand, activeTerminals)).ToArray();
        var adopted = Adopt(stands, activeTerminals).Values.Select(stand => stand.Id).ToHashSet();
        var present = usable.Select(stand => PuntaCanaStationLayout.Find(stand.Code)?.Code).OfType<string>()
            .ToHashSet(StringComparer.Ordinal);
        var missing = PuntaCanaStationLayout.Stands.Where(stand => !present.Contains(stand.Code))
            .Select(stand => stand.Code).ToArray();
        var unmatched = usable.Where(stand => !adopted.Contains(stand.Id))
            .OrderBy(stand => NaturalKey(stand.Code).Prefix, StringComparer.Ordinal)
            .ThenBy(stand => NaturalKey(stand.Code).Number)
            .ThenBy(stand => NaturalKey(stand.Code).Suffix, StringComparer.Ordinal)
            .ThenBy(stand => stand.Code, StringComparer.Ordinal).ThenBy(stand => stand.Id)
            .Select(stand => stand.Code).ToArray();
        var located = usable.Count(stand =>
            PuntaCanaStationLayout.IsLocated(PuntaCanaStationLayout.StationCode, stand.Code, stand.Placed));
        var activeCatalogueTerminals = PuntaCanaStationLayout.Terminals
            .Count(terminal => TerminalOf(terminals, terminal.Code) is { IsActive: true });
        return new DemoStationLayoutState(PuntaCanaStationLayout.Terminals.Count, activeCatalogueTerminals,
            PuntaCanaStationLayout.Stands.Count, PuntaCanaStationLayout.Stands.Count - missing.Length, usable.Length,
            located, missing, unmatched,
            activeCatalogueTerminals == PuntaCanaStationLayout.Terminals.Count && missing.Length == 0);
    }

    /// <summary>
    /// The station's terminal with a catalogue terminal's code, in capitals as the master data keeps codes: the active
    /// one before an inactive one, then the lowest id.
    /// </summary>
    private static ExistingTerminal? TerminalOf(IReadOnlyCollection<ExistingTerminal> terminals, string code) =>
        terminals.Where(terminal => string.Equals(terminal.Code.Trim().ToUpperInvariant(), code, StringComparison.Ordinal))
            .OrderByDescending(terminal => terminal.IsActive).ThenBy(terminal => terminal.Id).FirstOrDefault();

    /// <summary>
    /// The existing stand that is the catalogue's stand, by the catalogue's code: among the active stands with that
    /// normalized code, one of an active terminal before one that cannot be used, then the lowest id.
    /// </summary>
    private static Dictionary<string, ExistingStand> Adopt(IReadOnlyCollection<ExistingStand> stands,
        HashSet<long> activeTerminals) =>
        stands.Where(stand => stand.IsActive)
            .Select(stand => (Catalogue: PuntaCanaStationLayout.Find(stand.Code), Stand: stand))
            .Where(item => item.Catalogue is not null)
            .GroupBy(item => item.Catalogue!.Code, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.Select(item => item.Stand)
                .OrderByDescending(stand => Usable(stand, activeTerminals)).ThenBy(stand => stand.Id).First(),
                StringComparer.Ordinal);

    private static HashSet<long> ActiveTerminalIds(IReadOnlyCollection<ExistingTerminal> terminals) =>
        terminals.Where(terminal => terminal.IsActive).Select(terminal => terminal.Id).ToHashSet();

    /// <summary>An active stand of an active terminal: what OCC can assign and the demo flight can be sent to.</summary>
    private static bool Usable(ExistingStand stand, HashSet<long> activeTerminals) =>
        stand.IsActive && stand.TerminalId is { } terminalId && activeTerminals.Contains(terminalId);

    /// <summary>«B2» before «B10»: the letters, the number and what follows of the normalized code.</summary>
    private static (string Prefix, int Number, string Suffix) NaturalKey(string code)
    {
        var text = StandCodes.Normalize(code);
        var start = 0;
        while (start < text.Length && !char.IsAsciiDigit(text[start])) start++;
        var end = start;
        while (end < text.Length && char.IsAsciiDigit(text[end])) end++;
        return (text[..start],
            int.TryParse(text.AsSpan(start, end - start), NumberStyles.None, CultureInfo.InvariantCulture, out var number)
                ? number
                : int.MaxValue,
            text[end..]);
    }
}
