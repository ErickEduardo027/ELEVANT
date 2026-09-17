using Elevant.Application.Operations;

namespace Elevant.Application.Abstractions.Operations;

/// <summary>Reads station-scoped OCC planning projections from the system of record.</summary>
public interface IOccPlanningReadStore
{
    Task<DateOnly?> GetLatestOperationDateAsync(
        Guid stationId,
        CancellationToken cancellationToken = default);

    Task<string?> GetStationTimeZoneAsync(
        Guid stationId,
        CancellationToken cancellationToken = default);

    Task<OccPlanningSnapshotData?> GetSnapshotAsync(
        Guid stationId,
        DateOnly operationDate,
        CancellationToken cancellationToken = default);

    Task<OccPlanningOptionsReadResult> GetOptionsAsync(
        IReadOnlyCollection<Guid> allowedStationIds,
        Guid turnaroundId,
        CancellationToken cancellationToken = default);
}
