namespace Elevant.Application.Abstractions.Finance;

public sealed record FinancePreinvoiceListItem(Guid Id, Guid AirlineId, string AirlineName,
    Guid StationId, DateOnly From, DateOnly To, string CurrencyCode, decimal Total,
    string Status, int LineCount, DateTimeOffset CreatedAt);

public sealed record FinancePreinvoicePageData(int Page, int Limit, bool HasMore,
    IReadOnlyList<FinancePreinvoiceListItem> Preinvoices);

public interface IFinancePreinvoiceListStore
{
    /// <summary>Returns null when the actor has no live Finance grant for the station.</summary>
    Task<FinancePreinvoicePageData?> ListAsync(Guid accountId, Guid stationId,
        int page, int limit, CancellationToken cancellationToken = default);
}
