using System.Text.Json;
using Elevant.Application.Operations.Weather;

namespace Elevant.ArchitectureTests.Architecture;

/// <summary>
/// Plan M6: the airports whose METAR and TAF the regional read brings (<see cref="RegionWeatherStations"/>) are the ones
/// the maps draw in Región, <c>airports</c> of <c>frontend/private-web/src/features/maps/airport/data/region.context.json</c>
/// (OurAirports, public domain): the same airports in the same order, with their ICAO and IATA codes, their names and
/// their positions (<c>p</c> is longitude, latitude). Only Backend CI runs this test: a change to the map's file alone
/// runs only Web clients CI, and this test catches it on the next backend change.
/// </summary>
public sealed class RegionWeatherCatalogParityTests
{
    private const string RegionContext = "frontend/private-web/src/features/maps/airport/data/region.context.json";

    [Fact]
    public void TheRegionOfPuntaCanaIsTheOneTheMapsDraw()
    {
        using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(FindRepositoryRoot(),
            RegionContext.Replace('/', Path.DirectorySeparatorChar))));
        var drawn = document.RootElement.GetProperty("airports").EnumerateArray().Select(airport =>
        {
            var position = airport.GetProperty("p");
            var iata = airport.GetProperty("iata");
            return new RegionWeatherStation(airport.GetProperty("icao").GetString()!,
                iata.ValueKind == JsonValueKind.Null ? null : iata.GetString(), airport.GetProperty("name").GetString()!,
                position[1].GetDouble(), position[0].GetDouble());
        }).ToArray();

        Assert.Equal(drawn, RegionWeatherStations.AroundPuntaCana);
        Assert.Equal(RegionWeatherStations.PuntaCanaIcao, drawn[0].IcaoCode);
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
}
