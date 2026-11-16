namespace Elevant.Application.Abstractions.Finance;

/// <summary>The operations of the station waiting for an invoice, with the oldest operation day.</summary>
public sealed record FinanceHomeToInvoiceData(int Operations, int Airlines, DateOnly? OldestOperationDate);

/// <summary>How many documents of one currency and what they add up to.</summary>
public sealed record FinanceHomeAmountData(string CurrencyCode, int Count, decimal Amount);

/// <summary>The open balance of one currency at the business day, with what is already past due.</summary>
public sealed record FinanceHomeReceivableData(string CurrencyCode, int OpenInvoices, decimal Open, int OverdueInvoices,
    decimal Overdue);

/// <summary>
/// «Inicio» of Finance (4-A, 4-N02): indicators the server computes for one station at the business day of Santo
/// Domingo. A section is null when the account's template does not include its module: «Por facturar»
/// (finance.invoicing.read), «Facturas» (finance.reconciliation.read; the invoiced month also with
/// finance.invoicing.read), «Aprobación de contratos» and «Charters». They are projections; nothing is stored.
/// </summary>
public sealed record FinanceHomeData(Guid StationId, DateOnly BusinessDate, FinanceHomeToInvoiceData? ToInvoice,
    IReadOnlyList<FinanceHomeAmountData>? InvoicedThisMonth, IReadOnlyList<FinanceHomeReceivableData>? Receivables,
    IReadOnlyList<FinanceHomeAmountData>? CardCollectionsThisMonth, int? PendingContractApprovals,
    int? ChartersAwaitingPrepayment);

public interface IFinanceHomeStore
{
    /// <summary>
    /// The indicators of the station, or null when the account is not AVIAM staff with «Inicio» (finance.home.read)
    /// and a live grant on the station.
    /// </summary>
    Task<FinanceHomeData?> GetAsync(Guid actorId, Guid stationId, CancellationToken cancellationToken = default);
}
