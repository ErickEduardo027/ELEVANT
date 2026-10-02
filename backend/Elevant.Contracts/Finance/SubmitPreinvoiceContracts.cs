namespace Elevant.Contracts.Finance;

public sealed record SubmitPreinvoiceRequest(Guid RequestId);

public sealed record SubmitPreinvoiceResponse(Guid Id, string Status, bool Replayed);
