namespace Elevant.Application.Abstractions.Commercial;

/// <summary>
/// A permit of the airline dossier (ADR-0024). <see cref="Validity"/> is Current, Expiring
/// (30 days or less) or Expired; <see cref="Review"/> is Submitted, Verified, Rejected or Revoked.
/// <see cref="ReviewNote"/> and <see cref="ReviewedAt"/> are the verification or the rejection, which a
/// revocation keeps (2-N09); <see cref="RevokedAt"/> and <see cref="RevocationReason"/> (also read by the
/// airline) are set only on a revoked permit. <see cref="Version"/> is the rowversion in base64, the expected
/// version of the next command.
/// </summary>
public record AirlinePermitData(Guid Id, Guid AirlineId, string Airline, string Kind, string Number,
    string Issuer, DateOnly IssuedOn, DateOnly ExpiresOn, string Validity, string Review, string? ReviewNote,
    string? DocumentUrl, DateTimeOffset SubmittedAt, DateTimeOffset? ReviewedAt, string Version,
    DateTimeOffset? RevokedAt = null, string? RevocationReason = null);

/// <summary>A contract whose status a permit command changed: activated, resumed or suspended (2-N30).</summary>
public sealed record AirlinePermitContractChange(Guid ContractId, string ContractCode, string Status);

/// <summary>
/// The permit after a review or a revocation (2-N09, 2-N30), with the contracts that command activated,
/// resumed or suspended: the screen tells Contratos what really happened instead of a fixed promise. A
/// replay answers the same contracts.
/// </summary>
public sealed record AirlinePermitDecisionData : AirlinePermitData
{
    public AirlinePermitDecisionData(AirlinePermitData permit, IReadOnlyList<AirlinePermitContractChange> contracts)
        : base(permit) => Contracts = contracts;

    public IReadOnlyList<AirlinePermitContractChange> Contracts { get; init; }
}

public sealed record SubmitAirlinePermitInput(string Kind, string Number, string Issuer, DateOnly IssuedOn,
    DateOnly ExpiresOn, string? DocumentUrl);

/// <summary>Contratos verifies or rejects a submitted permit with the version it saw; a rejection needs a note.</summary>
public sealed record ReviewAirlinePermitInput(bool Verified, string? Note, string ExpectedVersion);

/// <summary>Contratos revokes a verified permit with a reason (5 to 500 characters) and the version it saw (2-N09).</summary>
public sealed record RevokeAirlinePermitInput(string Reason, string ExpectedVersion);

public enum AirlinePermitFailure { Forbidden, NotFound, Invalid, Conflict }

public sealed record AirlinePermitResult(AirlinePermitData? Permit, AirlinePermitFailure? Failure, string? Code = null)
{
    public static AirlinePermitResult Success(AirlinePermitData permit) => new(permit, null);
    public static AirlinePermitResult Failed(AirlinePermitFailure failure, string? code = null) => new(null, failure, code);
}

public interface IAirlinePermitStore
{
    /// <summary>Permits of the portal user's own airline; null when the caller is not an airline user.</summary>
    Task<IReadOnlyList<AirlinePermitData>?> ListForAirlineAsync(Guid actorId, CancellationToken cancellationToken = default);

    /// <summary>
    /// The airline submits a permit. The Idempotency-Key is optional while older portals exist (expand); with
    /// it a retry answers the permit the first attempt created instead of a duplicate (2-N09).
    /// </summary>
    Task<AirlinePermitResult> SubmitAsync(Guid actorId, SubmitAirlinePermitInput input, Guid? idempotencyKey,
        CancellationToken cancellationToken = default);

    /// <summary>Every permit for Contratos (<c>contracts.permits.read</c>), optionally one review state.</summary>
    Task<IReadOnlyList<AirlinePermitData>?> ListForContractsAsync(Guid actorId, string? review,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Contratos verifies or rejects a submitted permit (<c>review_closed</c> otherwise). The Idempotency-Key is
    /// optional while older clients exist (expand). A verified operating permit activates or resumes the
    /// contracts that waited for it; a rejection queues the email with the note (2-N13).
    /// </summary>
    Task<AirlinePermitResult> ReviewAsync(Guid actorId, Guid permitId, ReviewAirlinePermitInput input, Guid? idempotencyKey,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Contratos revokes a verified permit with a reason (<c>contracts.permits.verify</c>, 2-N09). In the same
    /// transaction the active contracts left without a usable operating permit are suspended, and the airline
    /// is emailed; verifying a new operating permit resumes them.
    /// </summary>
    Task<AirlinePermitResult> RevokeAsync(Guid actorId, Guid permitId, RevokeAirlinePermitInput input, Guid idempotencyKey,
        CancellationToken cancellationToken = default);
}

/// <summary>One dated step of a contract's history, oldest first.</summary>
public sealed record ContractTimelineEntry(DateTimeOffset At, string Kind, string Title, string? Detail, string? Actor);

/// <summary>History of a contract and what its termination looks like today (2-N14).</summary>
/// <param name="ContractId">The contract.</param>
/// <param name="ContractCode">Its code, final once Contratos confirmed the validity.</param>
/// <param name="Status">Draft, Active, Suspended, Terminated or Expired.</param>
/// <param name="Entries">Dated steps, oldest first; the upcoming ones close the list.</param>
/// <param name="TerminatesOn">
/// A termination scheduled for a later date: the contract's first day without coverage. Null when none is
/// scheduled, and once the contract is terminated.
/// </param>
/// <param name="EarliestTerminationOn">
/// For an active or suspended contract without a scheduled termination, the earliest effective date a
/// termination with notice may take: today plus the notice days the version in force signed.
/// </param>
public sealed record ContractTimelineData(Guid ContractId, string ContractCode, string Status,
    IReadOnlyList<ContractTimelineEntry> Entries, DateOnly? TerminatesOn = null, DateOnly? EarliestTerminationOn = null);

/// <summary>A manual lifecycle action of Contratos with the status the user saw (the expected version).</summary>
/// <param name="Action">Suspend, Reactivate, Terminate, CancelTermination or Renew.</param>
/// <param name="Reason">Why, 5 to 500 characters; kept in the history.</param>
/// <param name="ExpectedStatus">The contract status on screen; another one answers 409 <c>status_changed</c>.</param>
/// <param name="ValidFrom">Start of the renewal.</param>
/// <param name="ValidTo">End of the renewal, optional.</param>
/// <param name="EffectiveOn">
/// Termination of an active or suspended contract (2-N14): its first day without coverage, at least
/// today plus the notice days of the version in force.
/// </param>
/// <param name="ImmediateCause">
/// Instead of a date, an explicit cause that ends the contract at once: <c>Breach</c> or
/// <c>MutualAgreement</c>; the reason is its note.
/// </param>
public sealed record ContractLifecycleInput(string Action, string Reason, string ExpectedStatus,
    DateOnly? ValidFrom = null, DateOnly? ValidTo = null, DateOnly? EffectiveOn = null, string? ImmediateCause = null);

public enum ContractLifecycleFailure { Forbidden, NotFound, Invalid, Conflict }

/// <summary>Outcome of a manual action; a renewal returns the new draft version.</summary>
public sealed record ContractLifecycleResult(string? Status, Guid? DraftVersionId, ContractLifecycleFailure? Failure,
    string? Code = null)
{
    public static ContractLifecycleResult Failed(ContractLifecycleFailure failure, string? code = null) =>
        new(null, null, failure, code);
}

/// <summary>
/// Counts of one sweep, for logs and tests: <see cref="Terminated"/> are scheduled terminations that took
/// effect (2-N14), <see cref="RenewalsBlocked"/> automatic renewals that could not start and will be
/// retried (2-N27).
/// </summary>
public sealed record ContractLifecycleSweep(int Activated, int Expired, int Suspended, int PermitNotices, int ContractNotices,
    int Terminated = 0, int RenewalsBlocked = 0);

public interface IContractLifecycleStore
{
    /// <summary>History of the contract of a version, for Contratos readers and the owning airline.</summary>
    Task<ContractTimelineData?> TimelineAsync(Guid actorId, Guid versionId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Suspend, reactivate, terminate (also a contract that never activated, 1-B; now or after the signed
    /// notice, 2-N14), cancel a scheduled termination or renew, with a reason and the status the user saw
    /// (<c>contracts.agreements.lifecycle</c>). The Idempotency-Key is optional while older clients exist
    /// (expand); with it a retry replays the first result.
    /// </summary>
    Task<ContractLifecycleResult> ApplyAsync(Guid actorId, Guid versionId, ContractLifecycleInput input,
        Guid? idempotencyKey, CancellationToken cancellationToken = default);

    /// <summary>Daily rules: activate signed contracts, expire old ones, suspend on expired permits, send notices.</summary>
    Task<ContractLifecycleSweep> SweepAsync(CancellationToken cancellationToken = default);
}
