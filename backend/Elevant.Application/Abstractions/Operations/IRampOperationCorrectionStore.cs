using Elevant.Application.Operations;

namespace Elevant.Application.Abstractions.Operations;

public interface IRampOperationCorrectionStore
{
    Task<RampOperationCorrectionWriteResult> ReopenAsync(
        RampOperationCorrectionWriteRequest request,
        CancellationToken cancellationToken = default);
}
