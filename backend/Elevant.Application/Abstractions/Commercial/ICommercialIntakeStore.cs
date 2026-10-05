using Elevant.Application.Commercial;

namespace Elevant.Application.Abstractions.Commercial;

/// <summary>Persists a validated, anonymous commercial application exactly once.</summary>
public interface ICommercialIntakeStore
{
    Task<CommercialSubmissionResult> SubmitAsync(
        SubmitCommercialRequestCommand command,
        CancellationToken cancellationToken = default);

    /// <summary>Finds a receipt only when the original request ID and complete payload match.</summary>
    Task<string?> LookupReceiptAsync(SubmitCommercialRequestCommand command,
        CancellationToken cancellationToken = default);
}
