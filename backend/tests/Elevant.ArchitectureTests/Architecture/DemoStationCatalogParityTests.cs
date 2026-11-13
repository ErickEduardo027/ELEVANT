using System.Text.RegularExpressions;
using Elevant.Application.Operations;
using Elevant.Application.Operations.DemoStation;

namespace Elevant.ArchitectureTests.Architecture;

/// <summary>
/// ADR-0041, contracts 1.2: the Punta Cana stands the API creates and the reference stands the web's maps draw are one
/// list. The map's rows are <c>RAMP_POSITIONS</c> in <c>frontend/private-web/src/features/dashboard/positionsData.js</c>,
/// matched by the normalized code; a row marked <c>retired: true</c> stays there as history and is not in the catalogue,
/// and no map draws it from the reference (<c>dashboardPositions.js</c> and the mappers in
/// <c>positions-map/positionsMapMappers.js</c> skip it; the maps that read the positions board draw a stand with that
/// code that OCC placed, where OCC put it). Only Backend CI runs this test: <c>dashboardPositions.test.js</c> pins the
/// same list for a change to private-web alone, which runs only Web clients CI.
/// </summary>
public sealed partial class DemoStationCatalogParityTests
{
    private const string PositionsData = "frontend/private-web/src/features/dashboard/positionsData.js";

    private sealed record WebPosition(string Id, string Terminal, bool Retired);

    [Fact]
    public void TheCatalogueMatchesTheRowsTheWebMapDoesNotRetire()
    {
        var drawn = ReadPositions().Where(position => !position.Retired).ToArray();

        Assert.Equal(
            Keys(PuntaCanaStationLayout.Stands.Select(stand => (stand.Code, stand.TerminalCode))),
            Keys(drawn.Select(position => (position.Id, position.Terminal))));
        // One row per stand, and the map's terminals are the catalogue's.
        Assert.Equal(drawn.Length,
            drawn.Select(position => StandCodes.Normalize(position.Id)).Distinct(StringComparer.Ordinal).Count());
        Assert.Equal(
            PuntaCanaStationLayout.Terminals.Select(terminal => terminal.Code).Order(StringComparer.Ordinal),
            drawn.Select(position => position.Terminal).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal));
    }

    [Fact]
    public void OnlyB33IsRetiredInTheWebPositions()
    {
        var positions = ReadPositions();

        Assert.Equal(["B33"], positions.Where(position => position.Retired).Select(position => position.Id));
        Assert.False(PuntaCanaStationLayout.Contains("B33"));
    }

    /// <summary>«Terminal:code» with the normalized code, sorted, so a difference reads as the stand that differs.</summary>
    private static string[] Keys(IEnumerable<(string Code, string Terminal)> stands) =>
        stands.Select(stand => $"{stand.Terminal}:{StandCodes.Normalize(stand.Code)}").Order(StringComparer.Ordinal)
            .ToArray();

    private static WebPosition[] ReadPositions()
    {
        var source = File.ReadAllText(Path.Combine(FindRepositoryRoot(),
            PositionsData.Replace('/', Path.DirectorySeparatorChar)));
        var array = RampPositions().Match(source);
        Assert.True(array.Success, $"{PositionsData} no longer declares RAMP_POSITIONS as an array literal.");
        var positions = Row().Matches(array.Groups["rows"].Value)
            .Select(row => new WebPosition(row.Groups["id"].Value, row.Groups["terminal"].Value,
                Retired().IsMatch(row.Groups["rest"].Value)))
            .ToArray();
        Assert.NotEmpty(positions);
        return positions;
    }

    private static string FindRepositoryRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null)
        {
            if (File.Exists(Path.Combine(directory.FullName, "Directory.Build.props")) &&
                File.Exists(Path.Combine(directory.FullName, "backend", "Elevant.sln")))
            {
                return directory.FullName;
            }

            directory = directory.Parent;
        }

        throw new DirectoryNotFoundException(
            "Could not find the repository root containing backend/Elevant.sln.");
    }

    [GeneratedRegex(@"export\s+const\s+RAMP_POSITIONS\s*=\s*\[(?<rows>.*?)\r?\n\];", RegexOptions.Singleline)]
    private static partial Regex RampPositions();

    [GeneratedRegex(@"\{\s*id:\s*'(?<id>[^']+)',\s*terminal:\s*'(?<terminal>[^']+)'(?<rest>[^{}]*)\}")]
    private static partial Regex Row();

    [GeneratedRegex(@"(?:^|[\s,])retired:\s*true\b")]
    private static partial Regex Retired();
}
