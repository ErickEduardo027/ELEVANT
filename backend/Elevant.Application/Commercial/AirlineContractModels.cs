namespace Elevant.Application.Commercial;

public sealed record AirlineContractRateData(
    Guid Id, string ServiceCode, string ServiceName,
    string BillingUnit, decimal UnitPrice, decimal MinimumQuantity);

public sealed record AirlineContractStationData(Guid Id, string Code, string Name);

public sealed record AirlineContractVersionData(
    Guid Id, int VersionNumber, DateOnly ValidFrom, DateOnly? ValidTo,
    string CurrencyCode, IReadOnlyList<AirlineContractStationData> Stations,
    IReadOnlyList<AirlineContractRateData> Rates);

public sealed record AirlineContractData(
    Guid Id, string Code, string Status, DateOnly? SignedOn, DateOnly? TerminatedOn,
    IReadOnlyList<AirlineContractVersionData> ApprovedVersions);

public sealed record AirlineContractPageData(
    IReadOnlyList<AirlineContractData> Contracts, bool HasMore);

public sealed record AirlineContractPageResult(
    AirlineContractPageData? Page, AirlinePortalFailure? Failure)
{
    public bool IsSuccess => Page is not null && Failure is null;

    public static AirlineContractPageResult Success(AirlineContractPageData page) => new(page, null);
    public static AirlineContractPageResult Failed(AirlinePortalFailure failure) => new(null, failure);
}
