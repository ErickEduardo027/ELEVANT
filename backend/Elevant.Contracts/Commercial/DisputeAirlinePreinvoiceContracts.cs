namespace Elevant.Contracts.Commercial;

public sealed record DisputeAirlinePreinvoiceRequest(
    Guid RequestId, string Subject, string Description, IReadOnlyList<Guid> LineIds);

public sealed record DisputeAirlinePreinvoiceResponse(
    Guid Id, Guid DisputeId, string Status, bool Replayed);
