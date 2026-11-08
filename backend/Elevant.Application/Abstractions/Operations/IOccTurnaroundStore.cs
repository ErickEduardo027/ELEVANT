using Elevant.Application.Operations;

namespace Elevant.Application.Abstractions.Operations;

/// <summary>
/// One turnaround as OCC edits it from Planificación (3-A). <see cref="Version"/> is the turnaround's rowversion in
/// base64, the strong ETag every change sends back in If-Match; <see cref="AllowedActions"/> are the changes the
/// screen may offer now (<see cref="OccTurnaroundRules"/>), checked again by the server.
/// </summary>
public sealed record OccTurnaroundDetailData(OccStationData Station, OccTurnaroundData Turnaround, string Version,
    bool IsCharter, IReadOnlyList<string> AllowedActions);

/// <summary>
/// «Editar vuelo»: the numbers, airports and UTC times of both legs and the reason. A null stand or aircraft type
/// keeps the current one; the airline never changes (cancel and enter the flight again).
/// </summary>
public sealed record RescheduleTurnaroundInput(string? ArrivalFlightNumber, string? ArrivalOriginIata,
    DateTimeOffset? ArrivalScheduledAt, string? DepartureFlightNumber, string? DepartureDestinationIata,
    DateTimeOffset? DepartureScheduledAt, Guid? StandId, Guid? AircraftTypeId, string? Reason, string? ExpectedVersion);

/// <summary>«Cancelar vuelo» or «Marcar desviado» (<c>Cancelled</c> or <c>Diverted</c>) with the reason.</summary>
public sealed record TurnaroundStatusChangeInput(string? Outcome, string? Reason, string? ExpectedVersion);

/// <summary>A carrier OCC registers to plan its charter (3-N21): name, ICAO designator and optional IATA one.</summary>
public sealed record CharterAirlineInput(string? Name, string? IcaoCode, string? IataCode);

/// <summary>The carrier created by OCC; Contratos completes it when a commercial request of the same codes is approved.</summary>
public sealed record OccCharterAirlineData(Guid Id, string IcaoCode, string? IataCode, string Name);

/// <summary>
/// Reschedule, cancellation and diversion of a turnaround before its operation starts, and the minimal charter carrier
/// (3-A, 3-N21). Every command takes an Idempotency-Key (<c>idempotency_key_required</c>) and, except the carrier, the
/// version OCC saw (<c>expected_version_required</c>, stale: <c>version_conflict</c>). Nothing is deleted: a cancelled
/// or diverted flight keeps its history, its stand and agents are released.
/// </summary>
public interface IOccTurnaroundStore
{
    /// <summary>
    /// The turnaround and its version; needs Planificación «Ver», or the positions map's «Registrar llegadas y asignar o
    /// liberar posiciones» whose commands send that version (3-N10), and the station in scope.
    /// </summary>
    Task<MasterDataResult<OccTurnaroundDetailData>> ReadAsync(Guid actorId, Guid turnaroundId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Corrects numbers, airports, times, stand and aircraft type before the start; needs «Reprogramar». A number or day
    /// another open turnaround of the airline already flies is <c>flight_already_planned</c> (3-N07).
    /// </summary>
    Task<MasterDataResult<OccTurnaroundDetailData>> RescheduleAsync(Guid actorId, Guid turnaroundId,
        RescheduleTurnaroundInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default);

    /// <summary>Cancels or diverts the flight before the start, freeing its stand and agents; needs «Reprogramar».</summary>
    Task<MasterDataResult<OccTurnaroundDetailData>> ChangeStatusAsync(Guid actorId, Guid turnaroundId,
        TurnaroundStatusChangeInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default);

    /// <summary>Registers a carrier without contract for a charter; needs «Crear escalas».</summary>
    Task<MasterDataResult<OccCharterAirlineData>> CreateCharterAirlineAsync(Guid actorId, CharterAirlineInput input,
        Guid? idempotencyKey, CancellationToken cancellationToken = default);
}
