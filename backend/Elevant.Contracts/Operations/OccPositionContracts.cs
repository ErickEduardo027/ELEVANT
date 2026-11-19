using System.Text.Json.Serialization;

namespace Elevant.Contracts.Operations;

/// <summary>
/// A turnaround on the positions board. <paramref name="IsDemo"/> is true for the turnaround of a demo flight OCC
/// imported (ADR-0041) and absent otherwise: the key is written only when true.
/// </summary>
public sealed record OccPositionTurnaroundResponse(Guid TurnaroundId, string OperationCode, string AirlineName,
    string? AircraftRegistration, string? ArrivalFlightNumber, string? DepartureFlightNumber,
    DateTimeOffset? ArrivalScheduledAt, DateTimeOffset? ArrivedAt, DateTimeOffset? DepartureScheduledAt,
    DateTimeOffset? AssignedFrom, string Status,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? IsDemo = null);

/// <summary>
/// One coverage window of a stand (ADR-0030, N26): the agent, from when to when and whether it is a reinforcement.
/// </summary>
public sealed record OccPositionCoverageResponse(string AgentName, DateTimeOffset StartsAt, DateTimeOffset EndsAt,
    bool IsReinforcement);

/// <param name="Latitude">WGS84 location OCC placed on the map (ADR-0027); null until placed.</param>
/// <param name="RequiredPermits">
/// Names of the permits the stand requires (ADR-0045); the key is written only when the stand requires one.
/// </param>
/// <param name="Coverage">
/// The coverage windows of the board's date behind <paramref name="CoveredBy"/> (N26), by start: the key is written only
/// to a read with <c>includeCoverage=true</c>, empty when nobody covers the stand that day, so a client deployed before
/// it keeps validating the board.
/// </param>
public sealed record OccPositionResponse(Guid StandId, string Code, string? TerminalCode, string? StandType, string Status,
    IReadOnlyList<OccPositionTurnaroundResponse> Turnarounds, decimal? Latitude, decimal? Longitude,
    bool HasBoardingBridge, bool IsRemote, string? MaxAircraftSize, string? CancelledBy, bool NarrowbodyOnly,
    IReadOnlyList<string> CoveredBy,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<string>? RequiredPermits = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<OccPositionCoverageResponse>? Coverage = null);

/// <summary>Both null clears the stand's location.</summary>
public sealed record LocateOccStandRequest(decimal? Latitude, decimal? Longitude, DateOnly OperationDate);

public sealed record OccPositionBoardResponse(Guid StationId, string StationCode, DateOnly OperationDate, DateTimeOffset AsOf,
    IReadOnlyList<OccPositionResponse> Positions, IReadOnlyList<OccPositionTurnaroundResponse> Unassigned, bool CanAssign);

/// <summary>
/// The arrival OCC records on the map (3-N08): the registration, the actual on-block time (now when null) and,
/// optionally, the aircraft type (3-B). Replacing a time already on the flight (OCC's record, or another one than the
/// flight feed reported) corrects it: <paramref name="Reason"/> is then required. Recording and correcting are only
/// allowed before the first submission. With an Idempotency-Key the If-Match is required.
/// </summary>
/// <param name="AircraftRegistration">The registration of the aircraft on the stand.</param>
/// <param name="ArrivedAt">The actual on-block time; the screen captures it in the station's local time.</param>
/// <param name="AircraftTypeId">The aircraft type seen on arrival; null keeps the current one.</param>
/// <param name="Reason">Why the time on the flight is replaced (5 to 500 characters).</param>
public sealed record RecordOccArrivalRequest(string AircraftRegistration, DateTimeOffset? ArrivedAt,
    Guid? AircraftTypeId = null, string? Reason = null);

public sealed record AssignOccStandRequest(Guid StandId, string? Reason);
