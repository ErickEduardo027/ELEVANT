using Elevant.Application.Operations;

namespace Elevant.Application.Abstractions.Operations;

/// <summary>Commits device-scoped operation-service transitions.</summary>
public interface IRampOperationServiceCommandStore
{
    Task<RampOperationServiceTransitionWriteResult> TransitionServiceAsync(
        RampOperationServiceTransitionWriteRequest request,
        CancellationToken cancellationToken = default);
}
