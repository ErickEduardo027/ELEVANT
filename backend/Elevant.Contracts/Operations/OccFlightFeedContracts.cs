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
/// aircraft type the provider's model matches (2-B).
/// </summary>
public sealed record OccFlightProposalResponse(Guid ProposalId, string Direction, string FlightNumber, Guid AirlineId,
    string AirlineName, string? AirlineIataCode, string? CounterpartIata, string? CounterpartName, bool CounterpartKnown,
    DateTimeOffset ScheduledAt, DateTimeOffset? RevisedAt, DateTimeOffset? RunwayAt, string ProviderStatus,
    string? AircraftRegistration, string? AircraftModel, string? Terminal, string? Gate, string Status,
    Guid? TurnaroundId, Guid? SuggestedDepartureId, DateTimeOffset LastSeenAt, string Version,
    Guid? SuggestedAircraftTypeId);

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

public sealed record ImportOccFlightResponse(Guid TurnaroundId, string OperationCode, bool Replayed);

/// <summary>«Restaurar» a dismissed proposal with the version OCC saw (2-N36).</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record RestoreOccFlightProposalRequest(string? ExpectedVersion);

/// <summary>The restored proposal, back in the review, and its new version.</summary>
public sealed record RestoreOccFlightProposalResponse(Guid ProposalId, string Status, string Version, bool Replayed);
