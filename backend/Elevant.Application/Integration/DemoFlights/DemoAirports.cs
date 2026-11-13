using Elevant.Application.Abstractions.Integrations;
using Elevant.Application.Operations;

namespace Elevant.Application.Integration.DemoFlights;

/// <summary>
/// The airports a demo flight can come from or leave to (ADR-0041), with their public reference data. A database that
/// does not know one yet takes its row from here, so the import finds the counterpart airport and the map has the
/// coordinates to draw the route, without asking any provider. The simulated flight feed (2-B) rotates over the same
/// list in this order: adding, removing or reordering an airport changes the counterparts of its timetable.
/// </summary>
public static class DemoAirports
{
    public static IReadOnlyList<FeedAirport> All { get; } =
    [
        new("MIA", "KMIA", "Miami International Airport", "Miami", "US", "America/New_York", 25.7959m, -80.2870m),
        new("JFK", "KJFK", "John F. Kennedy International Airport", "New York", "US", "America/New_York", 40.6413m, -73.7781m),
        new("YYZ", "CYYZ", "Toronto Pearson International Airport", "Toronto", "CA", "America/Toronto", 43.6777m, -79.6248m),
        new("MAD", "LEMD", "Adolfo Suárez Madrid-Barajas Airport", "Madrid", "ES", "Europe/Madrid", 40.4983m, -3.5676m),
        new("BOG", "SKBO", "El Dorado International Airport", "Bogotá", "CO", "America/Bogota", 4.7016m, -74.1469m),
        new("SDQ", "MDSD", "Las Américas International Airport", "Santo Domingo", "DO", "America/Santo_Domingo", 18.4297m, -69.6689m),
    ];

    /// <summary>The airport with that IATA code, in any case; null when the catalogue does not have it.</summary>
    public static FeedAirport? Find(string? iata)
    {
        var code = FlightIdentity.NormalizeIata(iata);
        return All.FirstOrDefault(airport => airport.IataCode == code);
    }
}
