namespace Elevant.Application.Commercial;

public sealed record AirlinePreinvoiceData(
    Guid Id, Guid StationId, string StationCode, DateOnly From, DateOnly To,
    string CurrencyCode, decimal Total, string Status, DateTimeOffset CreatedAt);

public sealed record AirlinePreinvoicePageData(
    IReadOnlyList<AirlinePreinvoiceData> Preinvoices, bool HasMore);

public sealed record AirlinePreinvoiceLineData(
    Guid Id, string OperationCode, DateOnly OperationDate,
    string ServiceCode, string ServiceName, decimal ExecutedQuantity,
    string BillingUnit, decimal UnitPrice, decimal Amount);

public sealed record AirlinePreinvoiceDetailData(
    Guid Id, Guid StationId, string StationCode, DateOnly From, DateOnly To,
    string CurrencyCode, decimal Total, string Status, DateTimeOffset CreatedAt,
    IReadOnlyList<AirlinePreinvoiceLineData> Lines);

public sealed record AirlinePreinvoiceDetailResult(
    AirlinePreinvoiceDetailData? Detail, AirlinePortalFailure? Failure)
{
    public bool IsSuccess => Detail is not null && Failure is null;
    public static AirlinePreinvoiceDetailResult Success(AirlinePreinvoiceDetailData detail) =>
        new(detail, null);
    public static AirlinePreinvoiceDetailResult Failed(AirlinePortalFailure failure) =>
        new(null, failure);
}

public sealed record AirlinePreinvoicePageResult(
    AirlinePreinvoicePageData? Page, AirlinePortalFailure? Failure)
{
    public bool IsSuccess => Page is not null && Failure is null;

    public static AirlinePreinvoicePageResult Success(AirlinePreinvoicePageData page) =>
        new(page, null);

    public static AirlinePreinvoicePageResult Failed(AirlinePortalFailure failure) =>
        new(null, failure);
}
