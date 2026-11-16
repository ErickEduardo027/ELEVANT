namespace Elevant.Application.Abstractions.Commercial;

public sealed record ContractDraftRateData(Guid Id, string ServiceName,
    string BillingUnit, decimal UnitPrice, decimal MinimumQuantity,
    bool IsConfirmed, decimal? BasePrice = null, decimal? BaseMinimum = null);
public sealed record ContractDraftChargeData(Guid ChargeId, string Code, string Name, string Method,
    decimal? BaseValue, bool IsExcluded, decimal? Value);
public sealed record ContractDraftCommentData(Guid Id, string Author,
    string Body, DateTimeOffset At, bool IsAirline);
/// <summary>
/// A draft or a version awaiting Finance. For the airline portal the Finance base prices, the base
/// charge values and the internal reason of a Finance return are null (1-N05); the shape is the same.
/// </summary>
public sealed record ContractDraftData(Guid Id, Guid ContractId,
    string ContractCode, string Airline, string Status,
    DateOnly ValidFrom, DateOnly? ValidTo, string CurrencyCode,
    string? Terms, IReadOnlyList<string> Stations,
    IReadOnlyList<ContractDraftRateData> Rates,
    IReadOnlyList<ContractDraftCommentData> Comments,
    string VersionStatus = "Draft", string? FinanceDecision = null, string? FinanceReason = null,
    IReadOnlyList<ContractDraftChargeData>? Charges = null, string Version = "");
public sealed record ContractDraftOverviewItemData(Guid Id, string ContractCode, string Airline);
public sealed record ContractDraftOverviewData(int Count,
    IReadOnlyList<ContractDraftOverviewItemData> Recent);
public sealed record UpdateDraftRateInput(Guid Id, string BillingUnit,
    decimal UnitPrice, decimal MinimumQuantity, bool IsConfirmed = false);
/// <summary>
/// Saves a draft. <paramref name="ExpectedVersion"/> is the version rowversion the editor saw; it is
/// optional while older clients exist (expand) and required with an Idempotency-Key.
/// </summary>
public sealed record UpdateContractDraftInput(DateOnly ValidFrom,
    DateOnly? ValidTo, string CurrencyCode, string Terms,
    IReadOnlyList<UpdateDraftRateInput> Rates,
    IReadOnlyList<UpdateDraftChargeInput>? ChargeRates = null,
    string? ExpectedVersion = null);
public sealed record UpdateDraftChargeInput(Guid ChargeId, bool IsExcluded, decimal? Value);

/// <summary>Body of «Enviar a Finanzas»: the version the reviewer saw (optional while older clients exist).</summary>
public sealed record SubmitContractDraftInput(string? ExpectedVersion = null);

/// <summary>An airline observation on its draft; the version is optional while older portals exist.</summary>
public sealed record AirlineDraftCommentInput(string Body, string? ExpectedVersion = null);

/// <summary>Contratos answers the airline on the draft (1-N15).</summary>
public sealed record ReplyContractDraftInput(string ExpectedVersion, string Body);

/// <summary>Discards a draft or a version awaiting Finance with a reason (1-B); nothing is deleted.</summary>
public sealed record DiscardContractDraftInput(string ExpectedVersion, string Reason);

/// <summary>
/// The services and stations of a draft version (1-N04). Services that stay keep their rates; new
/// ones start from the Finance base tariff unconfirmed; only active catalog services can be added.
/// </summary>
public sealed record SetContractDraftScopeInput(string ExpectedVersion, IReadOnlyList<Guid> ServiceIds,
    IReadOnlyList<Guid> StationIds);

/// <summary>One reason the draft cannot go to Finance yet, with the services or packages it names.</summary>
public sealed record ContractDraftIssueData(string Code, IReadOnlyList<string> Subjects);

/// <summary>
/// Whether the draft can go to Finance (1-D, 1-N14): <paramref name="PortalAccount"/> is
/// <c>Missing</c>, <c>Invited</c> or <c>Active</c>, and <paramref name="Issues"/> lists every blocking
/// cause in a fixed order with the same codes the submission answers.
/// </summary>
public sealed record ContractDraftReadinessData(Guid VersionId, string Version, string VersionStatus, bool Ready,
    string PortalAccount, IReadOnlyList<ContractDraftIssueData> Issues);

/// <summary>A catalog service for the draft: in the draft (with its rate) or available to add.</summary>
public sealed record ContractDraftScopeServiceData(Guid ServiceId, string Code, string Name, bool IsActive,
    bool Selected, Guid? RateId, bool CoveredByPackage);

public sealed record ContractDraftScopeStationData(Guid StationId, string Code, string Name, bool IsActive,
    bool Selected);

/// <summary>The services and stations a draft has and may have; retired services stay marked inactive.</summary>
public sealed record ContractDraftScopeData(Guid VersionId, string Version, string VersionStatus,
    IReadOnlyList<ContractDraftScopeServiceData> Services, IReadOnlyList<ContractDraftScopeStationData> Stations);

public enum ContractDraftFailure { Forbidden, NotFound, Conflict, Invalid }

/// <summary>Outcome of a draft command; <paramref name="Code"/> is the stable Problem Details code of a failure.</summary>
public sealed record ContractDraftResult(Guid? Id, ContractDraftFailure? Failure, string? Code = null)
{
    public bool IsSuccess => Id is not null;
    public static ContractDraftResult Success(Guid id) => new(id, null);
    public static ContractDraftResult Failed(ContractDraftFailure failure, string? code = null) => new(null, failure, code);
}

/// <summary>A draft read that tells a missing version from a caller without permission.</summary>
public sealed record ContractDraftQuery<T>(T? Data, ContractDraftFailure? Failure) where T : class;

public static class ContractDraftQuery
{
    public static ContractDraftQuery<T> Found<T>(T data) where T : class => new(data, null);
    public static ContractDraftQuery<T> Failed<T>(ContractDraftFailure failure) where T : class => new(null, failure);
}

public interface IContractDraftStore
{
    Task<ContractDraftOverviewData?> GetOverviewForContractsAsync(Guid actorId,
        CancellationToken cancellationToken = default);
    Task<IReadOnlyList<ContractDraftData>?> ListForAirlineAsync(Guid actorId,
        CancellationToken cancellationToken = default);
    Task<IReadOnlyList<ContractDraftData>?> ListForContractsAsync(Guid actorId,
        CancellationToken cancellationToken = default);

    /// <summary>The airline comments its draft, also while Finance reviews it (1-N15).</summary>
    Task<ContractDraftResult> AddAirlineCommentAsync(Guid actorId, Guid versionId,
        AirlineDraftCommentInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default);

    /// <summary>Contratos answers on the draft; the airline sees it in its portal (1-N15).</summary>
    Task<ContractDraftResult> ReplyAsync(Guid actorId, Guid versionId, Guid idempotencyKey,
        ReplyContractDraftInput input, CancellationToken cancellationToken = default);

    /// <summary>Saves terms, validity, currency, rates and charges (1-D, 1-N07).</summary>
    Task<ContractDraftResult> UpdateAsync(Guid actorId, Guid versionId,
        UpdateContractDraftInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default);

    /// <summary>Sends the draft to Finance when every readiness rule holds; answers the contract.</summary>
    Task<ContractDraftResult> ActivateAsync(Guid actorId, Guid versionId,
        SubmitContractDraftInput? input, Guid? idempotencyKey, CancellationToken cancellationToken = default);

    /// <summary>Whether the draft can go to Finance and why not, with the portal account status.</summary>
    Task<ContractDraftQuery<ContractDraftReadinessData>> GetReadinessAsync(Guid actorId, Guid versionId,
        CancellationToken cancellationToken = default);

    /// <summary>The services and stations of a draft and the ones that may be added.</summary>
    Task<ContractDraftQuery<ContractDraftScopeData>> GetScopeAsync(Guid actorId, Guid versionId,
        CancellationToken cancellationToken = default);

    /// <summary>Adds and removes services and sets the stations of a draft version (1-N04, 1-N10).</summary>
    Task<ContractDraftResult> SetScopeAsync(Guid actorId, Guid versionId, Guid idempotencyKey,
        SetContractDraftScopeInput input, CancellationToken cancellationToken = default);

    /// <summary>
    /// Discards a draft or a version awaiting Finance (it becomes Rejected). When it was the only live
    /// version of a contract that never activated, the contract is terminated too (1-B).
    /// </summary>
    Task<ContractDraftResult> DiscardAsync(Guid actorId, Guid versionId, Guid idempotencyKey,
        DiscardContractDraftInput input, CancellationToken cancellationToken = default);
}
