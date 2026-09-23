using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;

namespace Elevant.Application.Operations.TransitionRampOperationService;

public sealed class TransitionRampOperationServiceHandler(
    IActorContextResolver actorContextResolver,
    IRampOperationServiceCommandStore commandStore)
{
    public async Task<TransitionRampOperationServiceResult> HandleAsync(
        TransitionRampOperationServiceCommand command,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        cancellationToken.ThrowIfCancellationRequested();

        if (command.AccountId == Guid.Empty)
        {
            return TransitionRampOperationServiceResult.Failed(
                RampOperationsFailure.Unauthorized);
        }

        if (command.OperationId == Guid.Empty ||
            command.ServiceId == Guid.Empty ||
            command.InstallationId == Guid.Empty ||
            command.IdempotencyKey == Guid.Empty ||
            command.CorrelationId == Guid.Empty ||
            !RampOperationServiceTransitionPolicy.HasValidRequestShape(
                command.TargetStatus,
                command.ExecutedQuantity,
                command.Note))
        {
            return TransitionRampOperationServiceResult.Failed(
                RampOperationsFailure.InvalidRequest);
        }

        var actor = await actorContextResolver.ResolveAsync(
            command.AccountId,
            cancellationToken);
        if (!ActorContextValidator.IsValid(actor, command.AccountId))
        {
            return TransitionRampOperationServiceResult.Failed(
                RampOperationsFailure.Unauthorized);
        }

        if (!RampOperationsAccess.IsAuthorized(actor!))
        {
            return TransitionRampOperationServiceResult.Failed(
                RampOperationsFailure.Forbidden);
        }

        var stationIds = DistinctStationIds(actor!);
        if (stationIds.Length == 0)
        {
            return TransitionRampOperationServiceResult.Failed(
                RampOperationsFailure.NotFound);
        }

        var result = await commandStore.TransitionServiceAsync(
            new RampOperationServiceTransitionWriteRequest(
                command.AccountId,
                stationIds,
                command.OperationId,
                command.ServiceId,
                command.TargetStatus,
                command.ExecutedQuantity,
                command.Note,
                command.InstallationId,
                command.IdempotencyKey,
                command.CorrelationId,
                command.RequestId),
            cancellationToken);

        return result.IsSuccess
            ? TransitionRampOperationServiceResult.Success(result.Transition!)
            : TransitionRampOperationServiceResult.Failed(result.Failure switch
            {
                RampOperationServiceTransitionWriteFailure.Forbidden =>
                    RampOperationsFailure.Forbidden,
                RampOperationServiceTransitionWriteFailure.NotFound =>
                    RampOperationsFailure.NotFound,
                RampOperationServiceTransitionWriteFailure.Conflict or
                    RampOperationServiceTransitionWriteFailure.IdempotencyKeyConflict =>
                    RampOperationsFailure.Conflict,
                _ => throw new InvalidOperationException(
                    "Unsupported ramp operation service transition failure."),
            });
    }

    private static Guid[] DistinctStationIds(ActorContext actor) =>
        actor.StationScopes
            .Select(scope => scope.StationId)
            .Where(id => id != Guid.Empty)
            .Distinct()
            .ToArray();
}
