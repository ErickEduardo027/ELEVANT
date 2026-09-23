using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;

namespace Elevant.Application.Operations.SubmitRampOperationChecklist;

public sealed class SubmitRampOperationChecklistHandler(
    IActorContextResolver actorContextResolver,
    IRampOperationChecklistCommandStore commandStore)
{
    public async Task<SubmitRampOperationChecklistResult> HandleAsync(
        SubmitRampOperationChecklistCommand command,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        cancellationToken.ThrowIfCancellationRequested();

        if (command.AccountId == Guid.Empty)
        {
            return SubmitRampOperationChecklistResult.Failed(
                RampOperationsFailure.Unauthorized);
        }

        if (command.OperationId == Guid.Empty ||
            command.ChecklistId == Guid.Empty ||
            command.InstallationId == Guid.Empty ||
            command.IdempotencyKey == Guid.Empty ||
            command.CorrelationId == Guid.Empty ||
            !RampChecklistSubmissionPolicy.HasValidRequestShape(command.Answers))
        {
            return SubmitRampOperationChecklistResult.Failed(
                RampOperationsFailure.InvalidRequest);
        }

        var actor = await actorContextResolver.ResolveAsync(
            command.AccountId,
            cancellationToken);
        if (!ActorContextValidator.IsValid(actor, command.AccountId))
        {
            return SubmitRampOperationChecklistResult.Failed(
                RampOperationsFailure.Unauthorized);
        }

        if (!RampOperationsAccess.IsAuthorized(actor!))
        {
            return SubmitRampOperationChecklistResult.Failed(
                RampOperationsFailure.Forbidden);
        }

        var stationIds = DistinctStationIds(actor!);
        if (stationIds.Length == 0)
        {
            return SubmitRampOperationChecklistResult.Failed(
                RampOperationsFailure.NotFound);
        }

        var result = await commandStore.SubmitChecklistAsync(
            new RampChecklistSubmissionWriteRequest(
                command.AccountId,
                stationIds,
                command.OperationId,
                command.ChecklistId,
                command.Answers,
                command.InstallationId,
                command.IdempotencyKey,
                command.CorrelationId,
                command.RequestId),
            cancellationToken);

        return result.IsSuccess
            ? SubmitRampOperationChecklistResult.Success(result.Submission!)
            : SubmitRampOperationChecklistResult.Failed(result.Failure switch
            {
                RampChecklistSubmissionWriteFailure.Forbidden =>
                    RampOperationsFailure.Forbidden,
                RampChecklistSubmissionWriteFailure.NotFound =>
                    RampOperationsFailure.NotFound,
                RampChecklistSubmissionWriteFailure.Conflict or
                    RampChecklistSubmissionWriteFailure.IdempotencyKeyConflict =>
                    RampOperationsFailure.Conflict,
                _ => throw new InvalidOperationException(
                    "Unsupported ramp checklist submission failure."),
            });
    }

    private static Guid[] DistinctStationIds(ActorContext actor) =>
        actor.StationScopes
            .Select(scope => scope.StationId)
            .Where(id => id != Guid.Empty)
            .Distinct()
            .ToArray();
}
