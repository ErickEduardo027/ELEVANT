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
    Task<IReadOnlyList<PackageData>?> ListForContractAsync(Guid actorId, Guid versionId, CancellationToken cancellationToken = default);
    Task<PackageWriteResult> SetContractPackagesAsync(Guid actorId, Guid versionId, SetContractPackagesInput input, CancellationToken cancellationToken = default);
    Task<PackageWriteResult> CreateAmendmentAsync(Guid actorId, Guid versionId, PackageCommandInput input, CancellationToken cancellationToken = default);
}
