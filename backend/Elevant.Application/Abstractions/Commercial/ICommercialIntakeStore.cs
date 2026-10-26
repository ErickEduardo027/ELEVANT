using Elevant.Application.Commercial;

namespace Elevant.Application.Abstractions.Commercial;

public sealed record AirlineCommercialRequestData(Guid Id, string Reference,
    string Status, DateTimeOffset SubmittedAt, string? DecisionReason,
    Guid? ContractId, IReadOnlyList<CommercialRequestItemData> Services,
    IReadOnlyList<CommercialRequestPackageData> Packages);

/// <summary>Persists a validated, anonymous commercial application exactly once.</summary>
public interface ICommercialIntakeStore
{
    Task<CommercialSubmissionResult> SubmitAsync(
        SubmitCommercialRequestCommand command,
        CancellationToken cancellationToken = default);

    Task<CommercialSubmissionResult> SubmitAdditionalAsync(Guid actorId,
        SubmitAdditionalServiceRequestCommand command,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<AirlineCommercialRequestData>?> ListOwnAsync(Guid actorId,
        CancellationToken cancellationToken = default);

    /// <summary>Finds a receipt only when the original request ID and complete payload match.</summary>
    Task<string?> LookupReceiptAsync(SubmitCommercialRequestCommand command,
        CancellationToken cancellationToken = default);
}
