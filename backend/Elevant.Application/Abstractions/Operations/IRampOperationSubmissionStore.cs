using Elevant.Application.Operations;

namespace Elevant.Application.Abstractions.Operations;

public interface IRampOperationSubmissionStore
{
    Task<RampOperationSubmissionWriteResult> SubmitAsync(
        RampOperationSubmissionWriteRequest request,
        CancellationToken cancellationToken = default);
}
