using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;

namespace Elevant.Application.Operations;

public sealed class OccReviewHandler(
    IActorContextResolver actorResolver,
    IOccReviewStore store)
{
    public async Task<OccReviewQueueResult> GetQueueAsync(
        Guid accountId, Guid stationId, CancellationToken cancellationToken = default)
    {
        var access = await ResolveAccessAsync(accountId, "operations.review.read", cancellationToken);
        if (access.Failure is OccReviewFailure failure) return OccReviewQueueResult.Failed(failure);
        if (stationId == Guid.Empty) return OccReviewQueueResult.Failed(OccReviewFailure.InvalidRequest);
        if (!access.Stations!.Contains(stationId))
            return OccReviewQueueResult.Failed(OccReviewFailure.NotFound);
        var queue = await store.GetQueueAsync(stationId, cancellationToken);
        return queue is null
            ? OccReviewQueueResult.Failed(OccReviewFailure.NotFound)
            : OccReviewQueueResult.Success(queue);
    }

    public async Task<OccReviewDetailResult> GetDetailAsync(
        Guid accountId, Guid operationId, CancellationToken cancellationToken = default)
    {
        var access = await ResolveAccessAsync(accountId, "operations.review.read", cancellationToken);
        if (access.Failure is OccReviewFailure failure) return OccReviewDetailResult.Failed(failure);
        if (operationId == Guid.Empty)
            return OccReviewDetailResult.Failed(OccReviewFailure.InvalidRequest);
        var detail = await store.GetDetailAsync(operationId, access.Stations!, cancellationToken);
        return detail is null
            ? OccReviewDetailResult.Failed(OccReviewFailure.NotFound)
            : OccReviewDetailResult.Success(detail);
    }

    public async Task<OccReviewDetailResult> GetSubmissionDetailAsync(
        Guid accountId, Guid operationId, Guid submissionId,
        CancellationToken cancellationToken = default)
    {
        var access = await ResolveAccessAsync(accountId, "operations.review.read", cancellationToken);
        if (access.Failure is OccReviewFailure failure) return OccReviewDetailResult.Failed(failure);
        if (operationId == Guid.Empty || submissionId == Guid.Empty)
            return OccReviewDetailResult.Failed(OccReviewFailure.InvalidRequest);
        var detail = await store.GetSubmissionDetailAsync(
            operationId, submissionId, access.Stations!, cancellationToken);
        return detail is null
            ? OccReviewDetailResult.Failed(OccReviewFailure.NotFound)
            : OccReviewDetailResult.Success(detail);
    }

    public async Task<OccReviewSubmissionHistoryResult> GetSubmissionHistoryAsync(
        Guid accountId, Guid operationId, CancellationToken cancellationToken = default)
    {
        var access = await ResolveAccessAsync(accountId, "operations.review.read", cancellationToken);
        if (access.Failure is OccReviewFailure failure)
            return OccReviewSubmissionHistoryResult.Failed(failure);
        if (operationId == Guid.Empty)
            return OccReviewSubmissionHistoryResult.Failed(OccReviewFailure.InvalidRequest);
        var history = await store.GetSubmissionHistoryAsync(
            operationId, access.Stations!, cancellationToken);
        return history is null
            ? OccReviewSubmissionHistoryResult.Failed(OccReviewFailure.NotFound)
            : OccReviewSubmissionHistoryResult.Success(history);
    }

    public async Task<OccReviewDecisionWriteResult> DecideAsync(
        Guid accountId,
        Guid operationId,
        Guid submissionId,
        string? concurrencyToken,
        string? outcome,
        string? reason,
        string? requestId,
        CancellationToken cancellationToken = default)
    {
        var access = await ResolveAccessAsync(accountId, "operations.review.decide", cancellationToken);
        if (access.Failure is OccReviewFailure failure)
            return OccReviewDecisionWriteResult.Failed(failure);
        if (operationId == Guid.Empty || submissionId == Guid.Empty ||
            string.IsNullOrWhiteSpace(concurrencyToken) ||
            !OccReviewDecisionPolicy.HasValidRequest(outcome, reason))
        {
            return OccReviewDecisionWriteResult.Failed(OccReviewFailure.InvalidRequest);
        }
        return await store.DecideAsync(new OccReviewDecisionWriteRequest(
            accountId, access.Stations!, operationId, submissionId,
            concurrencyToken, outcome!, outcome == "Returned" ? reason!.Trim() : null,
            Guid.NewGuid(), requestId), cancellationToken);
    }

    private async Task<(IReadOnlyCollection<Guid>? Stations, OccReviewFailure? Failure)> ResolveAccessAsync(
        Guid accountId, string permissionCode, CancellationToken cancellationToken)
    {
        if (accountId == Guid.Empty) return (null, OccReviewFailure.Unauthorized);
        var actor = await actorResolver.ResolveAsync(accountId, cancellationToken);
        if (!ActorContextValidator.IsValid(actor, accountId))
            return (null, OccReviewFailure.Unauthorized);
        if (!OccPlanningAccess.IsAuthorized(actor!, permissionCode))
            return (null, OccReviewFailure.Forbidden);
        var stations = actor!.StationScopes.Select(scope => scope.StationId)
            .Where(id => id != Guid.Empty).Distinct().ToArray();
        return stations.Length == 0
            ? (null, OccReviewFailure.NotFound)
            : (stations, null);
    }
}
