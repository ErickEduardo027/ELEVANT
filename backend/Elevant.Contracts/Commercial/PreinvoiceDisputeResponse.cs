namespace Elevant.Contracts.Commercial;

public sealed record PreinvoiceDisputeResponse(
    Guid Id, string Subject, string Description, DateTimeOffset CreatedAt,
    IReadOnlyList<Guid> LineIds);

public sealed record PreinvoiceDisputeListResponse(
    Guid PreinvoiceId, IReadOnlyList<PreinvoiceDisputeResponse> Disputes);
