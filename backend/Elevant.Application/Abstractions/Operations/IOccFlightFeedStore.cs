namespace Elevant.Application.Abstractions.Operations;

/// <summary>Units spent and limits of the paid flight feed; prices are not involved.</summary>
public sealed record OccFlightFeedBudgetData(bool Configured, string Provider, int UnitsToday, int DailyUnits,
    int UnitsThisMonth, int MonthlyUnits, DateTimeOffset? PausedUntil, string? PauseReason);

/// <summary>A leg the provider reported for a registered airline (ADR-0028, 2-B).</summary>
/// <param name="SuggestedDepartureId">For an arrival, the departure it most likely turns into.</param>
/// <param name="Version">Rowversion in base64: the expected version of an import or a restore.</param>
/// <param name="SuggestedAircraftTypeId">The active aircraft type the provider's model matches, if any.</param>
public sealed record OccFlightProposalData(Guid ProposalId, string Direction, string FlightNumber, Guid AirlineId,
    string AirlineName, string? AirlineIataCode, string? CounterpartIata, string? CounterpartName, bool CounterpartKnown,
    DateTimeOffset ScheduledAt, DateTimeOffset? RevisedAt, DateTimeOffset? RunwayAt, string ProviderStatus,
    string? AircraftRegistration, string? AircraftModel, string? Terminal, string? Gate, string Status,
    Guid? TurnaroundId, Guid? SuggestedDepartureId, DateTimeOffset LastSeenAt, string Version,
    Guid? SuggestedAircraftTypeId);

public sealed record OccFlightFeedData(Guid StationId, string StationCode, DateOnly Date, OccFlightFeedBudgetData Budget,
    DateTimeOffset? LastReadAt, DateTimeOffset? NextManualRefreshAt, bool CanImport,
    IReadOnlyList<OccFlightProposalData> Proposals);

/// <summary>
/// Which proposals OCC reviews (2-B, 2-N16, 2-N36): those of airlines with a contract in force that day
/// (the default), those of airlines without one that can only fly as a charter («Charter sin contrato»), or
/// the dismissed ones. Airlines whose contract at the station is suspended or expired appear in none.
/// </summary>
public enum OccFlightFeedView { Contracted, Charter, Dismissed }

public enum OccFlightFeedFailure
{
    Forbidden,
    NotFound,
    Conflict,
    CounterpartUnknown,
    Invalid,
}

/// <summary>
/// «Importar escala»: the pair, and optionally the aircraft type (suggested from the provider's model), the
/// stand and the charter mode (ADR-0033) of the new turnaround. The expected versions are required with an
/// Idempotency-Key.
/// </summary>
public sealed record OccFlightImportInput(Guid ArrivalProposalId, Guid DepartureProposalId, Guid? AircraftTypeId = null,
    Guid? StandId = null, bool Charter = false, string? ExpectedArrivalVersion = null,
    string? ExpectedDepartureVersion = null);

/// <summary>
/// The imported turnaround, or the failure with its stable Problem Details code and, for a refused stand, the rules
/// it breaks (ADR-0030). <see cref="Linked"/> means the pair joined the turnaround OCC had already planned for the same
/// airline, flight number and local day (3-N07) instead of creating another one.
/// </summary>
public sealed record OccFlightImportResult(Guid? TurnaroundId, string? OperationCode, OccFlightFeedFailure? Failure,
    bool Replayed = false, string? Code = null, IReadOnlyList<string>? Reasons = null, bool Linked = false);

/// <summary>A dismissed proposal OCC brought back (2-N36), with its new version.</summary>
public sealed record OccFlightProposalRestoreResult(Guid? ProposalId, string? Version, OccFlightFeedFailure? Failure,
    string? Code = null, bool Replayed = false);

/// <summary>OCC review of the provider's proposed flights (ADR-0028).</summary>
public interface IOccFlightFeedStore
{
    /// <summary>Null when the actor lacks Planificación «Ver» or the station is out of scope.</summary>
    Task<OccFlightFeedData?> ListAsync(Guid actorId, Guid stationId, DateOnly date,
        OccFlightFeedView view = OccFlightFeedView.Contracted, CancellationToken cancellationToken = default);

    /// <summary>
    /// Creates the turnaround of an arrival and its departure («Crear escalas») with the contract version
    /// that covers it, or as a charter without contract. Without an Idempotency-Key confirming the same pair
    /// again returns the same turnaround; with one, a retry replays the first result.
    /// </summary>
    Task<OccFlightImportResult> ImportAsync(Guid actorId, OccFlightImportInput input, Guid? idempotencyKey,
        CancellationToken cancellationToken = default);

    /// <summary>Hides a proposal OCC will not operate; later reads do not bring it back.</summary>
    Task<OccFlightFeedFailure?> DismissAsync(Guid actorId, Guid proposalId, CancellationToken cancellationToken = default);

    /// <summary>Brings a dismissed proposal back to the review while its flight has not passed (2-N36).</summary>
    Task<OccFlightProposalRestoreResult> RestoreAsync(Guid actorId, Guid proposalId, string? expectedVersion,
        Guid idempotencyKey, CancellationToken cancellationToken = default);
}
