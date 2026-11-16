namespace Elevant.Application.Abstractions.Commercial;

public sealed record ManagedContractRateData(Guid Id, string ServiceCode,
    string ServiceName, string BillingUnit, decimal UnitPrice, decimal MinimumQuantity);

public sealed record ManagedContractStationData(Guid Id, string Code, string Name);

public sealed record ManagedContractVersionData(Guid Id, int VersionNumber, string Status,
    DateOnly ValidFrom, DateOnly? ValidTo, string CurrencyCode, string? Terms,
    IReadOnlyList<ManagedContractStationData> Stations,
    IReadOnlyList<ManagedContractRateData> Rates);

public sealed record ManagedContractData(Guid Id, string Code, string Airline,
    string AirlineCode, string Status, DateOnly? SignedOn, DateOnly? TerminatedOn,
    IReadOnlyList<ManagedContractVersionData> ApprovedVersions);

public sealed record ManagedContractPageData(
    int Page, int Limit, bool HasMore, IReadOnlyList<ManagedContractData> Contracts);

public interface IManagedContractReadStore
{
    /// <summary>Returns null if the actor lacks internal commercial read permission.</summary>
    Task<ManagedContractPageData?> ListAsync(Guid actorId, int page, int limit,
        CancellationToken cancellationToken = default);
}
