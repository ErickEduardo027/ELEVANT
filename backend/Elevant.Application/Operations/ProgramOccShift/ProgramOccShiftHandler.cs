using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;

namespace Elevant.Application.Operations.ProgramOccShift;

public sealed class ProgramOccShiftHandler(
    IActorContextResolver actorContextResolver,
    IOccShiftProgrammingStore store)
{
    public async Task<ProgramOccShiftResult> HandleAsync(
        ProgramOccShiftCommand command,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        cancellationToken.ThrowIfCancellationRequested();
        if (command.AccountId == Guid.Empty)
            return ProgramOccShiftResult.Failed(OccPlanningFailure.Unauthorized);
        if (command.TurnaroundId == Guid.Empty || command.AgentId == Guid.Empty ||
            command.CorrelationId == Guid.Empty ||
            command.StartsAtLocal == command.EndsAtLocal ||
            command.StartsAtLocal.Ticks % TimeSpan.TicksPerSecond != 0 ||
            command.EndsAtLocal.Ticks % TimeSpan.TicksPerSecond != 0)
            return ProgramOccShiftResult.Failed(OccPlanningFailure.InvalidRequest);

        var actor = await actorContextResolver.ResolveAsync(command.AccountId, cancellationToken);
        if (!ActorContextValidator.IsValid(actor, command.AccountId))
            return ProgramOccShiftResult.Failed(OccPlanningFailure.Unauthorized);
        if (!OccPlanningAccess.IsAuthorized(actor!, "operations.planning.assign"))
            return ProgramOccShiftResult.Failed(OccPlanningFailure.Forbidden);

        var stations = actor!.StationScopes.Select(scope => scope.StationId)
            .Where(id => id != Guid.Empty).Distinct().ToArray();
        if (stations.Length == 0)
            return ProgramOccShiftResult.Failed(OccPlanningFailure.NotFound);

        var result = await store.ProgramAsync(new OccShiftWriteRequest(
            command.AccountId, stations, command.TurnaroundId, command.AgentId,
            command.StartsAtLocal, command.EndsAtLocal,
            command.CorrelationId, command.RequestId), cancellationToken);
        return result.IsSuccess
            ? ProgramOccShiftResult.Success(result.ShiftId!.Value, result.Replayed)
            : ProgramOccShiftResult.Failed(result.Failure switch
            {
                OccShiftWriteFailure.NotFound => OccPlanningFailure.NotFound,
                OccShiftWriteFailure.Conflict => OccPlanningFailure.Conflict,
                _ => throw new InvalidOperationException("Unsupported OCC shift write failure."),
            });
    }
}
