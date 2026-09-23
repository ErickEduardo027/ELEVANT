using Elevant.Application.Operations;

namespace Elevant.Application.Abstractions.Operations;

/// <summary>Commits device-scoped ramp checklist submissions.</summary>
public interface IRampOperationChecklistCommandStore
{
    Task<RampChecklistSubmissionWriteResult> SubmitChecklistAsync(
        RampChecklistSubmissionWriteRequest request,
        CancellationToken cancellationToken = default);
}
