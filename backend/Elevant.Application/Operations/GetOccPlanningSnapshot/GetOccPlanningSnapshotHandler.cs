using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;

namespace Elevant.Application.Operations.GetOccPlanningSnapshot;

public sealed class GetOccPlanningSnapshotHandler(
    IActorContextResolver actorContextResolver,
    IOccPlanningReadStore readStore,
    TimeProvider timeProvider)
{
    public async Task<GetOccPlanningSnapshotResult> HandleAsync(
        GetOccPlanningSnapshotQuery query,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);
        cancellationToken.ThrowIfCancellationRequested();

        if (query.AccountId == Guid.Empty)
        {
            return GetOccPlanningSnapshotResult.Failed(OccPlanningFailure.Unauthorized);
        }

        var actor = await actorContextResolver.ResolveAsync(query.AccountId, cancellationToken);
        if (!ActorContextValidator.IsValid(actor, query.AccountId))
        {
            return GetOccPlanningSnapshotResult.Failed(OccPlanningFailure.Unauthorized);
        }

        if (!OccPlanningAccess.IsAuthorized(actor!, "operations.planning.read"))
        {
            return GetOccPlanningSnapshotResult.Failed(OccPlanningFailure.Forbidden);
        }

        var allowedStations = actor!.StationScopes
            .Select(scope => scope.StationId)
            .Where(id => id != Guid.Empty)
            .Distinct()
            .ToArray();

        Guid stationId;
        if (query.StationId.HasValue)
        {
            if (query.StationId.Value == Guid.Empty)
            {
                return GetOccPlanningSnapshotResult.Failed(OccPlanningFailure.InvalidRequest);
            }

            if (!allowedStations.Contains(query.StationId.Value))
            {
                return GetOccPlanningSnapshotResult.Failed(OccPlanningFailure.NotFound);
            }

            stationId = query.StationId.Value;
        }
        else
        {
            if (allowedStations.Length != 1)
            {
                return GetOccPlanningSnapshotResult.Failed(OccPlanningFailure.InvalidRequest);
            }

            stationId = allowedStations[0];
        }

        var operationDate = query.Date;
        if (!operationDate.HasValue)
        {
            operationDate = await readStore.GetLatestOperationDateAsync(
                stationId,
                cancellationToken);
            if (!operationDate.HasValue)
            {
                var timeZoneId = await readStore.GetStationTimeZoneAsync(
                    stationId,
                    cancellationToken);
                if (string.IsNullOrWhiteSpace(timeZoneId))
                {
                    return GetOccPlanningSnapshotResult.Failed(OccPlanningFailure.NotFound);
                }

                var zone = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
                operationDate = DateOnly.FromDateTime(
                    TimeZoneInfo.ConvertTime(timeProvider.GetUtcNow(), zone).DateTime);
            }
        }

        var snapshot = await readStore.GetSnapshotAsync(
            stationId,
            operationDate.Value,
            cancellationToken);

        return snapshot is null
            ? GetOccPlanningSnapshotResult.Failed(OccPlanningFailure.NotFound)
            : GetOccPlanningSnapshotResult.Success(snapshot);
    }
}
