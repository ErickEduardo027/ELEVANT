using Elevant.Application.Operations;

namespace Elevant.Application.Abstractions.Operations;

/// <summary>
/// Reads the active operations assigned to a ramp agent from the system of record.
/// Implementations must resolve the agent profile from the authenticated account identifier.
/// </summary>
public interface IRampOperationsReadStore
{
    Task<RampOperationsReadResult> GetActiveAssignedOperationsAsync(
        Guid accountId,
        IReadOnlyCollection<Guid> allowedStationIds,
        CancellationToken cancellationToken = default);
}
