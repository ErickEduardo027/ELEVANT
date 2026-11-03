namespace Elevant.Application.Abstractions.Operations;

/// <summary>Units spent and limits of the paid flight feed; prices are not involved.</summary>
public sealed record OccFlightFeedBudgetData(bool Configured, string Provider, int UnitsToday, int DailyUnits,
    int UnitsThisMonth, int MonthlyUnits, DateTimeOffset? PausedUntil, string? PauseReason);

/// <summary>A leg the provider reported for a contracted airline (ADR-0028).</summary>
/// <param name="SuggestedDepartureId">For an arrival, the departure it most likely turns into.</param>
public sealed record OccFlightProposalData(Guid ProposalId, string Direction, string FlightNumber, Guid AirlineId,
    string AirlineName, string? AirlineIataCode, string? CounterpartIata, string? CounterpartName, bool CounterpartKnown,
    DateTimeOffset ScheduledAt, DateTimeOffset? RevisedAt, DateTimeOffset? RunwayAt, string ProviderStatus,
    string? AircraftRegistration, string? AircraftModel, string? Terminal, string? Gate, string Status,
    Guid? TurnaroundId, Guid? SuggestedDepartureId, DateTimeOffset LastSeenAt);

public sealed record OccFlightFeedData(Guid StationId, string StationCode, DateOnly Date, OccFlightFeedBudgetData Budget,
    DateTimeOffset? LastReadAt, DateTimeOffset? NextManualRefreshAt, bool CanImport,
    IReadOnlyList<OccFlightProposalData> Proposals);

public enum OccFlightFeedFailure
{
    Forbidden,
    NotFound,
    Conflict,
    CounterpartUnknown,
}

public sealed record OccFlightImportResult(Guid? TurnaroundId, string? OperationCode, OccFlightFeedFailure? Failure,
    bool Replayed = false);

/// <summary>OCC review of the provider's proposed flights (ADR-0028).</summary>
public interface IOccFlightFeedStore
{
    /// <summary>Null when the actor lacks Planificación «Ver» or the station is out of scope.</summary>
    Task<OccFlightFeedData?> ListAsync(Guid actorId, Guid stationId, DateOnly date,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Creates the turnaround of an arrival and its departure («Crear escalas»), with the contract
    /// version that covers it. Confirming the same pair again returns the same turnaround.
    /// </summary>
    Task<OccFlightImportResult> ImportAsync(Guid actorId, Guid arrivalProposalId, Guid departureProposalId,
        CancellationToken cancellationToken = default);

    /// <summary>Hides a proposal OCC will not operate; later reads do not bring it back.</summary>
    Task<OccFlightFeedFailure?> DismissAsync(Guid actorId, Guid proposalId, CancellationToken cancellationToken = default);
}
