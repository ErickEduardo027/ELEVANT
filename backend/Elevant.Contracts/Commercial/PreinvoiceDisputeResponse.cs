using System.Text.Json.Serialization;

namespace Elevant.Contracts.Commercial;

public sealed record PreinvoiceDisputeResolutionResponse(
    Guid Id, string Decision, string Reason, DateTimeOffset ResolvedAt);

public sealed record PreinvoiceDisputeResponse(
    Guid Id, string Subject, string Description, DateTimeOffset CreatedAt,
    IReadOnlyList<Guid> LineIds,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    PreinvoiceDisputeResolutionResponse? Resolution = null);

public sealed record PreinvoiceDisputeListResponse(
    Guid PreinvoiceId, IReadOnlyList<PreinvoiceDisputeResponse> Disputes);
