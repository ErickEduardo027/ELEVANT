namespace Elevant.Application.Abstractions.Finance;

public sealed record FinanceTariffData(Guid Id, Guid ContractId, string ContractCode,
    Guid AirlineId, string AirlineName, int VersionNumber, string VersionStatus,
    DateOnly ValidFrom, DateOnly? ValidTo, string CurrencyCode, string ServiceCode,
    string ServiceName, string BillingUnit, decimal UnitPrice, decimal MinimumQuantity);

public sealed record FinanceTariffPageData(Guid StationId, int Page, int Limit,
    bool HasMore, IReadOnlyList<FinanceTariffData> Tariffs);

public interface IFinanceTariffReadStore
{
    /// <summary>Returns null unless the actor has a live internal Finance grant for the station.</summary>
    Task<FinanceTariffPageData?> ListAsync(Guid accountId, Guid stationId,
        int page, int limit, CancellationToken cancellationToken = default);
}
