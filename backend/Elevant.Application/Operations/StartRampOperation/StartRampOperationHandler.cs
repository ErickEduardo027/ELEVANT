using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;

namespace Elevant.Application.Operations.StartRampOperation;

public sealed class StartRampOperationHandler(
    IActorContextResolver actorContextResolver,
    IRampOperationsCommandStore commandStore)
{
    public async Task<StartRampOperationResult> HandleAsync(
        StartRampOperationCommand command,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        cancellationToken.ThrowIfCancellationRequested();

        if (command.AccountId == Guid.Empty)
        {
            return StartRampOperationResult.Failed(RampOperationsFailure.Unauthorized);
        }

        if (command.OperationId == Guid.Empty ||
            command.InstallationId == Guid.Empty ||
            command.IdempotencyKey == Guid.Empty ||
            command.CorrelationId == Guid.Empty)
        {
            return StartRampOperationResult.Failed(RampOperationsFailure.InvalidRequest);
        }

        var actor = await actorContextResolver.ResolveAsync(
            command.AccountId,
            cancellationToken);
        if (!ActorContextValidator.IsValid(actor, command.AccountId))
        {
            return StartRampOperationResult.Failed(RampOperationsFailure.Unauthorized);
        }

        if (!RampOperationsAccess.IsAuthorized(actor!))
        {
            return StartRampOperationResult.Failed(RampOperationsFailure.Forbidden);
        }

        var stationIds = actor!.StationScopes
            .Select(scope => scope.StationId)
            .Where(id => id != Guid.Empty)
            .Distinct()
            .ToArray();
        if (stationIds.Length == 0)
        {
            return StartRampOperationResult.Failed(RampOperationsFailure.NotFound);
        }

        var result = await commandStore.StartOperationAsync(
            new RampOperationStartWriteRequest(
                command.AccountId,
                stationIds,
                command.OperationId,
                command.InstallationId,
                command.IdempotencyKey,
                command.CorrelationId,
                command.RequestId),
            cancellationToken);

        return result.IsSuccess
            ? StartRampOperationResult.Success(result.Start!)
            : StartRampOperationResult.Failed(result.Failure switch
            {
                RampOperationStartWriteFailure.Forbidden => RampOperationsFailure.Forbidden,
                RampOperationStartWriteFailure.NotFound => RampOperationsFailure.NotFound,
                RampOperationStartWriteFailure.Conflict => RampOperationsFailure.Conflict,
                RampOperationStartWriteFailure.IdempotencyKeyConflict =>
                    RampOperationsFailure.Conflict,
                _ => throw new InvalidOperationException(
                    "Unsupported ramp operation start failure."),
            }, result.Code);
    }
}
