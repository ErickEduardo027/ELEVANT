using Elevant.Application.Operations;
using Elevant.Application.Operations.DemoStation;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

/// <summary>
/// ADR-0041, contracts 1.2: the terminals and stands of Punta Cana that «Cargar posiciones de Punta Cana» creates, with
/// the attributes of the owner's table. B33 is not among them: the 2026 AIP amendment retired it.
/// </summary>
public sealed class PuntaCanaStationLayoutTests
{
    private static IEnumerable<string> Codes(string prefix, int first, int last) =>
        Enumerable.Range(first, last - first + 1).Select(number => $"{prefix}{number}");

    [Fact]
    public void HasThreeTerminalsAndFortyOneStandsWithoutB33()
    {
        Assert.Equal("PUJ", PuntaCanaStationLayout.StationCode);
        Assert.Equal(["A", "B", "FBO"], PuntaCanaStationLayout.Terminals.Select(terminal => terminal.Code));
        Assert.Equal(41, PuntaCanaStationLayout.Stands.Count);
        // In natural order, as the owner's coordinate document lists them.
        Assert.Equal(
            [
                "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10", "A11",
                "AN1", "AN2", "AN3", "AN4", "AN5",
                "B20", "B21", "B22", "B23", "B24", "B25", "B26", "B27", "B28", "B29", "B30", "B31", "B32",
                "B34", "B35", "B36", "B37",
                "BN6", "BN7", "BN8", "BN9", "BN10", "BN11", "BN12", "BN13",
            ],
            PuntaCanaStationLayout.Stands.Select(stand => stand.Code));
        Assert.DoesNotContain(PuntaCanaStationLayout.Stands, stand => StandCodes.Normalize(stand.Code) == "B33");
    }

    [Fact]
    public void EveryStandBelongsToACatalogueTerminalAndNormalizedCodesAreUnique()
    {
        var terminals = PuntaCanaStationLayout.Terminals.Select(terminal => terminal.Code).ToHashSet(StringComparer.Ordinal);

        Assert.Equal(3, terminals.Count);
        Assert.All(PuntaCanaStationLayout.Stands, stand =>
        {
            Assert.Contains(stand.TerminalCode, terminals);
            // The catalogue spells each code the way the rule compares it: «A1», never «A01».
            Assert.Equal(StandCodes.Normalize(stand.Code), stand.Code);
        });
        Assert.Equal(41,
            PuntaCanaStationLayout.Stands.Select(stand => StandCodes.Normalize(stand.Code)).Distinct(StringComparer.Ordinal)
                .Count());
        // A sixteen, B seventeen and the FBO eight.
        Assert.Equal([("A", 16), ("B", 17), ("FBO", 8)],
            PuntaCanaStationLayout.Terminals.Select(terminal =>
                (terminal.Code, PuntaCanaStationLayout.Stands.Count(stand => stand.TerminalCode == terminal.Code))));
    }

    [Fact]
    public void TheAttributesFollowTheOwnersTable()
    {
        (IEnumerable<string> Codes, string Terminal, bool Bridge, bool Remote, AircraftSizeCategory? Size)[] table =
        [
            (Codes("A", 1, 11), "A", false, false, null),
            (Codes("AN", 1, 5), "A", false, true, null),
            (Codes("B", 20, 26), "B", true, false, null),
            (Codes("B", 27, 31), "B", false, false, null),
            (["B32", "B34", "B35", "B36", "B37"], "B", false, true, null),
            (Codes("BN", 6, 13), "FBO", false, true, AircraftSizeCategory.Narrowbody),
        ];

        Assert.Equal(
            table.SelectMany(row => row.Codes.Select(code =>
                new DemoLayoutStand(code, row.Terminal, row.Bridge, row.Remote, row.Size))),
            PuntaCanaStationLayout.Stands);
        // The master data writes remote stands as «Remote» and the others as «Contact».
        Assert.Equal(23, PuntaCanaStationLayout.Stands.Count(stand => stand.StandType == "Contact"));
        Assert.Equal(18, PuntaCanaStationLayout.Stands.Count(stand => stand.StandType == "Remote"));
        Assert.Equal("Contact", PuntaCanaStationLayout.Find("B20")?.StandType);
        Assert.Equal("Remote", PuntaCanaStationLayout.Find("AN1")?.StandType);
        Assert.Equal("Remote", PuntaCanaStationLayout.Find("BN13")?.StandType);
    }

    [Fact]
    public void TheFboTerminalIsFboAviacionLocal()
    {
        // The names the web's map shows for each terminal (positionsMapMappers.js), never «Aviación general».
        DemoLayoutTerminal[] expected =
            [new("A", "Terminal A"), new("B", "Terminal B"), new("FBO", "FBO / Aviación local")];
        Assert.Equal(expected, PuntaCanaStationLayout.Terminals);
    }

    [Fact]
    public void EveryCodeAndNameIsValidMasterData()
    {
        Assert.All(PuntaCanaStationLayout.Terminals, terminal =>
        {
            Assert.Equal(terminal.Code, MasterDataRules.TerminalCode(terminal.Code));
            Assert.Equal(terminal.Name, MasterDataRules.Name(terminal.Name, 120));
        });
        Assert.All(PuntaCanaStationLayout.Stands, stand => Assert.Equal(stand.Code, MasterDataRules.StandCode(stand.Code)));
    }

    [Fact]
    public void ContainsComparesTheNormalizedCode()
    {
        foreach (var code in new[] { "A1", "A01", "a-1", " a 01 ", "AN05", "b.020", "bn-06", "BN13" })
            Assert.True(PuntaCanaStationLayout.Contains(code), code);
        // B33 is retired, the seed's B01 is the stand «B1», and nothing is inferred from a bare number or a suffix.
        foreach (var code in new[] { "B33", "B01", "B1", "1", "9A", "A1A", "AN6", "BN5", "FBO", "", " " })
            Assert.False(PuntaCanaStationLayout.Contains(code), code);
        Assert.False(PuntaCanaStationLayout.Contains(null));

        Assert.Same(PuntaCanaStationLayout.Stands[0], PuntaCanaStationLayout.Find("A01"));
        Assert.Equal(new DemoLayoutStand("BN6", "FBO", false, true, AircraftSizeCategory.Narrowbody),
            PuntaCanaStationLayout.Find(" bn-06 "));
        Assert.Null(PuntaCanaStationLayout.Find("B01"));
    }

    [Fact]
    public void AStandIsLocatedWhenOccPlacedItOrPuntaCanasCatalogueHasItsCode()
    {
        Assert.True(PuntaCanaStationLayout.IsLocated("PUJ", "A01", placed: false));
        Assert.True(PuntaCanaStationLayout.IsLocated("puj", "bn-6", placed: false));
        Assert.True(PuntaCanaStationLayout.IsLocated("PUJ", "B01", placed: true));
        Assert.False(PuntaCanaStationLayout.IsLocated("PUJ", "B01", placed: false));
        Assert.False(PuntaCanaStationLayout.IsLocated("PUJ", "B33", placed: false));
        // The web's map data is Punta Cana's: another station's stand is located only where OCC placed it.
        Assert.False(PuntaCanaStationLayout.IsLocated("SDQ", "A1", placed: false));
        Assert.True(PuntaCanaStationLayout.IsLocated("SDQ", "A1", placed: true));
        Assert.False(PuntaCanaStationLayout.IsLocated(null, "A1", placed: false));
    }

    [Fact]
    public void OnlyPuntaCanaHasTheCatalogueWhateverTheCaseOfItsCode()
    {
        Assert.True(PuntaCanaStationLayout.IsStation("PUJ"));
        Assert.True(PuntaCanaStationLayout.IsStation(" puj "));
        Assert.False(PuntaCanaStationLayout.IsStation("SDQ"));
        Assert.False(PuntaCanaStationLayout.IsStation("PUJ1"));
        Assert.False(PuntaCanaStationLayout.IsStation(""));
        Assert.False(PuntaCanaStationLayout.IsStation(null));
    }
}
