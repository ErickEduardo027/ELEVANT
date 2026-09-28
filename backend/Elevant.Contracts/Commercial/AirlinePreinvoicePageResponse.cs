namespace Elevant.Contracts.Commercial;

public sealed record AirlinePreinvoiceResponse(
    Guid Id, Guid StationId, string StationCode, DateOnly From, DateOnly To,
    string CurrencyCode, decimal Total, string Status, DateTimeOffset CreatedAt);

public sealed record AirlinePreinvoicePageResponse(
    int Page, int Limit, bool HasMore,
    IReadOnlyList<AirlinePreinvoiceResponse> Preinvoices);
