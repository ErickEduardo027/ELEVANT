namespace Elevant.Contracts.Finance;

public sealed record ResolvePreinvoiceDisputeRequest(
    Guid RequestId, string Decision, string Reason);

public sealed record ResolvePreinvoiceDisputeResponse(
    Guid Id, Guid PreinvoiceId, string Status, bool Replayed);
