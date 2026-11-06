namespace Elevant.Application.Abstractions.Finance;

public sealed record PackageComponentInput(Guid ServiceId, string BillingUnit, decimal IncludedQuantity, decimal ExcessBlockSize, decimal ExcessBlockPrice);
public sealed record SavePackageInput(Guid RequestId, string Code, string Name, string CurrencyCode, decimal BasePrice,
    string Scope, string? FlightDirection, int? PeriodDays, DateOnly ValidFrom, DateOnly? ValidTo,
    IReadOnlyList<PackageComponentInput> Components, string? ExpectedVersion);
public sealed record PackageComponentData(Guid ServiceId, string ServiceCode, string ServiceName, string BillingUnit, decimal IncludedQuantity, decimal ExcessBlockSize, decimal ExcessBlockPrice);
public sealed record PackageData(Guid Id, string Code, string Name, int VersionNumber, string Status, string CurrencyCode, decimal BasePrice,
    string Scope, string? FlightDirection, int? PeriodDays, DateOnly ValidFrom, DateOnly? ValidTo, string Version, IReadOnlyList<PackageComponentData> Components);
public sealed record PackageCommandInput(Guid RequestId, string ExpectedVersion);
public sealed record SetContractPackagesInput(Guid RequestId, string ExpectedVersion, IReadOnlyList<Guid> PackageVersionIds);

/// <summary>
/// Discards a package draft or retires a published package (1-N27), with the version on screen and a
/// reason of 5 to 500 characters.
/// </summary>
public sealed record PackageLifecycleInput(string ExpectedVersion, string Reason);

/// <summary>
/// An amendment of the latest approved version (1-C): <paramref name="ExpectedStatus"/> is the contract
/// status the user saw, the token the contract lifecycle uses, and <paramref name="ValidFrom"/> the
/// start of the new prices; the end is inherited.
/// </summary>
public sealed record CreateAmendmentInput(string ExpectedStatus, DateOnly ValidFrom);

public sealed record PackageWriteResult(Guid? Id, string? Code)
{
    public bool IsSuccess => Id is not null;
    public static PackageWriteResult Success(Guid id) => new(id, null);
    public static PackageWriteResult Fail(string code) => new(null, code);
}

public interface IFinancePackageStore
{
    Task<IReadOnlyList<PackageData>?> ListAsync(Guid actorId, CancellationToken cancellationToken = default);
    Task<PackageWriteResult> SaveAsync(Guid actorId, Guid? id, SavePackageInput input, CancellationToken cancellationToken = default);
    Task<PackageWriteResult> PublishAsync(Guid actorId, Guid id, PackageCommandInput input, CancellationToken cancellationToken = default);

    /// <summary>A draft becomes Discarded (<c>finance.packages.delete</c>); nothing is deleted.</summary>
    Task<PackageWriteResult> DiscardAsync(Guid actorId, Guid id, Guid idempotencyKey, PackageLifecycleInput input,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// The published version becomes Retired (<c>finance.packages.retire</c>): no longer assignable and
    /// it blocks the submission and the approval of drafts that still link it. Approved contracts keep
    /// the version they froze, and the previous publication is not revived.
    /// </summary>
    Task<PackageWriteResult> RetireAsync(Guid actorId, Guid id, Guid idempotencyKey, PackageLifecycleInput input,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<PackageData>?> ListForContractAsync(Guid actorId, Guid versionId, CancellationToken cancellationToken = default);
    Task<PackageWriteResult> SetContractPackagesAsync(Guid actorId, Guid versionId, SetContractPackagesInput input, CancellationToken cancellationToken = default);

    /// <summary>
    /// Contratos (<c>contracts.drafts.update</c>) amends an active or suspended contract from any of its
    /// versions: a new draft from the latest approved version with the given start (1-C).
    /// </summary>
    Task<PackageWriteResult> CreateAmendmentAsync(Guid actorId, Guid versionId, Guid idempotencyKey,
        CreateAmendmentInput input, CancellationToken cancellationToken = default);
}
