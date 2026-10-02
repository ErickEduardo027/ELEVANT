namespace Elevant.Contracts.Commercial;

public sealed record AcceptAirlinePreinvoiceRequest(Guid RequestId);

public sealed record AcceptAirlinePreinvoiceResponse(Guid Id, string Status, bool Replayed);
