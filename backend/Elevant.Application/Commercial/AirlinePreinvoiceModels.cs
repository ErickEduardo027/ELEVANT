namespace Elevant.Application.Commercial;

public sealed record AirlinePreinvoiceData(
    Guid Id, Guid StationId, string StationCode, DateOnly From, DateOnly To,
    string CurrencyCode, decimal Total, string Status, DateTimeOffset CreatedAt);

public sealed record AirlinePreinvoicePageData(
    IReadOnlyList<AirlinePreinvoiceData> Preinvoices, bool HasMore);

public sealed record AirlinePreinvoicePageResult(
    AirlinePreinvoicePageData? Page, AirlinePortalFailure? Failure)
{
    public bool IsSuccess => Page is not null && Failure is null;

    public static AirlinePreinvoicePageResult Success(AirlinePreinvoicePageData page) =>
        new(page, null);

    public static AirlinePreinvoicePageResult Failed(AirlinePortalFailure failure) =>
        new(null, failure);
}
