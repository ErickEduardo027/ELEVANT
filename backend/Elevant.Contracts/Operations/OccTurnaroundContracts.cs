using System.Text.Json.Serialization;

namespace Elevant.Contracts.Operations;

/// <summary>
/// One turnaround as OCC edits it from Planificación (3-A). <paramref name="Version"/> is also the strong ETag every
/// change sends back in If-Match; <paramref name="AllowedActions"/> (<c>reschedule</c>, <c>cancel</c>, <c>divert</c>,
/// <c>correctArrival</c>) are the changes the screen may offer now; the server checks them again.
/// </summary>
/// <param name="Station">The station of the turnaround and its IANA time zone.</param>
/// <param name="Turnaround">The turnaround as the planning snapshot shows it.</param>
/// <param name="Version">The turnaround's version (rowversion in base64).</param>
/// <param name="IsCharter">A flight without contract (ADR-0033).</param>
/// <param name="AllowedActions">The changes the current state allows.</param>
public sealed record OccTurnaroundDetailResponse(OccStationResponse Station, OccTurnaroundResponse Turnaround,
    string Version, bool IsCharter, IReadOnlyList<string> AllowedActions);

/// <summary>
/// «Editar vuelo» (3-A): numbers, airports and UTC times of both legs, and the reason. A null stand or aircraft type
/// keeps the current one; the airline never changes. Sent with an Idempotency-Key and the turnaround's ETag in If-Match.
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record RescheduleOccTurnaroundRequest(string? ArrivalFlightNumber, string? ArrivalOriginIata,
    DateTimeOffset? ArrivalScheduledAt, string? DepartureFlightNumber, string? DepartureDestinationIata,
    DateTimeOffset? DepartureScheduledAt, Guid? StandId = null, Guid? AircraftTypeId = null, string? Reason = null);

/// <summary>
/// «Cancelar vuelo» (<c>Cancelled</c>) or «Marcar desviado» (<c>Diverted</c>) before the operation starts, with the
/// reason (5 to 500 characters), an Idempotency-Key and the turnaround's ETag in If-Match.
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ChangeOccTurnaroundStatusRequest(string? Outcome, string? Reason);

/// <summary>
/// A carrier without contract OCC registers to plan its charter (3-N21): name, three-letter ICAO designator and an
/// optional IATA one. Contratos completes it when a commercial request with the same codes is approved.
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CreateOccCharterAirlineRequest(string? Name, string? IcaoCode, string? IataCode = null);

/// <summary>The carrier OCC created; it appears among the charter airlines of «Nuevo vuelo».</summary>
public sealed record OccCharterAirlineResponse(Guid Id, string IcaoCode, string? IataCode, string Name);
