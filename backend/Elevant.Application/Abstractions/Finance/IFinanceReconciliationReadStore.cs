namespace Elevant.Application.Abstractions.Finance;

/// <summary>Persisted non-fiscal lifecycle facts, not a bank reconciliation.</summary>
public sealed record FinanceReconciliationData(Guid PreinvoiceId, Guid AirlineId,
    string AirlineName, DateOnly From, DateOnly To, string CurrencyCode,
    decimal PreinvoiceTotal, string PreinvoiceStatus, Guid? InvoiceId,
    string? InvoiceNumber, decimal? InvoiceTotal, DateTimeOffset? IssuedAt,
    Guid? PaymentId, string? PaymentReference, decimal? PaymentAmount,
    DateTimeOffset? PaymentRecordedAt);

public sealed record FinanceReconciliationPageData(Guid StationId, int Page,
    int Limit, bool HasMore, IReadOnlyList<FinanceReconciliationData> Rows);

public interface IFinanceReconciliationReadStore
{
    /// <summary>Returns null unless the actor has a live Finance grant for the station.</summary>
    Task<FinanceReconciliationPageData?> ListAsync(Guid accountId, Guid stationId,
        int page, int limit, CancellationToken cancellationToken = default);
}
