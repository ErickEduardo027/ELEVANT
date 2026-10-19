namespace Elevant.Contracts.Finance;

public sealed record FinancePackageComponentRequest(Guid ServiceId, string BillingUnit, decimal IncludedQuantity, decimal ExcessBlockSize, decimal ExcessBlockPrice);
public sealed record SaveFinancePackageRequest(Guid RequestId, string Code, string Name, string CurrencyCode, decimal BasePrice,
    string Scope, string? FlightDirection, int? PeriodDays, DateOnly ValidFrom, DateOnly? ValidTo,
    IReadOnlyList<FinancePackageComponentRequest> Components, string? ExpectedVersion);
public sealed record FinancePackageCommandRequest(Guid RequestId, string ExpectedVersion);
public sealed record SetContractPackagesRequest(Guid RequestId, string ExpectedVersion, IReadOnlyList<Guid> PackageVersionIds);
public sealed record FinancePackageComponentResponse(Guid ServiceId, string ServiceCode, string ServiceName, string BillingUnit, decimal IncludedQuantity, decimal ExcessBlockSize, decimal ExcessBlockPrice);
public sealed record FinancePackageResponse(Guid Id, string Code, string Name, int VersionNumber, string Status, string CurrencyCode, decimal BasePrice, string Scope, string? FlightDirection, int? PeriodDays, DateOnly ValidFrom, DateOnly? ValidTo, string Version, IReadOnlyList<FinancePackageComponentResponse> Components);
public sealed record FinancePackageIdResponse(Guid Id);
