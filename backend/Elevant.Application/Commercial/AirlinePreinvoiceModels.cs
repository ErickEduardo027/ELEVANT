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

public sealed record PreinvoiceDisputeResolutionData(
    Guid Id, string Decision, string Reason, DateTimeOffset ResolvedAt);

public sealed record PreinvoiceDisputeData(
    Guid Id, string Subject, string Description, DateTimeOffset CreatedAt,
    IReadOnlyList<Guid> LineIds, PreinvoiceDisputeResolutionData? Resolution = null);

public sealed record AirlinePreinvoiceDisputesResult(
    Guid PreinvoiceId, IReadOnlyList<PreinvoiceDisputeData>? Disputes,
    AirlinePortalFailure? Failure)
{
    public bool IsSuccess => Disputes is not null && Failure is null;
    public static AirlinePreinvoiceDisputesResult Success(Guid id, IReadOnlyList<PreinvoiceDisputeData> disputes) =>
        new(id, disputes, null);
    public static AirlinePreinvoiceDisputesResult Failed(AirlinePortalFailure failure) =>
        new(Guid.Empty, null, failure);
}

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
