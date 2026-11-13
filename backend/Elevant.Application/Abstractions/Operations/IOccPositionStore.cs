namespace Elevant.Application.Abstractions.Operations;

/// <summary>
/// Real occupancy of a station's stands (teacher review, Phase 7). A stand is <c>occupied</c> when
/// the aircraft of its active assignment has arrived (actual on-block time recorded), <c>planned</c>
/// when the assignment exists but the aircraft has not arrived, and <c>available</c> otherwise.
/// <see cref="IsDemo"/> is true for the turnaround of a demo flight OCC imported (ADR-0041) and null for any other,
/// never false.
/// </summary>
public sealed record OccPositionTurnaroundData(Guid TurnaroundId, string OperationCode, string AirlineName,
    string? AircraftRegistration, string? ArrivalFlightNumber, string? DepartureFlightNumber,
    DateTimeOffset? ArrivalScheduledAt, DateTimeOffset? ArrivedAt, DateTimeOffset? DepartureScheduledAt,
    DateTimeOffset? AssignedFrom, string Status, bool? IsDemo = null);

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

/// <summary>
/// The arrival OCC records on the map (3-N08): the registration, the actual on-block time (now when null) and,
/// optionally, the aircraft type (3-B). Replacing a time already on the leg (OCC's record, or another one than the
/// flight feed reported) is a correction that needs <paramref name="Reason"/>; recording and correcting are only allowed
/// before the first submission (<c>arrival_locked</c>).
/// </summary>
public sealed record RecordArrivalInput(string? AircraftRegistration, DateTimeOffset? ArrivedAt, Guid? AircraftTypeId = null,
    string? Reason = null);

/// <summary>
/// The Idempotency-Key and the turnaround version (the strong ETag of the turnaround detail) a positions command may
/// carry (3-N10). Both are optional while older screens exist (expand); with a key the version is required.
/// </summary>
public sealed record OccPositionCommand(Guid? IdempotencyKey, string? ExpectedVersion)
{
    /// <summary>A command of an older screen: no key, no version; the server still serializes the stand.</summary>
    public static OccPositionCommand None { get; } = new(null, null);
}

public enum OccPositionFailure { Forbidden, NotFound, Invalid, Conflict }

/// <summary>
/// The board after a command, or the failure with its stable code (3-N10) and, for a refused stand, the rules it
/// breaks (ADR-0030). <see cref="Version"/> is the turnaround's new version after a command.
/// </summary>
public sealed record OccPositionResult(OccPositionBoardData? Board, OccPositionFailure? Failure,
    IReadOnlyList<string>? Reasons = null, string? Code = null, string? Version = null);

public interface IOccPositionStore
{
    /// <summary>Stands of the station with the turnarounds of the day; needs Mapa de posiciones «Ver».</summary>
    Task<OccPositionResult> ReadAsync(Guid actorId, Guid stationId, DateOnly operationDate,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Records the actual arrival (on block), the registration and optionally the aircraft type, or corrects a
    /// recorded arrival with its reason before the first submission; needs «Asignar posiciones».
    /// </summary>
    Task<OccPositionResult> RecordArrivalAsync(Guid actorId, Guid turnaroundId, RecordArrivalInput input,
        OccPositionCommand command, CancellationToken cancellationToken = default);

    /// <summary>
    /// Places a stand on the map (WGS84), or clears it with both values null; needs «Asignar posiciones»
    /// and the stand's station in scope. Returns that station's board for <paramref name="operationDate"/>.
    /// </summary>
    Task<OccPositionResult> LocateStandAsync(Guid actorId, Guid standId, decimal? latitude, decimal? longitude,
        DateOnly operationDate, CancellationToken cancellationToken = default);

    /// <summary>
    /// Assigns or reassigns the turnaround's stand; an overlapping assignment is a conflict. The stand row is locked
    /// and the overlap checked inside a serializable transaction, so two flights never take the same stand.
    /// </summary>
    Task<OccPositionResult> AssignAsync(Guid actorId, Guid turnaroundId, Guid standId, string? reason,
        OccPositionCommand command, CancellationToken cancellationToken = default);

    /// <summary>Frees the stand when the aircraft leaves; history keeps the closed assignment.</summary>
    Task<OccPositionResult> ReleaseAsync(Guid actorId, Guid turnaroundId, OccPositionCommand command,
        CancellationToken cancellationToken = default);
}
