namespace Elevant.Contracts.Operations;

/// <summary>
/// The live aircraft around a station for the OCC map (ADR-0042, contracts 1.3), served from memory; a read of the map
/// keeps the network being read for a while, and with nobody watching it is never read. It always comes in a 200:
/// <paramref name="Status"/> is <c>Live</c>, <c>Stale</c> (the last good read is up to ten minutes old; its aircraft
/// still come), <c>Warming</c> (the first read of a new watch is on its way), <c>Unavailable</c> or <c>Disabled</c>, and
/// <paramref name="Reason"/> says why it is not live: <c>not_configured</c>, <c>quota_exceeded</c>,
/// <c>rate_limited</c>, <c>unauthorized</c> or <c>provider_error</c> (null when there is nothing to explain).
/// <paramref name="ObservedAt"/> is the instant the network's answer describes and <paramref name="AgeSeconds"/> how
/// long before <paramref name="ServerTime"/> that was. Screens ask again after <paramref name="RefreshAfterSeconds"/>
/// (10 to 60; 2 while warming), never sooner. <paramref name="Source"/> is the credit of the active network that every
/// map shows (owner decision 6); null only while nothing is configured.
/// </summary>
public sealed record OccAirPictureResponse(Guid StationId, string Status, string? Reason, DateTimeOffset ServerTime,
    DateTimeOffset? ObservedAt, int? AgeSeconds, int RefreshAfterSeconds, OccAirTrafficSourceResponse? Source,
    OccAirPictureCenterResponse Center, IReadOnlyList<OccAirPictureAircraftResponse> Aircraft);

/// <summary>What a network requires wherever its data is shown: its name, its home page and its licence.</summary>
public sealed record OccAirTrafficSourceResponse(string Name, string HomeUrl, string LicenseName, string? LicenseUrl);

/// <summary>The circle every read of the network asks for: its centre in decimal degrees and its radius in nautical miles.</summary>
public sealed record OccAirPictureCenterResponse(double Latitude, double Longitude, int RadiusNm);

/// <summary>
/// A live aircraft in aviation units (feet, knots, feet per minute). <paramref name="Hex"/> is its ICAO 24-bit address,
/// six lower-case hexadecimal digits; <paramref name="AltitudeFeet"/> is null on the ground; <paramref name="PositionAt"/>
/// is when the network last placed it. <paramref name="MatchedFlightKey"/> is the <c>flightKey</c> of the ELEVANT flight
/// of <c>occ/map/flights</c> it is, recognised by its <c>Registration</c> or its <c>Callsign</c>
/// (<paramref name="MatchedBy"/>); both null when it is none. <paramref name="Trail"/> holds the last points of its trail,
/// oldest first: at most eight with <c>trails=short</c>, none with <c>trails=none</c>.
/// </summary>
public sealed record OccAirPictureAircraftResponse(string Hex, string? Callsign, string? Registration, string? TypeIcaoCode,
    string? Category, double Latitude, double Longitude, int? AltitudeFeet, bool OnGround, double? GroundSpeedKnots,
    double? TrackDegrees, int? VerticalRateFeetPerMinute, string? Squawk, DateTimeOffset PositionAt,
    string? MatchedFlightKey, string? MatchedBy, IReadOnlyList<OccAirTrailPointResponse> Trail);

/// <summary>One point of a trail, as a read placed the aircraft.</summary>
public sealed record OccAirTrailPointResponse(DateTimeOffset At, double Latitude, double Longitude, int? AltitudeFeet,
    bool OnGround);

/// <summary>
/// The trail of one aircraft from memory (contracts 1.3): its last segment only (a trail is never drawn across a gap), at
/// most 600 points, oldest first. The network is never asked for it.
/// </summary>
public sealed record OccAircraftTrackResponse(string Hex, DateTimeOffset ServerTime, OccAirTrafficSourceResponse? Source,
    IReadOnlyList<OccAirTrailPointResponse> Points);

/// <summary>
/// The ELEVANT flights of a station for the map (ADR-0042, contracts 1.3): one row per leg of the station's turnarounds
/// and per open proposal of the flight feed whose best time is in [<paramref name="WindowFrom"/>,
/// <paramref name="WindowTo"/>], plus the legs of every aircraft on the ground now. A SQL read that only changes with
/// <c>occ_planning</c>; phases and demo clocks are as they stand at <paramref name="ServerTime"/>. The API never sends a
/// runway, a position for an ELEVANT flight or the geometry of a stand: the map decides where.
/// </summary>
public sealed record OccMapFlightsResponse(Guid StationId, string StationCode, DateTimeOffset ServerTime,
    DateTimeOffset WindowFrom, DateTimeOffset WindowTo, OccMapAirportResponse StationAirport,
    IReadOnlyList<OccMapFlightResponse> Flights);

/// <summary>
/// One leg on the map. <paramref name="FlightKey"/> is the key the map follows it by, which does not change when OCC
/// imports the flight: <c>p:</c> and the id of the proposal it came from, or <c>l:</c> and the leg's id for any other leg.
/// <paramref name="VisitKey"/> groups the two legs of one aircraft visit (<c>p:</c> and the arrival proposal's id, or
/// <c>t:</c> and the turnaround's id). <paramref name="ActualKind"/> says what <paramref name="ActualAt"/> is: the wheels
/// on the runway (<c>Runway</c>) or the aircraft on its stand (<c>OnBlock</c>). <paramref name="Phase"/> is
/// <c>scheduled</c>, <c>departed</c>, <c>enroute</c>, <c>approaching</c>, <c>landed</c>, <c>arrived</c>,
/// <c>cancelled</c>, <c>diverted</c> or <c>unknown</c>; <paramref name="ProviderStatus"/> is the provider's own word,
/// informational only. <paramref name="Stand"/> is the turnaround's open assignment;
/// <paramref name="SuggestedStandCode"/> the stand a demo flight was triggered for, while nobody imported it.
/// <paramref name="Milestones"/> are the milestones recorded on the operation, in the order of the flight report.
/// <paramref name="Demo"/> is the demo flight's clock, on both legs of a demo flight.
/// </summary>
public sealed record OccMapFlightResponse(string FlightKey, string VisitKey, Guid? ProposalId, Guid? LegId,
    Guid? TurnaroundId, string Direction, string FlightNumber, string? Callsign, OccMapAirlineResponse Airline,
    OccMapAirportResponse? Counterpart, DateTimeOffset ScheduledAt, DateTimeOffset? EstimatedAt, DateTimeOffset? ActualAt,
    string? ActualKind, string Phase, string? ProviderStatus, OccMapAircraftResponse? Aircraft, bool Imported,
    OccMapTurnaroundResponse? Turnaround, OccMapStandResponse? Stand, string? SuggestedStandCode,
    IReadOnlyList<OccMapMilestoneResponse> Milestones, bool IsDemo, OccMapDemoResponse? Demo);

public sealed record OccMapAirlineResponse(Guid Id, string Name, string? IataCode, string IcaoCode);

/// <summary>An airport with its reference point; null coordinates mean nobody knows them.</summary>
public sealed record OccMapAirportResponse(string IataCode, string? IcaoCode, string Name, decimal? Latitude,
    decimal? Longitude);

/// <summary><paramref name="SizeCategory"/> is <c>Narrowbody</c>, <c>Widebody</c> or null when unknown.</summary>
public sealed record OccMapAircraftResponse(string? Registration, string? TypeIcaoCode, string? Model, string? SizeCategory);

/// <summary>A turnaround and, when it has one, its ground operation, with their statuses.</summary>
public sealed record OccMapTurnaroundResponse(Guid Id, string OperationCode, string Status, Guid? OperationId,
    string? OperationStatus);

/// <summary>The stand of a turnaround, without its geometry: the map knows where it is.</summary>
public sealed record OccMapStandResponse(Guid Id, string Code, string? TerminalCode);

/// <summary>A milestone of the flight report and when it happened.</summary>
public sealed record OccMapMilestoneResponse(string Code, DateTimeOffset ActualAt);

/// <summary>
/// The clock of a demo flight (ADR-0041) as the server resolves it: <paramref name="State"/> is <c>Active</c>,
/// <c>Cancelled</c> or <c>Finished</c> and <paramref name="Phase"/> <c>Approach</c>, <c>TaxiIn</c>, <c>Parked</c>,
/// <c>TaxiOut</c>, <c>Departed</c> or <c>Gone</c>. The map fits the aircraft to these instants and never derives its own.
/// </summary>
public sealed record OccMapDemoResponse(Guid DemoFlightId, string State, string Phase, DateTimeOffset AppearAt,
    DateTimeOffset TouchdownAt, DateTimeOffset OnBlockAt, DateTimeOffset ScheduledOffBlockAt, DateTimeOffset? OffBlockAt,
    DateTimeOffset? TakeoffAt, DateTimeOffset? VanishAt);
