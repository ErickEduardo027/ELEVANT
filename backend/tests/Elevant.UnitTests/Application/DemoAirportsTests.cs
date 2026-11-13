using Elevant.Application.Abstractions.Integrations;
using Elevant.Application.Integration.DemoFlights;
using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Integrations.SimulatedFlightFeed;

namespace Elevant.UnitTests.Application;

/// <summary>
/// ADR-0041: the airports a demo flight can come from or leave to. They become <c>ref.airports</c> rows when the
/// database does not know them yet, and they are the counterparts of the simulated flight feed (2-B).
/// </summary>
public sealed class DemoAirportsTests
{
    private static readonly FeedAirport Miami =
        new("MIA", "KMIA", "Miami International Airport", "Miami", "US", "America/New_York", 25.7959m, -80.2870m);
    private static readonly FeedAirport NewYork =
        new("JFK", "KJFK", "John F. Kennedy International Airport", "New York", "US", "America/New_York", 40.6413m, -73.7781m);
    private static readonly FeedAirport Toronto =
        new("YYZ", "CYYZ", "Toronto Pearson International Airport", "Toronto", "CA", "America/Toronto", 43.6777m, -79.6248m);
    private static readonly FeedAirport Madrid =
        new("MAD", "LEMD", "Adolfo Suárez Madrid-Barajas Airport", "Madrid", "ES", "Europe/Madrid", 40.4983m, -3.5676m);
    private static readonly FeedAirport Bogota =
        new("BOG", "SKBO", "El Dorado International Airport", "Bogotá", "CO", "America/Bogota", 4.7016m, -74.1469m);
    private static readonly FeedAirport SantoDomingo =
        new("SDQ", "MDSD", "Las Américas International Airport", "Santo Domingo", "DO", "America/Santo_Domingo", 18.4297m, -69.6689m);

    [Fact]
    public void EveryAirportHasValidCodesZoneAndCoordinates()
    {
        Assert.Equal(6, DemoAirports.All.Count);
        Assert.All(DemoAirports.All, airport =>
        {
            // What a row of ref.airports needs, written as the master-data rules store it.
            Assert.Equal(Assert.IsType<string>(airport.IataCode), MasterDataRules.StationCode(airport.IataCode));
            Assert.Equal(Assert.IsType<string>(airport.IcaoCode), MasterDataRules.AirportIcao(airport.IcaoCode));
            Assert.Equal(Assert.IsType<string>(airport.CountryCode), MasterDataRules.CountryCode(airport.CountryCode));
            Assert.Equal(airport.Name, MasterDataRules.Name(airport.Name, 180));
            Assert.Equal(Assert.IsType<string>(airport.City), MasterDataRules.Name(airport.City, 120));
            Assert.Equal(Assert.IsType<string>(airport.TimeZone), MasterDataRules.IanaTimeZone(airport.TimeZone));
            // What the map draws the route with; stored as decimal(9,6), so never with more precision than the column.
            var latitude = Assert.NotNull(airport.Latitude);
            var longitude = Assert.NotNull(airport.Longitude);
            Assert.InRange(latitude, -90m, 90m);
            Assert.InRange(longitude, -180m, 180m);
            Assert.Equal(latitude, decimal.Round(latitude, 6));
            Assert.Equal(longitude, decimal.Round(longitude, 6));
        });
    }

    [Fact]
    public void CodesAreUniqueAndTheSimulatedFeedKeepsItsTimetable()
    {
        Assert.Equal(["MIA", "JFK", "YYZ", "MAD", "BOG", "SDQ"], DemoAirports.All.Select(airport => airport.IataCode));
        Assert.Equal(6, DemoAirports.All.Select(airport => airport.IcaoCode).Distinct(StringComparer.Ordinal).Count());
        Assert.Equal(Miami, DemoAirports.Find(" mia "));
        Assert.Equal(SantoDomingo, DemoAirports.Find("SDQ"));
        Assert.Null(DemoAirports.Find("PUJ"));
        Assert.Null(DemoAirports.Find("KMIA"));
        Assert.Null(DemoAirports.Find(null));

        // The simulated feed rotates over the catalogue: each arrival of the day keeps the origin it had while the
        // list was private to the feed. The fourth airline's last rotation wraps around to the first airport.
        var zone = TimeZoneInfo.CreateCustomTimeZone("AST", TimeSpan.FromHours(-4), "AST", "AST");
        var from = new DateTime(2026, 11, 6);
        var to = new DateTime(2026, 11, 6, 23, 59, 0);
        FeedAirline[] airlines =
        [
            new("Demo Airlines", "ZZ", "DZZ"), new("Charter Air", null, "CQZ"), new("Third Air", "XY", "XYZ"),
            new("Fourth Air", "QQ", "QQQ"),
        ];
        var origins = SimulatedAirportFlightFeed.Generate("PUJ", zone, from, to, airlines)
            .Where(flight => flight.Direction == FlightDirection.Arrival)
            .ToDictionary(flight => flight.Number, flight => flight.Counterpart, StringComparer.Ordinal);

        Assert.Equal(16, origins.Count);
        Assert.Equal((Miami, NewYork, Toronto, Madrid),
            (origins["ZZ100"], origins["ZZ102"], origins["ZZ104"], origins["ZZ106"]));
        Assert.Equal((NewYork, Toronto, Madrid, Bogota),
            (origins["CQZ100"], origins["CQZ102"], origins["CQZ104"], origins["CQZ106"]));
        Assert.Equal((Toronto, Madrid, Bogota, SantoDomingo),
            (origins["XY100"], origins["XY102"], origins["XY104"], origins["XY106"]));
        Assert.Equal((Madrid, Bogota, SantoDomingo, Miami),
            (origins["QQ100"], origins["QQ102"], origins["QQ104"], origins["QQ106"]));
        // A station never flies to its own airport: at Santo Domingo the rotation skips SDQ.
        Assert.DoesNotContain(SimulatedAirportFlightFeed.Generate("SDQ", zone, from, to, airlines),
            flight => flight.Counterpart == SantoDomingo);
    }
}
