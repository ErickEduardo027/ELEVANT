namespace Elevant.Application.Operations.MapFlights;

/// <summary>
/// The ELEVANT flights of a station for the map (ADR-0042, contracts 1.3): one row per leg of the station's turnarounds
/// and per open proposal of the flight feed, inside a window of time. A SQL read that only changes when OCC's planning
/// does (<c>occ_planning</c>).
/// </summary>
/// <param name="StationId">The station's id.</param>
/// <param name="StationCode">The station's code.</param>
/// <param name="ServerTime">The instant the rows were read at: phases and demo instants are as they stand then.</param>
/// <param name="WindowFrom">First instant of the window the rows were chosen by.</param>
/// <param name="WindowTo">Last instant of that window.</param>
/// <param name="StationAirport">The airport the station operates at.</param>
/// <param name="Flights">The rows, by best time (actual, else estimated, else scheduled) and then flight number.</param>
public sealed record OccMapFlightsData(Guid StationId, string StationCode, DateTimeOffset ServerTime,
    DateTimeOffset WindowFrom, DateTimeOffset WindowTo, OccMapAirportData StationAirport,
    IReadOnlyList<OccMapFlightData> Flights);

/// <summary>
/// One leg on the map. A row is either a leg of a turnaround (<paramref name="Imported"/>) or a proposal of the feed OCC
/// has not decided yet.
/// </summary>
/// <param name="FlightKey">
/// The key the map follows the flight by (<see cref="MapFlightKeys"/>): an open proposal is <c>p:</c> and its id; a leg
/// the import created is <c>p:</c> and the id of the proposal it came from, so the key does not change when OCC imports
/// the flight; any other leg, also a planned flight a feed pair joined (3-N07), is <c>l:</c> and the leg's id.
/// </param>
/// <param name="VisitKey">
/// Groups the two legs of one aircraft visit: <c>p:</c> and the arrival proposal's id for a turnaround the import created
/// and for open pairs, <c>t:</c> and the turnaround's id otherwise.
/// </param>
/// <param name="ProposalId">The proposal of the row, or the one most recently linked to the leg.</param>
/// <param name="LegId">The leg's id; null for a proposal.</param>
/// <param name="TurnaroundId">The turnaround's id; null for a proposal.</param>
/// <param name="Direction"><c>Arrival</c> or <c>Departure</c>.</param>
/// <param name="FlightNumber">The number as the leg or the provider writes it.</param>
/// <param name="Callsign">The airline's ICAO designator and the number without leading zeros, when both are known.</param>
/// <param name="Airline">The airline that operates the flight.</param>
/// <param name="Counterpart">The origin of an arrival or the destination of a departure.</param>
/// <param name="ScheduledAt">The scheduled time at the station.</param>
/// <param name="EstimatedAt">The estimated (or revised) time at the station.</param>
/// <param name="ActualAt">The actual time at the station.</param>
/// <param name="ActualKind">
/// What <paramref name="ActualAt"/> is (<see cref="MapFlightActualKinds"/>): the wheels on the runway, or the aircraft on
/// its stand; null without an actual time.
/// </param>
/// <param name="Phase">One of <see cref="MapFlightPhases.All"/>.</param>
/// <param name="ProviderStatus">The provider's word for the flight, as it reported it; informational only.</param>
/// <param name="Aircraft">What is known of the aircraft; null when nothing is.</param>
/// <param name="Imported">The row is a leg of a turnaround.</param>
/// <param name="Turnaround">The turnaround and its operation; null for a proposal.</param>
/// <param name="Stand">The stand the turnaround holds (its open assignment), without its geometry.</param>
/// <param name="SuggestedStandCode">The stand a demo flight was triggered for, while nobody imported it.</param>
/// <param name="Milestones">The milestones recorded on the turnaround's operation, in the order of the flight report.</param>
/// <param name="IsDemo">A leg of a demo flight (ADR-0041).</param>
/// <param name="Demo">The demo flight's clock at <see cref="OccMapFlightsData.ServerTime"/>, on both legs of a demo flight.</param>
public sealed record OccMapFlightData(string FlightKey, string VisitKey, Guid? ProposalId, Guid? LegId, Guid? TurnaroundId,
    string Direction, string FlightNumber, string? Callsign, OccMapAirlineData Airline, OccMapAirportData? Counterpart,
    DateTimeOffset ScheduledAt, DateTimeOffset? EstimatedAt, DateTimeOffset? ActualAt, string? ActualKind, string Phase,
    string? ProviderStatus, OccMapAircraftData? Aircraft, bool Imported, OccMapTurnaroundData? Turnaround,
    OccMapStandData? Stand, string? SuggestedStandCode, IReadOnlyList<OccMapMilestoneData> Milestones, bool IsDemo,
    OccMapDemoData? Demo);

public sealed record OccMapAirlineData(Guid Id, string Name, string? IataCode, string IcaoCode);

/// <summary>
/// An airport of the map. Its reference point comes from <c>ref.airports</c>; when the row has none, from the built-in
/// catalogue of the demo flights, at read time only. Null coordinates mean nobody knows them. An empty ICAO code is null.
/// </summary>
public sealed record OccMapAirportData(string IataCode, string? IcaoCode, string Name, decimal? Latitude,
    decimal? Longitude);

/// <summary>
/// The aircraft of a leg: the turnaround's registration and type («manufacturer model»), or the registration and model
/// the provider reported with the type that model suggests. The size is <c>Narrowbody</c>, <c>Widebody</c> or null.
/// </summary>
public sealed record OccMapAircraftData(string? Registration, string? TypeIcaoCode, string? Model, string? SizeCategory);

/// <summary>A turnaround and, when it has one, its ground operation, with their statuses.</summary>
public sealed record OccMapTurnaroundData(Guid Id, string OperationCode, string Status, Guid? OperationId,
    string? OperationStatus);

public sealed record OccMapStandData(Guid Id, string Code, string? TerminalCode);

/// <summary>A milestone of the flight report (<see cref="FlightReportMilestones"/>) and when it happened.</summary>
public sealed record OccMapMilestoneData(string Code, DateTimeOffset ActualAt);

/// <summary>
/// The clock of a demo flight (ADR-0041) as the same timeline the progress worker follows resolves it at the time of the
/// read: the map fits the aircraft to these instants and never derives its own. The state is <c>Active</c>,
/// <c>Cancelled</c> or <c>Finished</c>; the phase <c>Approach</c>, <c>TaxiIn</c>, <c>Parked</c>, <c>TaxiOut</c>,
/// <c>Departed</c> or <c>Gone</c>.
/// </summary>
public sealed record OccMapDemoData(Guid DemoFlightId, string State, string Phase, DateTimeOffset AppearAt,
    DateTimeOffset TouchdownAt, DateTimeOffset OnBlockAt, DateTimeOffset ScheduledOffBlockAt, DateTimeOffset? OffBlockAt,
    DateTimeOffset? TakeoffAt, DateTimeOffset? VanishAt);
