namespace Elevant.Infrastructure.Persistence.Seed;

// Research leads for the historical AVIAM list; only Verified entries have IATA identity evidence.
internal static class AviamAirlineReference
{
    // AVIAM's client list is historical. These links are research leads, not proof
    // that an operator still trades under the listed name.
    public const string AviamClients = "https://www.aviamltd.com/nosotros/";
    public static readonly IReadOnlyDictionary<string, (string? Country, string? Site)> Research = new Dictionary<string, (string? Country, string? Site)>(StringComparer.Ordinal)
    {
        ["AIR BERLIN"] = ("DE", "https://www.airberlin.com/"),
        ["AIR CARAIBES"] = ("FR", "https://www.aircaraibes.com/"),
        ["AIR EUROPA"] = ("ES", "https://www.aireuropa.com/"),
        ["AIR FRANCE"] = ("FR", "https://www.airfrance.com/"),
        ["ARKEFLY"] = ("NL", "https://www.tui.nl/vliegtickets/"),
        ["AZUR AIR"] = ("RU", "https://www.azurair.com/"),
        ["BRITISH AIRWAYS"] = ("GB", "https://www.britishairways.com/"),
        ["CONDOR"] = ("DE", null),
        ["EDELWEISS AIR"] = ("CH", null),
        ["EUROWINGS"] = ("DE", null),
        ["EVELOP AIRLINES"] = ("ES", null),
        ["I-FLY AIRLINES"] = ("RU", "https://www.iflyltd.ru/"),
        ["IKAR AIRLINES"] = ("RU", null),
        ["LEVEL-IBERIA"] = ("ES", "https://www.flylevel.com/"),
        ["NORWIND AIRLINES"] = ("RU", null),
        ["ORBES PORTUGAL"] = ("PT", null),
        ["ORENAIR"] = ("RU", "https://www.aviamltd.com/nosotros/"),
        ["ROSSIYA AIRLINES"] = ("RU", "https://www.rossiya-airlines.com/en/"),
        ["THOMAS COOK"] = ("GB", null),
        ["THOMAS COOK SCANDINAVIA"] = ("DK", null),
        ["THOMSON AIRWAYS"] = ("GB", null),
        ["TRAVEL SERVICE POLSKA"] = ("PL", null),
        ["TUIFLY BELGIUM"] = ("BE", "https://www.tuifly.be/en"),
        ["TUIFLY NETHERLANDS"] = ("NL", "https://en.tuifly.com/"),
        ["VIM AIRLINES"] = ("RU", null),
        ["XL AIRWAYS FRANCE"] = ("FR", null),
        ["WAMOS AIR"] = ("ES", "https://www.wamosair.com/es"),
        ["AMERICAN AIRLINES"] = ("US", "https://www.aa.com/"),
        ["AIR CANADA"] = ("CA", "https://www.aircanada.com/"),
        ["AIR CANADA ROUGE"] = ("CA", "https://flyrouge.com/"),
        ["AIR TRANSAT"] = ("CA", "https://www.airtransat.com/"),
        ["ALLEGIANT AIR"] = ("US", "https://www.allegiantair.com/"),
        ["DELTA AIRLINES"] = ("US", "https://www.delta.com/"),
        ["FRONTIER AIRLINES"] = ("US", "https://www.flyfrontier.com/"),
        ["JETBLUE"] = ("US", "https://www.jetblue.com/"),
        ["NORWEGIAN AIR"] = ("NO", "https://www.norwegian.com/"),
        ["SOUTHWEST AIRLINES"] = ("US", "https://www.southwest.com/"),
        ["SUNCOUNTRY"] = ("US", "https://www.suncountry.com/"),
        ["SUNWING AIRLINES"] = ("CA", "https://www.flysunwing.com/"),
        ["SWIFT AIR"] = ("US", "https://www.swiftair.com/"),
        ["UNITED AIRLINES"] = ("US", "https://www.united.com/"),
        ["XTRA AIRWAYS"] = ("US", "https://xtraairways.com/"),
        ["WEST JET AIRLINES"] = ("CA", "https://www.westjet.com/"),
        ["AEROLINEAS ARGENTINAS"] = ("AR", "https://www.aerolineas.com.ar/"),
        ["AVIANCA"] = ("CO", "https://www.avianca.com/"),
        ["COPA AIRLINES"] = ("PA", "https://www.copaair.com/"),
        ["GOL"] = ("BR", "https://www.voegol.com.br/"),
        ["LATIN AMERICAN WINGS"] = ("CL", "https://www.vuelalaw.com/cl/"),
        ["TAM AIRLINES"] = ("BR", "https://www.latam.com/"),
        ["LANPERU"] = ("PE", "https://www.latam.com/"),
        ["WINGO"] = ("CO", "https://www.wingo.com/"),
    };
    public static readonly IReadOnlyDictionary<string, (string Legal, string Iata, string Icao, string Source)> Verified = new Dictionary<string, (string Legal, string Iata, string Icao, string Source)>(StringComparer.Ordinal)
    {
        ["AIR FRANCE"] = ("Société Air France", "AF", "AFR", "https://www.iata.org/en/about/members/airline-list/air-france/7/"),
        ["BRITISH AIRWAYS"] = ("British Airways Plc", "BA", "BAW", "https://www.iata.org/en/about/members/airline-list/british-airways/52/"),
        ["AMERICAN AIRLINES"] = ("American Airlines, Inc.", "AA", "AAL", "https://www.iata.org/en/about/members/airline-list/american-airlines/22/"),
        ["AIR CANADA"] = ("Air Canada", "AC", "ACA", "https://www.iata.org/en/about/members/airline-list/air-canada/21/"),
        ["AEROLINEAS ARGENTINAS"] = ("Aerolineas Argentinas S.A.", "AR", "ARG", "https://www.iata.org/en/about/members/airline-list/aerolineas-argentinas/13/"),
        ["AVIANCA"] = ("Aerovías del Continente Americano, S.A. AVIANCA", "AV", "AVA", "https://www.iata.org/en/about/members/airline-list/avianca/6/"),
    };
    // Official-site icons are checked into both web clients. A named AVIAM reference
    // tile is used when the historical brand has no retrievable official icon.
    // Neither kind of image verifies legal identity or current operation.
    private static readonly IReadOnlyDictionary<string, string> OfficialLogoPaths = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["AIR CARAIBES"] = "/assets/airlines/air-caraibes.png",
        ["AIR EUROPA"] = "/assets/airlines/air-europa.png",
        ["ARKEFLY"] = "/assets/airlines/arkefly.png",
        ["BRITISH AIRWAYS"] = "/assets/airlines/british-airways.png",
        ["I-FLY AIRLINES"] = "/assets/airlines/i-fly-airlines.png",
        ["LEVEL-IBERIA"] = "/assets/airlines/level-iberia.png",
        ["ROSSIYA AIRLINES"] = "/assets/airlines/rossiya-airlines.png",
        ["TUIFLY BELGIUM"] = "/assets/airlines/tuifly-belgium.png",
        ["AMERICAN AIRLINES"] = "/assets/airlines/american-airlines.png",
        ["AIR CANADA"] = "/assets/airlines/air-canada.png",
        ["AIR TRANSAT"] = "/assets/airlines/air-transat.png",
        ["DELTA AIRLINES"] = "/assets/airlines/delta-airlines.png",
        ["FRONTIER AIRLINES"] = "/assets/airlines/frontier-airlines.png",
        ["JETBLUE"] = "/assets/airlines/jetblue.png",
        ["NORWEGIAN AIR"] = "/assets/airlines/norwegian-air.png",
        ["SOUTHWEST AIRLINES"] = "/assets/airlines/southwest-airlines.png",
        ["SUNCOUNTRY"] = "/assets/airlines/suncountry.png",
        ["UNITED AIRLINES"] = "/assets/airlines/united-airlines.png",
        ["WEST JET AIRLINES"] = "/assets/airlines/west-jet-airlines.png",
        ["AEROLINEAS ARGENTINAS"] = "/assets/airlines/aerolineas-argentinas.png",
        ["AVIANCA"] = "/assets/airlines/avianca.png",
        ["WINGO"] = "/assets/airlines/wingo.png",
    };
    public static readonly IReadOnlyDictionary<string, string> LogoPaths = Research.Keys.ToDictionary(
        name => name,
        name => OfficialLogoPaths.GetValueOrDefault(name) ??
            $"/assets/airlines/reference-{name.ToLowerInvariant().Replace(' ', '-')}.svg",
        StringComparer.Ordinal);
    public static readonly IReadOnlySet<string> Archived = new HashSet<string>(StringComparer.Ordinal)
    {
        "AIR BERLIN", "THOMAS COOK", "TAM AIRLINES", "LANPERU",
    };
}
