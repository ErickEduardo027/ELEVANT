namespace Elevant.Contracts.Finance;

public sealed record IssueFinanceInvoiceRequest(Guid PreinvoiceId, Guid RequestId);

public sealed record IssueFinanceInvoiceResponse(
    Guid Id, Guid PreinvoiceId, string Number, string Kind, bool Replayed);

public sealed record NonFiscalInvoiceLineResponse(
    Guid Id, int LineNumber, string OperationCode, DateOnly OperationDate,
    string ServiceCode, string ServiceName, decimal ExecutedQuantity,
    string BillingUnit, decimal UnitPrice, decimal Amount);

public sealed record NonFiscalInvoiceResponse(
    Guid Id, Guid PreinvoiceId, Guid AirlineId, Guid StationId,
    string Number, string Kind, string CurrencyCode, decimal Total,
    DateTimeOffset IssuedAt, IReadOnlyList<NonFiscalInvoiceLineResponse> Lines);
