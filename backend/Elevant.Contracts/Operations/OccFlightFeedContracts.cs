using System.Text.Json.Serialization;

namespace Elevant.Contracts.Operations;

/// <summary>
/// Units spent and limits of the flight feed (ADR-0028). <paramref name="PauseReason"/> is a code
/// (<c>quota_exceeded</c>, <c>unauthorized</c>, <c>rate_limited</c>, <c>failed_&lt;status&gt;</c>) the screens translate.
/// </summary>
public sealed record OccFlightFeedBudgetResponse(bool Configured, string Provider, int UnitsToday, int DailyUnits,
    int UnitsThisMonth, int MonthlyUnits, DateTimeOffset? PausedUntil, string? PauseReason);

/// <summary>
/// A leg the provider reported for a registered airline. <paramref name="Version"/> is the rowversion in base64
/// (the expected version of an import or a restore); <paramref name="SuggestedAircraftTypeId"/> is the active
/// aircraft type the provider's model matches (2-B). <paramref name="IsDemo"/> is true for a leg of a demo flight
/// (ADR-0041) and absent otherwise: the key is written only when true, so a client deployed before it keeps
/// validating every list without a demo flight.
/// </summary>
public sealed record OccFlightProposalResponse(Guid ProposalId, string Direction, string FlightNumber, Guid AirlineId,
    string AirlineName, string? AirlineIataCode, string? CounterpartIata, string? CounterpartName, bool CounterpartKnown,
    DateTimeOffset ScheduledAt, DateTimeOffset? RevisedAt, DateTimeOffset? RunwayAt, string ProviderStatus,
    string? AircraftRegistration, string? AircraftModel, string? Terminal, string? Gate, string Status,
    Guid? TurnaroundId, Guid? SuggestedDepartureId, DateTimeOffset LastSeenAt, string Version,
    Guid? SuggestedAircraftTypeId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? IsDemo = null);

public sealed record OccFlightFeedResponse(Guid StationId, string StationCode, DateOnly Date, OccFlightFeedBudgetResponse Budget,
    DateTimeOffset? LastReadAt, DateTimeOffset? NextManualRefreshAt, bool CanImport,
    IReadOnlyList<OccFlightProposalResponse> Proposals);

public sealed record RefreshOccFlightFeedRequest(Guid StationId);

/// <summary>
/// <paramref name="Status"/>: Refreshed, Reused, Throttled, BudgetExhausted, Paused, NotConfigured,
/// NoContracts, Busy or Failed.
/// </summary>
public sealed record RefreshOccFlightFeedResponse(string Status, DateTimeOffset? RetryAt, int? FlightsReceived,
    int? ContractedLegs, int? NewProposals);

/// <summary>
/// «Importar escala» (2-B): the pair and, optionally, the aircraft type, the stand and the charter mode of a
/// carrier without contract (ADR-0033). With an Idempotency-Key both expected versions are required.
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ImportOccFlightRequest(Guid ArrivalProposalId, Guid DepartureProposalId, Guid? AircraftTypeId = null,
    Guid? StandId = null, bool? Charter = null, string? ExpectedArrivalVersion = null, string? ExpectedDepartureVersion = null);

/// <summary>
/// The turnaround of the imported pair. <paramref name="Linked"/> is true when the pair joined the turnaround OCC had
/// already planned for the same airline, flight number and local day instead of creating another one (3-N07).
/// </summary>
/// <param name="TurnaroundId">The turnaround of the pair.</param>
/// <param name="OperationCode">Its operation code.</param>
/// <param name="Replayed">An Idempotency-Key replayed the first result.</param>
/// <param name="Linked">The pair joined an existing turnaround.</param>
public sealed record ImportOccFlightResponse(Guid TurnaroundId, string OperationCode, bool Replayed, bool Linked = false);

/// <summary>«Restaurar» a dismissed proposal with the version OCC saw (2-N36).</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record RestoreOccFlightProposalRequest(string? ExpectedVersion);

/// <summary>
/// «Descartar» a proposal with the version OCC saw (2-N36). Optional while older screens send no body (expand);
/// required with an Idempotency-Key.
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record DismissOccFlightProposalRequest(string? ExpectedVersion);

/// <summary>The restored proposal, back in the review, and its new version.</summary>
public sealed record RestoreOccFlightProposalResponse(Guid ProposalId, string Status, string Version, bool Replayed);
