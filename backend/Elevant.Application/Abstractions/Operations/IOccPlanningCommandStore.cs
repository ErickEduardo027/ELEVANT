using Elevant.Application.Operations;

namespace Elevant.Application.Abstractions.Operations;

/// <summary>Commits OCC planning transitions against the current server-owned context.</summary>
public interface IOccPlanningCommandStore
{
    Task<OccAssignmentWriteResult> AssignOperationAsync(
        OccAssignmentWriteRequest request,
        CancellationToken cancellationToken = default);
}
