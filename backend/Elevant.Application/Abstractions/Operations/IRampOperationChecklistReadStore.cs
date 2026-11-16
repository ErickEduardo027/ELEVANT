using Elevant.Application.Operations;

namespace Elevant.Application.Abstractions.Operations;

/// <summary>Reads one assigned ramp operation's canonical checklist.</summary>
public interface IRampOperationChecklistReadStore
{
    Task<RampOperationChecklistReadResult> GetChecklistAsync(
        RampOperationChecklistReadRequest request,
        CancellationToken cancellationToken = default);
}
