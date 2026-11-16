namespace Elevant.Contracts.Commercial;

/// <summary>Tenant-scoped, read-only approved contract history.</summary>
public sealed record AirlineContractPageResponse(
    int Page, int Limit, bool HasMore, IReadOnlyList<AirlineContractResponse> Contracts);

public sealed record AirlineContractResponse(
    Guid Id, string Code, string Status, DateOnly? SignedOn, DateOnly? TerminatedOn,
    IReadOnlyList<AirlineContractVersionResponse> ApprovedVersions);

public sealed record AirlineContractVersionResponse(
    Guid Id, int VersionNumber, DateOnly ValidFrom, DateOnly? ValidTo,
    string CurrencyCode, IReadOnlyList<AirlineContractStationResponse> Stations,
    IReadOnlyList<AirlineContractRateResponse> Rates);

public sealed record AirlineContractStationResponse(Guid Id, string Code, string Name);

public sealed record AirlineContractRateResponse(
    Guid Id, string ServiceCode, string ServiceName, string BillingUnit,
    decimal UnitPrice, decimal MinimumQuantity);
