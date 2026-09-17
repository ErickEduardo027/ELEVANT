using Elevant.Application.Operations;

namespace Elevant.Application.Abstractions.Operations;

/// <summary>Commits device-scoped ramp operation commands.</summary>
public interface IRampOperationsCommandStore
{
    Task<RampOperationStartWriteResult> StartOperationAsync(
        RampOperationStartWriteRequest request,
        CancellationToken cancellationToken = default);
}
