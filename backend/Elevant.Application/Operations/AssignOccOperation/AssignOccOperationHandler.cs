using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;

namespace Elevant.Application.Operations.AssignOccOperation;

public sealed class AssignOccOperationHandler(
    IActorContextResolver actorContextResolver,
    IOccPlanningCommandStore commandStore)
{
    public async Task<AssignOccOperationResult> HandleAsync(
        AssignOccOperationCommand command,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        cancellationToken.ThrowIfCancellationRequested();

        if (command.AccountId == Guid.Empty)
        {
            return AssignOccOperationResult.Failed(OccPlanningFailure.Unauthorized);
        }

        if (command.TurnaroundId == Guid.Empty ||
            command.AgentId == Guid.Empty ||
            command.CorrelationId == Guid.Empty ||
            !OccPlanningConcurrencyToken.TryDecode(
                command.ExpectedConcurrencyToken,
                out var expectedVersion))
        {
            return AssignOccOperationResult.Failed(OccPlanningFailure.InvalidRequest);
        }

        var actor = await actorContextResolver.ResolveAsync(
            command.AccountId,
            cancellationToken);
        if (!ActorContextValidator.IsValid(actor, command.AccountId))
        {
            return AssignOccOperationResult.Failed(OccPlanningFailure.Unauthorized);
        }

        if (!OccPlanningAccess.IsAuthorized(actor!))
        {
            return AssignOccOperationResult.Failed(OccPlanningFailure.Forbidden);
        }

        var allowedStations = actor!.StationScopes
            .Select(scope => scope.StationId)
            .Where(id => id != Guid.Empty)
            .Distinct()
            .ToArray();
        if (allowedStations.Length == 0)
        {
            return AssignOccOperationResult.Failed(OccPlanningFailure.NotFound);
        }

        var writeResult = await commandStore.AssignOperationAsync(
            new OccAssignmentWriteRequest(
                command.AccountId,
                allowedStations,
                command.TurnaroundId,
                command.AgentId,
                expectedVersion,
                command.CorrelationId,
                command.RequestId),
            cancellationToken);

        if (writeResult.IsSuccess)
        {
            return AssignOccOperationResult.Success(writeResult.Assignment!);
        }

        return AssignOccOperationResult.Failed(writeResult.Failure switch
        {
            OccAssignmentWriteFailure.NotFound => OccPlanningFailure.NotFound,
            OccAssignmentWriteFailure.Conflict => OccPlanningFailure.Conflict,
            OccAssignmentWriteFailure.PreconditionFailed =>
                OccPlanningFailure.PreconditionFailed,
            _ => throw new InvalidOperationException(
                "Unsupported OCC assignment write failure."),
        });
    }
}
