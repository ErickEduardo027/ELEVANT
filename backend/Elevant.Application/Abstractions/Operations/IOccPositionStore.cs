namespace Elevant.Application.Abstractions.Operations;

/// <summary>
/// Real occupancy of a station's stands (teacher review, Phase 7). A stand is <c>occupied</c> when
/// the aircraft of its active assignment has arrived (actual on-block time recorded), <c>planned</c>
/// when the assignment exists but the aircraft has not arrived, and <c>available</c> otherwise.
/// </summary>
public sealed record OccPositionTurnaroundData(Guid TurnaroundId, string OperationCode, string AirlineName,
    string? AircraftRegistration, string? ArrivalFlightNumber, string? DepartureFlightNumber,
    DateTimeOffset? ArrivalScheduledAt, DateTimeOffset? ArrivedAt, DateTimeOffset? DepartureScheduledAt,
    DateTimeOffset? AssignedFrom, string Status);

/// <param name="Latitude">WGS84 location OCC placed (ADR-0027); null until placed.</param>
/// <param name="CancelledBy">Code of the occupied stand that cancels this one right now (ADR-0030), an alert to OCC.</param>
/// <param name="NarrowbodyOnly">Limited to narrow-body now, by its own size or an occupied neighbour.</param>
/// <param name="CoveredBy">Agents covering the stand on the board's date.</param>
public sealed record OccPositionData(Guid StandId, string Code, string? TerminalCode, string? StandType, string Status,
    IReadOnlyList<OccPositionTurnaroundData> Turnarounds, decimal? Latitude = null, decimal? Longitude = null,
    bool HasBoardingBridge = false, bool IsRemote = false, string? MaxAircraftSize = null, string? CancelledBy = null,
    bool NarrowbodyOnly = false, IReadOnlyList<string>? CoveredBy = null);

public sealed record OccPositionBoardData(Guid StationId, string StationCode, DateOnly OperationDate, DateTimeOffset AsOf,
    IReadOnlyList<OccPositionData> Positions, IReadOnlyList<OccPositionTurnaroundData> Unassigned, bool CanAssign);

public sealed record RecordArrivalInput(string? AircraftRegistration, DateTimeOffset? ArrivedAt);

public enum OccPositionFailure { Forbidden, NotFound, Invalid, Conflict }

/// <param name="Reasons">Combined-stand rules a rejected assignment breaks (ADR-0030).</param>
public sealed record OccPositionResult(OccPositionBoardData? Board, OccPositionFailure? Failure,
    IReadOnlyList<string>? Reasons = null);

public interface IOccPositionStore
{
    /// <summary>Stands of the station with the turnarounds of the day; needs Mapa de posiciones «Ver».</summary>
    Task<OccPositionResult> ReadAsync(Guid actorId, Guid stationId, DateOnly operationDate,
        CancellationToken cancellationToken = default);

    /// <summary>Records the actual arrival (on block) and registration; needs «Asignar posiciones».</summary>
    Task<OccPositionResult> RecordArrivalAsync(Guid actorId, Guid turnaroundId, RecordArrivalInput input,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Places a stand on the map (WGS84), or clears it with both values null; needs «Asignar posiciones»
    /// and the stand's station in scope. Returns that station's board for <paramref name="operationDate"/>.
    /// </summary>
    Task<OccPositionResult> LocateStandAsync(Guid actorId, Guid standId, decimal? latitude, decimal? longitude,
        DateOnly operationDate, CancellationToken cancellationToken = default);

    /// <summary>Assigns or reassigns the turnaround's stand; an overlapping assignment is a conflict.</summary>
    Task<OccPositionResult> AssignAsync(Guid actorId, Guid turnaroundId, Guid standId, string? reason,
        CancellationToken cancellationToken = default);

    /// <summary>Frees the stand when the aircraft leaves; history keeps the closed assignment.</summary>
    Task<OccPositionResult> ReleaseAsync(Guid actorId, Guid turnaroundId, CancellationToken cancellationToken = default);
}
