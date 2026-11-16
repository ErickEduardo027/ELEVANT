namespace Elevant.Contracts.Operations;

/// <summary>
/// An aircraft by its registration for the OCC (ADR-0028, note of 15 November 2026), from AeroDataBox's single-aircraft
/// read (tier 1, 1 unit), kept a day per registration. It always comes in a 200: <paramref name="Status"/> is
/// <c>Available</c>, <c>NotFound</c> (the provider knows no aircraft with that registration), <c>Disabled</c> (no provider
/// here), <c>DailyLimitReached</c> or <c>MonthlyLimitReached</c> (the read spent its units; the last value kept may come),
/// <c>Unavailable</c> (the provider failed or is being waited out; the last value kept may come) or <c>NotApplicable</c>
/// (a demo flight's synthetic registration, never asked). <paramref name="Registration"/> is the one asked, in upper case
/// without dashes. <paramref name="RetrievedAt"/> is when the provider gave <paramref name="Aircraft"/>.
/// </summary>
public sealed record OccAircraftReferenceResponse(Guid StationId, string Registration, string Status, DateTimeOffset ServerTime,
    DateTimeOffset? RetrievedAt, string Source, AircraftReferenceResponse? Aircraft);

/// <summary>
/// An aircraft as the provider knows it: its registration, whether it is active under it, its model, type and type codes,
/// who operates it, its serial and Mode-S address, its seats and engines, its age in years and its dates. Every value the
/// provider does not give is null.
/// </summary>
public sealed record AircraftReferenceResponse(string Registration, bool Active, string? Model, string? TypeName,
    string? IcaoType, string? IataType, string? Operator, string? Serial, string? ModeS, int? Seats, int? Engines,
    string? EngineType, double? AgeYears, DateOnly? FirstFlight, DateOnly? Delivered, DateOnly? Registered, bool IsFreighter);

/// <summary>
/// The daily routes from a station's airport (ADR-0043, note of 15 November 2026), from AeroDataBox's airport statistics
/// (tier 3, 6 units), kept 24 hours. <paramref name="Status"/> is one of the states of
/// <see cref="OccAircraftReferenceResponse"/> except <c>NotApplicable</c>. <paramref name="AirportIcao"/> is the station's.
/// </summary>
public sealed record OccAirportRoutesResponse(Guid StationId, string AirportIcao, string Status, DateTimeOffset ServerTime,
    DateTimeOffset? RetrievedAt, string Source, IReadOnlyList<OccAirportRouteResponse> Routes);

/// <summary>
/// A destination: its codes, name, city and country, its position when the provider gives it, its average daily flights
/// and the airlines that fly it (at most twelve).
/// </summary>
public sealed record OccAirportRouteResponse(string? DestinationIata, string? DestinationIcao, string Name, string? City,
    string? CountryCode, double? Latitude, double? Longitude, double AverageDailyFlights, IReadOnlyList<string> Operators);

/// <summary>
/// The current delays of an airport (ADR-0028, note of 15 November 2026), from AeroDataBox's airport delays (tier 3,
/// 6 units), kept an hour per airport: the flights of the two hours before the provider computed it.
/// <paramref name="Airport"/> is the code asked (the station's ICAO when none was). <paramref name="Status"/> is one of
/// the states of <see cref="OccAircraftReferenceResponse"/> except <c>NotApplicable</c>.
/// </summary>
public sealed record OccAirportDelaysResponse(Guid StationId, string Airport, string Status, DateTimeOffset ServerTime,
    DateTimeOffset? RetrievedAt, string Source, OccAirportDelayFactsResponse? Delays);

/// <summary>The delays between <paramref name="From"/> and <paramref name="To"/>, of arrivals and of departures.</summary>
public sealed record OccAirportDelayFactsResponse(string AirportIcao, DateTimeOffset From, DateTimeOffset To,
    OccDelayBatchResponse Arrivals, OccDelayBatchResponse Departures);

/// <summary>
/// A batch of flights: how many there were, how many counted, how many were cancelled, the median delay in minutes
/// (negative when early; null when the provider gives none) and the delay index from 0 to 5.
/// </summary>
public sealed record OccDelayBatchResponse(int Total, int Qualified, int Cancelled, int? MedianDelayMinutes, double? DelayIndex);
