using System.Globalization;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations.DemoStation;

/// <summary>A terminal of the Punta Cana layout (ADR-0041): its code and the name OCC reads.</summary>
public sealed record DemoLayoutTerminal(string Code, string Name);

/// <summary>
/// A stand of the Punta Cana layout (ADR-0041) with the attributes the owner chose for it (decision 21): its terminal,
/// whether it has a boarding bridge, whether it is remote and the largest aircraft it admits (null admits any size).
/// They are provisional: once the stand exists they belong to OCC, who edits them in «Cobertura → Configuración».
/// </summary>
public sealed record DemoLayoutStand(string Code, string TerminalCode, bool HasBoardingBridge, bool IsRemote,
    AircraftSizeCategory? MaxAircraftSize)
{
    /// <summary>The stand type OCC's master data writes for these flags.</summary>
    public string StandType => IsRemote ? "Remote" : "Contact";
}

/// <summary>
/// The terminals and stands of Punta Cana that «Cargar posiciones de Punta Cana» creates (ADR-0041, owner decision 7):
/// the 41 stands of the owner's coordinate document, without B33, which the 2026 AIP amendment retired. The catalogue
/// holds no coordinates: the geometry lives in the web's map data, matched by the normalized code, and the database
/// only keeps a location OCC placed (ADR-0027). Its codes and terminals are the rows of
/// <c>frontend/private-web/src/features/dashboard/positionsData.js</c> that are not retired; a parity test compares them.
/// </summary>
public static class PuntaCanaStationLayout
{
    /// <summary>The only station with a catalogue.</summary>
    public const string StationCode = "PUJ";

    public static IReadOnlyList<DemoLayoutTerminal> Terminals { get; } =
    [
        new("A", "Terminal A"),
        new("B", "Terminal B"),
        new("FBO", "FBO / Aviación local"),
    ];

    /// <summary>The stands in natural order (A1, A2 … A10), each with the attributes of the owner's table.</summary>
    public static IReadOnlyList<DemoLayoutStand> Stands { get; } =
    [
        .. Range("A", 1, 11, "A", bridge: false, remote: false, null),
        .. Range("AN", 1, 5, "A", bridge: false, remote: true, null),
        .. Range("B", 20, 26, "B", bridge: true, remote: false, null),
        .. Range("B", 27, 31, "B", bridge: false, remote: false, null),
        .. Range("B", 32, 32, "B", bridge: false, remote: true, null),
        // No B33: the 2026 AIP amendment retired it.
        .. Range("B", 34, 37, "B", bridge: false, remote: true, null),
        .. Range("BN", 6, 13, "FBO", bridge: false, remote: true, AircraftSizeCategory.Narrowbody),
    ];

    private static readonly Dictionary<string, DemoLayoutStand> ByCode =
        Stands.ToDictionary(stand => StandCodes.Normalize(stand.Code), StringComparer.Ordinal);

    /// <summary>
    /// True for the station the catalogue belongs to, by its code in any case and without surrounding spaces: only
    /// Punta Cana loads it, and only there does a catalogue code locate a stand.
    /// </summary>
    public static bool IsStation(string? stationCode) =>
        string.Equals(stationCode?.Trim(), StationCode, StringComparison.OrdinalIgnoreCase);

    /// <summary>True when the stand with that code, in any notation («A01», «a-1»), is in the catalogue.</summary>
    public static bool Contains(string? code) => Find(code) is not null;

    /// <summary>The catalogue's stand with that code, compared by <see cref="StandCodes.Normalize"/>; null otherwise.</summary>
    public static DemoLayoutStand? Find(string? code) => ByCode.GetValueOrDefault(StandCodes.Normalize(code));

    /// <summary>
    /// Whether the map knows where a stand is (ADR-0041): OCC placed it (its latitude is set), or it is a stand of Punta
    /// Cana whose code is in the catalogue, which the web's map data draws by that code. The catalogue never locates a
    /// stand of another station.
    /// </summary>
    public static bool IsLocated(string? stationCode, string? standCode, bool placed) =>
        placed || (IsStation(stationCode) && Contains(standCode));

    private static IEnumerable<DemoLayoutStand> Range(string prefix, int first, int last, string terminal, bool bridge,
        bool remote, AircraftSizeCategory? size) =>
        Enumerable.Range(first, last - first + 1).Select(number =>
            new DemoLayoutStand(string.Create(CultureInfo.InvariantCulture, $"{prefix}{number}"), terminal, bridge,
                remote, size));
}
