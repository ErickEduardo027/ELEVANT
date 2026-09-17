using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;

namespace Elevant.Application.Operations.GetOccPlanningOptions;

public sealed class GetOccPlanningOptionsHandler(
    IActorContextResolver actorContextResolver,
    IOccPlanningReadStore readStore)
{
    public async Task<GetOccPlanningOptionsResult> HandleAsync(
        GetOccPlanningOptionsQuery query,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);
        cancellationToken.ThrowIfCancellationRequested();

        if (query.AccountId == Guid.Empty)
        {
            return GetOccPlanningOptionsResult.Failed(OccPlanningFailure.Unauthorized);
        }

        if (query.TurnaroundId == Guid.Empty)
        {
            return GetOccPlanningOptionsResult.Failed(OccPlanningFailure.InvalidRequest);
        }

        var actor = await actorContextResolver.ResolveAsync(query.AccountId, cancellationToken);
        if (!ActorContextValidator.IsValid(actor, query.AccountId))
        {
            return GetOccPlanningOptionsResult.Failed(OccPlanningFailure.Unauthorized);
        }

        if (!OccPlanningAccess.IsAuthorized(actor!))
        {
            return GetOccPlanningOptionsResult.Failed(OccPlanningFailure.Forbidden);
        }

        var allowedStations = actor!.StationScopes
            .Select(scope => scope.StationId)
            .Where(id => id != Guid.Empty)
            .Distinct()
            .ToArray();
        if (allowedStations.Length == 0)
        {
            return GetOccPlanningOptionsResult.Failed(OccPlanningFailure.NotFound);
        }

        var readResult = await readStore.GetOptionsAsync(
            allowedStations,
            query.TurnaroundId,
            cancellationToken);
        if (!readResult.IsSuccess)
        {
            return GetOccPlanningOptionsResult.Failed(readResult.Failure switch
            {
                OccPlanningOptionsReadFailure.NotFound => OccPlanningFailure.NotFound,
                OccPlanningOptionsReadFailure.ContractConflict => OccPlanningFailure.Conflict,
                _ => throw new InvalidOperationException(
                    "Unsupported OCC options read failure."),
            });
        }

        var source = readResult.Options!;

        var agents = source.AgentCandidates
            .Select(OccAgentEligibilityPolicy.Evaluate)
            .OrderByDescending(agent => agent.Eligible)
            .ThenBy(agent => agent.DisplayName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(agent => agent.Id)
            .ToArray();

        return GetOccPlanningOptionsResult.Success(new OccPlanningOptionsData(
            source.Turnaround,
            source.Contract,
            source.Services,
            agents));
    }
}
