namespace Elevant.Application.Finance;

public sealed record NonFiscalInvoiceLineData(
    Guid Id, int LineNumber, string OperationCode, DateOnly OperationDate,
    string ServiceCode, string ServiceName, decimal ExecutedQuantity,
    string BillingUnit, decimal UnitPrice, decimal Amount);

public sealed record NonFiscalInvoiceData(
    Guid Id, Guid PreinvoiceId, Guid AirlineId, Guid StationId,
    string Number, string CurrencyCode, decimal Total, DateTimeOffset IssuedAt,
    IReadOnlyList<NonFiscalInvoiceLineData> Lines);
