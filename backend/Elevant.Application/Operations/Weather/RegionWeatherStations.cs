namespace Elevant.Application.Operations.Weather;

/// <summary>
/// An airport of a weather region: its ICAO code (four letters in upper case), its IATA code (null when it has none), its
/// name and where it is, in decimal degrees.
/// </summary>
public sealed record RegionWeatherStation(string IcaoCode, string? IataCode, string Name, double Latitude, double Longitude);

/// <summary>
/// The weather regions of the OCC (plan M6 of 27 November 2026): the airports whose METAR and TAF the regional read
/// (<c>occ/weather/region</c>) brings, around the airport of a station. Punta Cana (MDPC) has the only one: the 32
/// airports within 300 NM that the maps draw in Región, MDPC included, nearest first, as
/// <c>frontend/private-web/src/features/maps/airport/data/region.context.json</c> lists them (OurAirports, public
/// domain). Public reference data, the same in every environment, so it lives here and not in the settings;
/// <c>RegionWeatherCatalogParityTests</c> keeps the two lists equal.
/// </summary>
public static class RegionWeatherStations
{
    /// <summary>The airport whose region <see cref="AroundPuntaCana"/> is.</summary>
    public const string PuntaCanaIcao = "MDPC";

    /// <summary>The 32 airports within 300 NM of Punta Cana, nearest first.</summary>
    public static IReadOnlyList<RegionWeatherStation> AroundPuntaCana { get; } =
    [
        new("MDPC", "PUJ", "Punta Cana International Airport", 18.567093, -68.364558),
        new("MDLR", "LRM", "Casa De Campo International Airport", 18.452222, -68.911111),
        new("TJBQ", "BQN", "Rafael Hernández International Airport", 18.4949, -67.129402),
        new("TJMZ", "MAZ", "Eugenio Maria De Hostos Airport", 18.255699, -67.148499),
        new("MDSD", "SDQ", "Las Américas International Airport", 18.429701, -69.6689),
        new("MDSI", null, "San Isidro Air Base", 18.5037, -69.761703),
        new("MDCY", "AZS", "Samaná El Catey International Airport", 19.269259, -69.737405),
        new("MDJB", "JBQ", "La Isabela International Airport", 18.5725, -69.985603),
        new("TJAB", "ARE", "Antonio Nery Juarbe Pol Airport", 18.45085, -66.675768),
        new("TJPS", "PSE", "Mercedita International Airport", 18.008301, -66.563004),
        new("TJIG", "SIG", "Fernando Luis Ribas Dominicci Airport", 18.4568, -66.098099),
        new("TJSJ", "SJU", "Luis Munoz Marin International Airport", 18.4394, -66.001801),
        new("MDST", "STI", "Cibao International Airport", 19.40406, -70.604431),
        new("MDPP", "POP", "Gregorio Luperon International Airport", 19.7579, -70.57),
        new("TJRV", "NRR", "José Aponte de la Torre Airport", 18.247262, -65.63979),
        new("MDBH", "BRX", "Maria Montez International Airport", 18.251499, -71.120399),
        new("TJVQ", "VQS", "Antonio Rivera Rodriguez Airport", 18.1348, -65.493599),
        new("TJCP", "CPX", "Benjamin Rivera Noriega Airport", 18.312954, -65.303893),
        new("MDCR", "CBJ", "Cabo Rojo Airport", 17.929001, -71.644798),
        new("TIST", "STT", "Cyril E. King Airport", 18.337091, -64.977251),
        new("TISX", "STX", "Henry E. Rohlsen Airport", 17.701413, -64.802608),
        new("TUPJ", "EIS", "Terrance B. Lettsome International Airport", 18.445492, -64.541707),
        new("MTPP", "PAP", "Toussaint Louverture International Airport", 18.580023, -72.292596),
        new("TUPW", "VIJ", "Virgin Gorda Airport", 18.446634, -64.427932),
        new("MTCH", "CAP", "Cap Haitien International Airport", 19.725547, -72.20071),
        new("MBGT", "GDT", "JAGS McCartney International Airport", 21.4445, -71.142303),
        new("MTJA", "JAK", "Jacmel Airport", 18.2411, -72.518501),
        new("MBSC", "XSC", "South Caicos Airport", 21.515699, -71.528503),
        new("MTPX", "PAX", "Port-de-Paix Airport", 19.934045, -72.84801),
        new("MBNC", "NCA", "North Caicos Airport", 21.916094, -71.942954),
        new("MBPV", "PLS", "Providenciales International Airport", 21.773697, -72.268321),
        new("TNCS", "SAB", "Juancho E. Yrausquin Airport", 17.64533, -63.220514),
    ];

    /// <summary>
    /// The airports of the region around the airport whose ICAO code is <paramref name="icaoCode"/> (exactly as the
    /// station's airport store gives it: trimmed and in upper case); null when that airport has no region.
    /// </summary>
    public static IReadOnlyList<RegionWeatherStation>? Around(string? icaoCode) =>
        string.Equals(icaoCode, PuntaCanaIcao, StringComparison.Ordinal) ? AroundPuntaCana : null;
}
