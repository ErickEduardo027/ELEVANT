namespace Elevant.Contracts.Finance;

/// <summary>
/// «Inicio» of Finance (4-A, 4-N02) for one station at <c>BusinessDate</c>, the business day of Santo Domingo. A
/// section is null when the account's template does not include the module it summarizes; the months are business
/// months. Web only: the tablet never reads it.
/// </summary>
public sealed record FinanceHomeResponse(Guid StationId, DateOnly BusinessDate, FinanceHomeToInvoiceResponse? ToInvoice,
    IReadOnlyList<FinanceHomeAmountResponse>? InvoicedThisMonth, IReadOnlyList<FinanceHomeReceivableResponse>? Receivables,
    IReadOnlyList<FinanceHomeAmountResponse>? CardCollectionsThisMonth, int? PendingContractApprovals,
    int? ChartersAwaitingPrepayment);

/// <summary>Approved operations waiting for an invoice in «Por facturar», how many airlines they belong to and the oldest day.</summary>
public sealed record FinanceHomeToInvoiceResponse(int Operations, int Airlines, DateOnly? OldestOperationDate);

/// <summary>How many invoices or card payments of one currency and what they add up to.</summary>
public sealed record FinanceHomeAmountResponse(string CurrencyCode, int Count, decimal Amount);

/// <summary>The open balance of one currency and the part already past due.</summary>
public sealed record FinanceHomeReceivableResponse(string CurrencyCode, int OpenInvoices, decimal Open, int OverdueInvoices,
    decimal Overdue);
