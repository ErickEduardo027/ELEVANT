namespace Elevant.Contracts.Commercial;

public sealed record AirlinePreinvoiceResponse(
    Guid Id, Guid StationId, string StationCode, DateOnly From, DateOnly To,
    string CurrencyCode, decimal Total, string Status, DateTimeOffset CreatedAt);

public sealed record AirlinePreinvoicePageResponse(
    int Page, int Limit, bool HasMore,
    IReadOnlyList<AirlinePreinvoiceResponse> Preinvoices);

public sealed record AirlinePreinvoiceLineResponse(
    Guid Id, string OperationCode, DateOnly OperationDate,
    string ServiceCode, string ServiceName, decimal ExecutedQuantity,
    string BillingUnit, decimal UnitPrice, decimal Amount,
    string Kind, Guid? ParentLineId, string? Reason);

public sealed record AirlinePreinvoiceDetailResponse(
    Guid Id, Guid StationId, string StationCode, DateOnly From, DateOnly To,
    string CurrencyCode, decimal Total, string Status, DateTimeOffset CreatedAt,
    IReadOnlyList<AirlinePreinvoiceLineResponse> Lines);
