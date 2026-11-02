namespace Elevant.Application.Abstractions.Commercial;

/// <summary>
/// A permit of the airline dossier (ADR-0024). <see cref="Validity"/> is Current, Expiring
/// (30 days or less) or Expired; <see cref="Review"/> is Submitted, Verified or Rejected.
/// </summary>
public sealed record AirlinePermitData(Guid Id, Guid AirlineId, string Airline, string Kind, string Number,
    string Issuer, DateOnly IssuedOn, DateOnly ExpiresOn, string Validity, string Review, string? ReviewNote,
    string? DocumentUrl, DateTimeOffset SubmittedAt, DateTimeOffset? ReviewedAt, string Version);

public sealed record SubmitAirlinePermitInput(string Kind, string Number, string Issuer, DateOnly IssuedOn,
    DateOnly ExpiresOn, string? DocumentUrl);

/// <summary>Contratos verifies or rejects a permit; a rejection needs a note.</summary>
public sealed record ReviewAirlinePermitInput(bool Verified, string? Note, string ExpectedVersion);

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

    Task<AirlinePermitResult> SubmitAsync(Guid actorId, SubmitAirlinePermitInput input,
        CancellationToken cancellationToken = default);

    /// <summary>Every permit for Contratos (<c>contracts.permits.read</c>), optionally one review state.</summary>
    Task<IReadOnlyList<AirlinePermitData>?> ListForContractsAsync(Guid actorId, string? review,
        CancellationToken cancellationToken = default);

    Task<AirlinePermitResult> ReviewAsync(Guid actorId, Guid permitId, ReviewAirlinePermitInput input,
        CancellationToken cancellationToken = default);
}

/// <summary>One dated step of a contract's history, oldest first.</summary>
public sealed record ContractTimelineEntry(DateTimeOffset At, string Kind, string Title, string? Detail, string? Actor);

public sealed record ContractTimelineData(Guid ContractId, string ContractCode, string Status,
    IReadOnlyList<ContractTimelineEntry> Entries);

public sealed record ContractLifecycleInput(string Action, string Reason, string ExpectedStatus,
    DateOnly? ValidFrom = null, DateOnly? ValidTo = null);

public enum ContractLifecycleFailure { Forbidden, NotFound, Invalid, Conflict }

/// <summary>Outcome of a manual action; a renewal returns the new draft version.</summary>
public sealed record ContractLifecycleResult(string? Status, Guid? DraftVersionId, ContractLifecycleFailure? Failure,
    string? Code = null)
{
    public static ContractLifecycleResult Failed(ContractLifecycleFailure failure, string? code = null) =>
        new(null, null, failure, code);
}

/// <summary>Counts of one sweep, for logs and tests.</summary>
public sealed record ContractLifecycleSweep(int Activated, int Expired, int Suspended, int PermitNotices, int ContractNotices);

public interface IContractLifecycleStore
{
    /// <summary>History of the contract of a version, for Contratos readers and the owning airline.</summary>
    Task<ContractTimelineData?> TimelineAsync(Guid actorId, Guid versionId, CancellationToken cancellationToken = default);

    /// <summary>Suspend, reactivate, terminate or renew, with a reason (<c>contracts.agreements.lifecycle</c>).</summary>
    Task<ContractLifecycleResult> ApplyAsync(Guid actorId, Guid versionId, ContractLifecycleInput input,
        CancellationToken cancellationToken = default);

    /// <summary>Daily rules: activate signed contracts, expire old ones, suspend on expired permits, send notices.</summary>
    Task<ContractLifecycleSweep> SweepAsync(CancellationToken cancellationToken = default);
}
