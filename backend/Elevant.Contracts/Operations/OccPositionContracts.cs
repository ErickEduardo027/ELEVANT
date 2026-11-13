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

/// <param name="Latitude">WGS84 location OCC placed on the map (ADR-0027); null until placed.</param>
public sealed record OccPositionResponse(Guid StandId, string Code, string? TerminalCode, string? StandType, string Status,
    IReadOnlyList<OccPositionTurnaroundResponse> Turnarounds, decimal? Latitude, decimal? Longitude,
    bool HasBoardingBridge, bool IsRemote, string? MaxAircraftSize, string? CancelledBy, bool NarrowbodyOnly,
    IReadOnlyList<string> CoveredBy);

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
