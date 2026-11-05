namespace Elevant.Application.Finance;

public sealed record NonFiscalInvoiceLineData(
    Guid Id, int LineNumber, string OperationCode, DateOnly OperationDate,
    string ServiceCode, string ServiceName, decimal ExecutedQuantity,
    string BillingUnit, decimal UnitPrice, decimal Amount, decimal? NetAmount = null, decimal? TaxAmount = null);

public sealed record NonFiscalInvoiceData(
    Guid Id, Guid PreinvoiceId, Guid AirlineId, Guid StationId,
    string Number, string CurrencyCode, decimal Total, DateTimeOffset IssuedAt,
    IReadOnlyList<NonFiscalInvoiceLineData> Lines,
    NonFiscalInvoiceFiscalData? Fiscal = null);

/// <summary>The simulated e-CF identity and parties printed on the invoice (ADR-0035).</summary>
public sealed record NonFiscalInvoiceFiscalData(string? FiscalNumber, string? SecurityCode, DateTimeOffset? SignedAt,
    DateOnly? DueDate, decimal? NetTotal, decimal? TaxTotal, string IssuerName, string IssuerRnc, string CustomerName,
    string StationCode);
