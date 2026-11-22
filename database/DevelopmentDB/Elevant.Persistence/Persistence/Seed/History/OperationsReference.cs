using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Enumerations;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Infrastructure.Persistence.Seed.History;

/// <summary>
/// The reference rows the operations chunks fly with: real origin airports and a few more aircraft types. Each one is
/// inserted only when neither its IATA nor its ICAO code exists (a row created by the app or the base seed is reused
/// as it is), with a deterministic public id, so the first weekly chunk adds them and the later ones find them.
/// </summary>
internal static class OperationsReference
{
    public sealed record AirportSeed(string Iata, string Icao, string Name, string City, string Country, string Zone,
        decimal Latitude, decimal Longitude);

    public sealed record AircraftSeed(string Icao, string Iata, string Manufacturer, string Model,
        AircraftSizeCategory Size);

    public static readonly IReadOnlyList<AirportSeed> Airports =
    [
        new("JFK", "KJFK", "John F. Kennedy International Airport", "Nueva York", "US", "America/New_York", 40.641311m, -73.778139m),
        new("ATL", "KATL", "Hartsfield-Jackson Atlanta International Airport", "Atlanta", "US", "America/New_York", 33.640411m, -84.419853m),
        new("BOS", "KBOS", "Boston Logan International Airport", "Boston", "US", "America/New_York", 42.365613m, -71.009560m),
        new("EWR", "KEWR", "Newark Liberty International Airport", "Newark", "US", "America/New_York", 40.689531m, -74.174462m),
        new("CLT", "KCLT", "Charlotte Douglas International Airport", "Charlotte", "US", "America/New_York", 35.214001m, -80.943100m),
        new("PHL", "KPHL", "Philadelphia International Airport", "Filadelfia", "US", "America/New_York", 39.871899m, -75.241096m),
        new("IAD", "KIAD", "Washington Dulles International Airport", "Washington", "US", "America/New_York", 38.944500m, -77.455803m),
        new("ORD", "KORD", "Chicago O'Hare International Airport", "Chicago", "US", "America/Chicago", 41.978600m, -87.904800m),
        new("MSP", "KMSP", "Minneapolis-Saint Paul International Airport", "Minneapolis", "US", "America/Chicago", 44.881956m, -93.221767m),
        new("YYZ", "CYYZ", "Toronto Pearson International Airport", "Toronto", "CA", "America/Toronto", 43.677717m, -79.624819m),
        new("YUL", "CYUL", "Montréal-Trudeau International Airport", "Montreal", "CA", "America/Toronto", 45.465843m, -73.745576m),
        new("MAD", "LEMD", "Adolfo Suárez Madrid-Barajas Airport", "Madrid", "ES", "Europe/Madrid", 40.498299m, -3.567600m),
        new("CDG", "LFPG", "Paris Charles de Gaulle Airport", "París", "FR", "Europe/Paris", 49.009722m, 2.547778m),
        new("FRA", "EDDF", "Frankfurt Airport", "Fráncfort", "DE", "Europe/Berlin", 50.037933m, 8.562152m),
        new("ZRH", "LSZH", "Zurich Airport", "Zúrich", "CH", "Europe/Zurich", 47.458056m, 8.548056m),
        new("PTY", "MPTO", "Tocumen International Airport", "Panamá", "PA", "America/Panama", 9.071356m, -79.383453m),
        new("BOG", "SKBO", "El Dorado International Airport", "Bogotá", "CO", "America/Bogota", 4.701594m, -74.146947m),
    ];

    public static readonly IReadOnlyList<AircraftSeed> AircraftTypes =
    [
        new("B738", "738", "Boeing", "737-800", AircraftSizeCategory.Narrowbody),
        new("B38M", "7M8", "Boeing", "737 MAX 8", AircraftSizeCategory.Narrowbody),
        new("A321", "321", "Airbus", "A321-200", AircraftSizeCategory.Narrowbody),
        new("A332", "332", "Airbus", "A330-200", AircraftSizeCategory.Widebody),
        new("B763", "763", "Boeing", "767-300ER", AircraftSizeCategory.Widebody),
        new("B789", "789", "Boeing", "787-9", AircraftSizeCategory.Widebody),
    ];

    /// <summary>An active aircraft type the history can use.</summary>
    public sealed record Aircraft(long Id, string IcaoCode, AircraftSizeCategory Size);

    public sealed record Loaded(IReadOnlyDictionary<string, long> AirportsByIata, IReadOnlyList<Aircraft> Aircraft);

    /// <summary>Inserts what is missing and returns the airports by IATA code and the active typed aircraft.</summary>
    public static async Task<Loaded> EnsureAsync(HistoryChunkContext chunk, CancellationToken cancellationToken)
    {
        var db = chunk.Db;
        var at = chunk.Clock.At(chunk.Options.WindowStart.AddDays(-1), new TimeOnly(9, 0));
        var iatas = Airports.Select(item => item.Iata).ToArray();
        var icaos = Airports.Select(item => item.Icao).ToArray();
        var existing = await db.Airports.AsNoTracking()
            .Where(item => iatas.Contains(item.IataCode) || icaos.Contains(item.IcaoCode))
            .Select(item => new { item.IataCode, item.IcaoCode }).ToArrayAsync(cancellationToken);
        var taken = existing.SelectMany(item => new[] { item.IataCode.Trim(), item.IcaoCode.Trim() })
            .ToHashSet(StringComparer.Ordinal);
        var airports = Airports.Where(item => !taken.Contains(item.Iata) && !taken.Contains(item.Icao))
            .Select(item => HistoryChunkContext.Stamp(new Airport
            {
                IataCode = item.Iata, IcaoCode = item.Icao, Name = item.Name, City = item.City,
                CountryCode = item.Country, IanaTimeZone = item.Zone, Latitude = item.Latitude, Longitude = item.Longitude,
            }, $"ops:airport:{item.Iata}", at)).ToArray();

        var typeCodes = AircraftTypes.Select(item => item.Icao).ToArray();
        var existingTypes = (await db.AircraftTypes.AsNoTracking().Where(item => typeCodes.Contains(item.IcaoCode))
                .Select(item => item.IcaoCode).ToArrayAsync(cancellationToken))
            .Select(code => code.Trim()).ToHashSet(StringComparer.Ordinal);
        var types = AircraftTypes.Where(item => !existingTypes.Contains(item.Icao))
            .Select(item => HistoryChunkContext.Stamp(new AircraftType
            {
                IcaoCode = item.Icao, IataCode = item.Iata, Manufacturer = item.Manufacturer, Model = item.Model,
                IsActive = true, SizeCategory = item.Size,
            }, $"ops:aircraft-type:{item.Icao}", at)).ToArray();
        await chunk.InsertAsync(airports.Cast<object>().Concat(types), cancellationToken);

        var allIatas = iatas.Append(chunk.Anchors.Puj.IataCode).Append(chunk.Anchors.Mia.IataCode).ToArray();
        var byIata = (await db.Airports.AsNoTracking().Where(item => allIatas.Contains(item.IataCode))
                .Select(item => new { item.IataCode, item.Id }).ToArrayAsync(cancellationToken))
            .ToDictionary(item => item.IataCode.Trim(), item => item.Id, StringComparer.Ordinal);
        var aircraft = (await db.AircraftTypes.AsNoTracking().Where(item => item.IsActive && item.SizeCategory != null)
                .OrderBy(item => item.IcaoCode)
                .Select(item => new { item.Id, item.IcaoCode, item.SizeCategory }).ToArrayAsync(cancellationToken))
            .Select(item => new Aircraft(item.Id, item.IcaoCode.Trim(), item.SizeCategory!.Value)).ToArray();
        // Types without a size (legacy rows, or ones created in OCC without it) are not flown: ground time and charges
        // depend on the size. The types above are inserted with one, so this only fails if all of them pre-exist unsized.
        if (aircraft.Length == 0)
            throw new InvalidOperationException(
                "The Development history needs at least one active aircraft type with a size category.");
        return new Loaded(byIata, aircraft);
    }
}
