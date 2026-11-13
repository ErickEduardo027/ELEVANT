using Elevant.Application.Operations;

namespace Elevant.Application.Integration.DemoFlights;

/// <summary>
/// A demo flight (ADR-0041) is a pair of flight proposals the superadministrator triggers to show the whole cycle
/// without waiting for a real aircraft. They carry this provider name, so OCC sees them marked as demo, the paid feed
/// ignores them and they never match a live aircraft.
/// </summary>
public static class DemoFlightProvider
{
    public const string Name = "Demo";
}

/// <summary>
/// The values of <c>DemoFlights:Mode</c>. Disabled is the default; Enabled only runs in Development or Test, and any
/// other environment refuses to start with it.
/// </summary>
public enum DemoFlightMode
{
    Disabled,
    Enabled,
}

/// <summary>
/// Whether demo flights run in this environment, from <c>DemoFlights:Mode</c>. The handler, the stores and the
/// screens read it: while it is off every command answers <c>demo_flights_unavailable</c> and the reads answer
/// <c>enabled: false</c>, but the endpoints exist all the same.
/// </summary>
public sealed record DemoFlightAvailability(bool Enabled)
{
    public static DemoFlightAvailability Disabled { get; } = new(false);

    public static DemoFlightAvailability On { get; } = new(true);
}

/// <summary>Problem Details codes of the demo flight commands (ADR-0041).</summary>
public static class DemoFlightCodes
{
    /// <summary>Demo flights are off in this environment.</summary>
    public const string Unavailable = "demo_flights_unavailable";

    /// <summary>
    /// The request breaks a rule of the form: an identifier, an airport, the stand choice, the minutes or the intent.
    /// </summary>
    public const string Invalid = "invalid_demo_flight";

    /// <summary>The origin or the destination is neither a known airport nor one of <see cref="DemoAirports"/>.</summary>
    public const string OriginUnknown = "demo_origin_unknown";

    /// <summary>
    /// The station already has <see cref="DemoFlightRules.MaxActivePerStation"/> active demo flights, or the day has
    /// no flight number or registration left (<see cref="DemoFlightNumbering"/>).
    /// </summary>
    public const string LimitReached = "demo_flight_limit_reached";

    /// <summary>The demo flight is already cancelled or finished.</summary>
    public const string Closed = "demo_flight_closed";
}

/// <summary>
/// How the trigger chooses the stand the aircraft is suggested for: none (OCC assigns it when it imports the flight)
/// or the one the request names.
/// </summary>
public enum DemoStandChoice
{
    None,
    Specific,
}

/// <summary>What ends a demo flight: «Cancelar vuelo» before touchdown, «Terminar demo» after it.</summary>
public enum DemoFlightIntent
{
    Cancel,
    Finish,
}

/// <summary>
/// What the superadministrator may ask for (ADR-0041). The ranges keep the demonstration honest: with at most 30
/// minutes to the stand the aircraft appears already on approach, and with at least 20 on the ground OCC's review
/// still pairs the arrival with its departure.
/// </summary>
public static class DemoFlightRules
{
    public const int MinMinutesToOnBlock = 2;

    public const int MaxMinutesToOnBlock = 30;

    public const int DefaultMinutesToOnBlock = 8;

    public const int MinGroundMinutes = 20;

    public const int MaxGroundMinutes = 240;

    /// <summary>An hour, so an unhurried demonstration does not end in an overrun charge.</summary>
    public const int DefaultGroundMinutes = 60;

    /// <summary>Demo flights that may be active at one station at the same time.</summary>
    public const int MaxActivePerStation = 3;

    /// <summary>
    /// The request as the store takes it, or null when it breaks a rule (<c>invalid_demo_flight</c>): identifiers
    /// present, three-letter IATA codes (a null destination is the origin: the aircraft returns where it came from),
    /// the stand choice by its exact name with a stand only when it was chosen, and both durations inside their
    /// ranges. That the airports are not the station's own is <see cref="UsesStationAirport"/>, which needs the station.
    /// </summary>
    public static CreateDemoFlightInput? Normalize(CreateDemoFlightCommand raw)
    {
        ArgumentNullException.ThrowIfNull(raw);
        if (raw.StationId == Guid.Empty || raw.AirlineId == Guid.Empty || raw.AircraftTypeId == Guid.Empty) return null;
        if (raw.MinutesToOnBlock is < MinMinutesToOnBlock or > MaxMinutesToOnBlock ||
            raw.GroundMinutes is < MinGroundMinutes or > MaxGroundMinutes) return null;
        var origin = FlightIdentity.NormalizeIata(raw.OriginIata);
        var destination = raw.DestinationIata is null ? origin : FlightIdentity.NormalizeIata(raw.DestinationIata);
        if (!FlightIdentity.IsIata(origin) || !FlightIdentity.IsIata(destination)) return null;
        if (ExactName<DemoStandChoice>(raw.StandChoice) is not { } standChoice) return null;
        var namesStand = raw.StandId is { } standId && standId != Guid.Empty;
        if (standChoice == DemoStandChoice.Specific ? !namesStand : raw.StandId is not null) return null;
        return new CreateDemoFlightInput(raw.StationId, raw.AirlineId, origin, destination, raw.AircraftTypeId, standChoice,
            raw.StandId, raw.MinutesToOnBlock, raw.GroundMinutes);
    }

    /// <summary>The intent of a cancel command by its exact name; null for anything else.</summary>
    public static DemoFlightIntent? ParseIntent(string? value) => ExactName<DemoFlightIntent>(value);

    /// <summary>
    /// True when the origin or the destination is the airport of the station itself: a leg never flies from an airport
    /// to the same airport.
    /// </summary>
    public static bool UsesStationAirport(string stationIata, string originIata, string destinationIata)
    {
        var station = FlightIdentity.NormalizeIata(stationIata);
        return station == FlightIdentity.NormalizeIata(originIata) || station == FlightIdentity.NormalizeIata(destinationIata);
    }

    /// <summary>Only the exact names: no numbers, no other case and no combinations.</summary>
    private static T? ExactName<T>(string? value) where T : struct, Enum =>
        value is not null && Enum.GetNames<T>().Contains(value, StringComparer.Ordinal) ? Enum.Parse<T>(value) : null;
}
