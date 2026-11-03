namespace Elevant.Contracts.Operations;

/// <summary>Units spent and limits of the paid flight feed (ADR-0028).</summary>
public sealed record OccFlightFeedBudgetResponse(bool Configured, string Provider, int UnitsToday, int DailyUnits,
    int UnitsThisMonth, int MonthlyUnits, DateTimeOffset? PausedUntil, string? PauseReason);

/// <summary>A leg the provider reported for a contracted airline.</summary>
public sealed record OccFlightProposalResponse(Guid ProposalId, string Direction, string FlightNumber, Guid AirlineId,
    string AirlineName, string? AirlineIataCode, string? CounterpartIata, string? CounterpartName, bool CounterpartKnown,
    DateTimeOffset ScheduledAt, DateTimeOffset? RevisedAt, DateTimeOffset? RunwayAt, string ProviderStatus,
    string? AircraftRegistration, string? AircraftModel, string? Terminal, string? Gate, string Status,
    Guid? TurnaroundId, Guid? SuggestedDepartureId, DateTimeOffset LastSeenAt);

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

public sealed record ImportOccFlightRequest(Guid ArrivalProposalId, Guid DepartureProposalId);

public sealed record ImportOccFlightResponse(Guid TurnaroundId, string OperationCode, bool Replayed);
