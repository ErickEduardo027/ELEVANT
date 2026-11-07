using Elevant.Application.Abstractions.Integrations;
using Elevant.Application.Common;
using Elevant.Domain.Enumerations;

namespace Elevant.Infrastructure.Integrations.SimulatedFlightFeed;

/// <summary>
/// The simulated flight feed of local stacks and the cycle E2E (2-B). Opt-in with
/// <c>SimulatedFlightFeed:Enabled=true</c>, off by default, refused outside Development or Test and while
/// AeroDataBox is enabled. It never uses the network nor feeds the airline registry: from the station's time
/// zone and the registered airlines it answers a deterministic timetable with aircraft models, terminal and
/// gate, under its own provider name, so its usage ledger, lease and budget never mix with AeroDataBox.
/// </summary>
public sealed class SimulatedAirportFlightFeed(ISimulatedFlightFeedCatalog catalog) : IAirportFlightFeed
{
    public const string ProviderName = "Simulated";

    /// <summary>Minutes between an arrival and its departure.</summary>
    public const int TurnMinutes = 75;

    /// <summary>Each airline turns around every six hours, staggered by its rank.</summary>
    private const int RotationsPerDay = 4;

    private static readonly string[] Models = ["Boeing 737-800", "Airbus A320", "Airbus A330-300", "Embraer 190"];

    /// <summary>Real airports with their public reference data, so imported flights have known counterparts.</summary>
    private static readonly FeedAirport[] Airports =
    [
        new("MIA", "KMIA", "Miami International Airport", "Miami", "US", "America/New_York", 25.7959m, -80.2870m),
        new("JFK", "KJFK", "John F. Kennedy International Airport", "New York", "US", "America/New_York", 40.6413m, -73.7781m),
        new("YYZ", "CYYZ", "Toronto Pearson International Airport", "Toronto", "CA", "America/Toronto", 43.6777m, -79.6248m),
        new("MAD", "LEMD", "Adolfo Suárez Madrid-Barajas Airport", "Madrid", "ES", "Europe/Madrid", 40.4983m, -3.5676m),
        new("BOG", "SKBO", "El Dorado International Airport", "Bogotá", "CO", "America/Bogota", 4.7016m, -74.1469m),
        new("SDQ", "MDSD", "Las Américas International Airport", "Santo Domingo", "DO", "America/Santo_Domingo", 18.4297m, -69.6689m),
    ];

    public string Provider => ProviderName;

    public bool IsConfigured => true;

    /// <summary>Counted like the real FIDS call so the budget and the planner behave as in production.</summary>
    public int UnitsPerCall => 2;

    public TimeSpan MaxWindow => TimeSpan.FromHours(12);

    public async Task<AirportFeedResponse> GetFlightsAsync(string airportIataCode, DateTime fromLocal, DateTime toLocal,
        CancellationToken cancellationToken = default)
    {
        if (airportIataCode is not { Length: 3 } || toLocal <= fromLocal || toLocal - fromLocal > MaxWindow)
            throw new ArgumentException("The airport code or the window is invalid.");
        var airport = airportIataCode.ToUpperInvariant();
        var scope = await catalog.FindAsync(airport, cancellationToken);
        IReadOnlyList<FeedFlight> flights = scope is null ? []
            : Generate(airport, BusinessCalendar.Zone(scope.TimeZoneId), fromLocal, toLocal, scope.Airlines);
        return flights.Count == 0
            ? new AirportFeedResponse(ProviderCallOutcome.NoContent, UnitsPerCall, 204, null, [])
            : new AirportFeedResponse(ProviderCallOutcome.Succeeded, UnitsPerCall, 200, null, flights);
    }

    /// <summary>
    /// The timetable of an airport in a local window. The airline of rank <c>i</c> lands at 03:00, 09:00, 15:00
    /// and 21:00 plus <c>25·i</c> minutes (modulo five hours) and leaves <see cref="TurnMinutes"/> later with the
    /// same aircraft, so the review pairs both legs. The same inputs always give the same flights.
    /// </summary>
    public static IReadOnlyList<FeedFlight> Generate(string airportIataCode, TimeZoneInfo zone, DateTime fromLocal,
        DateTime toLocal, IReadOnlyList<FeedAirline> airlines)
    {
        ArgumentNullException.ThrowIfNull(zone);
        ArgumentNullException.ThrowIfNull(airlines);
        var counterparts = Airports.Where(item => !string.Equals(item.IataCode, airportIataCode, StringComparison.OrdinalIgnoreCase))
            .ToArray();
        var flights = new List<FeedFlight>();
        for (var index = 0; index < airlines.Count; index++)
        {
            var airline = airlines[index];
            var code = airline.IataCode ?? airline.IcaoCode;
            if (string.IsNullOrWhiteSpace(code)) continue;
            // The previous day's last rotation can land after midnight.
            for (var day = fromLocal.Date.AddDays(-1); day <= toLocal.Date; day = day.AddDays(1))
                for (var rotation = 0; rotation < RotationsPerDay; rotation++)
                {
                    var arrival = day.AddHours(3 + rotation * 6).AddMinutes(index * 25 % 300);
                    var departure = arrival.AddMinutes(TurnMinutes);
                    var counterpart = counterparts[(index + rotation) % counterparts.Length];
                    var model = Models[(index + rotation) % Models.Length];
                    var registration = $"HI{1000 + index * RotationsPerDay + rotation}";
                    var gate = $"{1 + (index + rotation) % 8}";
                    if (arrival >= fromLocal && arrival <= toLocal)
                        flights.Add(Leg(FlightDirection.Arrival, $"{code}{100 + rotation * 2}", airline, counterpart,
                            Utc(arrival, zone), registration, model, gate));
                    if (departure >= fromLocal && departure <= toLocal)
                        flights.Add(Leg(FlightDirection.Departure, $"{code}{101 + rotation * 2}", airline, counterpart,
                            Utc(departure, zone), registration, model, gate));
                }
        }
        return flights;
    }

    private static FeedFlight Leg(FlightDirection direction, string number, FeedAirline airline, FeedAirport counterpart,
        DateTimeOffset scheduled, string registration, string model, string gate) =>
        new(direction, number.ToUpperInvariant(), airline, counterpart, scheduled, null, null, "Expected", registration, model,
            "A", gate, false, "IsOperator");

    private static DateTimeOffset Utc(DateTime local, TimeZoneInfo zone)
    {
        var unspecified = DateTime.SpecifyKind(local, DateTimeKind.Unspecified);
        // A local time skipped by a daylight-saving jump moves to the first valid minute.
        while (zone.IsInvalidTime(unspecified)) unspecified = unspecified.AddMinutes(30);
        return new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(unspecified, zone), TimeSpan.Zero);
    }
}

/// <summary>Configuration of the simulated flight feed (<c>SimulatedFlightFeed__Enabled</c>).</summary>
public sealed class SimulatedFlightFeedOptions
{
    public const string SectionName = "SimulatedFlightFeed";

    public bool Enabled { get; set; }
}
