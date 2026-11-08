using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;

namespace Elevant.Application.Operations;

public sealed class OccReviewHandler(
    IActorContextResolver actorResolver,
    IOccReviewStore store)
{
    /// <summary>Problem Details code of a malformed review command (an empty id, an unknown outcome…).</summary>
    public const string InvalidRequestCode = "invalid_review_request";

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

    /// <summary>
    /// Approves or returns the pending hand-off. The Idempotency-Key is optional while older callers exist (expand);
    /// with one, the same key and body replay the first answer.
    /// </summary>
    public async Task<OccReviewDecisionWriteResult> DecideAsync(
        Guid accountId,
        Guid operationId,
        Guid submissionId,
        string? concurrencyToken,
        string? outcome,
        string? reason,
        string? requestId,
        Guid? idempotencyKey = null,
        CancellationToken cancellationToken = default)
    {
        var access = await ResolveAccessAsync(accountId, "operations.review.decide", cancellationToken);
        if (access.Failure is OccReviewFailure failure)
            return OccReviewDecisionWriteResult.Failed(failure);
        if (idempotencyKey == Guid.Empty)
            return OccReviewDecisionWriteResult.Failed(OccReviewFailure.InvalidRequest, "idempotency_key_required");
        if (operationId == Guid.Empty || submissionId == Guid.Empty ||
            string.IsNullOrWhiteSpace(concurrencyToken) ||
            !OccReviewDecisionPolicy.HasValidRequest(outcome, reason))
        {
            return OccReviewDecisionWriteResult.Failed(OccReviewFailure.InvalidRequest,
                outcome == "Returned" ? "reason_required" : InvalidRequestCode);
        }
        return await store.DecideAsync(new OccReviewDecisionWriteRequest(
            accountId, access.Stations!, operationId, submissionId,
            concurrencyToken, outcome!, outcome == "Returned" ? reason!.Trim() : null,
            Guid.NewGuid(), requestId, idempotencyKey), cancellationToken);
    }

    /// <summary>
    /// Adds a charge to a service (service and charge) or removes a mark (mark), with a reason. The Idempotency-Key
    /// is optional while older callers exist (expand).
    /// </summary>
    public async Task<OccReviewChargeAdjustResult> AdjustChargeAsync(Guid accountId, Guid operationId,
        Guid submissionId, string? concurrencyToken, Guid? serviceId, Guid? chargeId, Guid? markId, string? reason,
        string? requestId, Guid? idempotencyKey = null, CancellationToken cancellationToken = default)
    {
        var access = await ResolveAccessAsync(accountId, "operations.review.decide", cancellationToken);
        if (access.Failure is OccReviewFailure failure) return OccReviewChargeAdjustResult.Failed(failure);
        if (idempotencyKey == Guid.Empty)
            return OccReviewChargeAdjustResult.Failed(OccReviewFailure.InvalidRequest, "idempotency_key_required");
        var adding = serviceId is { } service && service != Guid.Empty && chargeId is { } charge && charge != Guid.Empty &&
            markId is null;
        var removing = markId is { } mark && mark != Guid.Empty && serviceId is null && chargeId is null;
        var trimmed = AdjustmentReason(reason);
        if (operationId == Guid.Empty || submissionId == Guid.Empty || string.IsNullOrWhiteSpace(concurrencyToken) ||
            !(adding ^ removing))
            return OccReviewChargeAdjustResult.Failed(OccReviewFailure.InvalidRequest, InvalidRequestCode);
        if (trimmed is null) return OccReviewChargeAdjustResult.Failed(OccReviewFailure.InvalidRequest, "reason_required");
        return await store.AdjustChargeAsync(new OccReviewChargeAdjustRequest(accountId, access.Stations!, operationId,
            submissionId, concurrencyToken!, serviceId, chargeId, markId, trimmed, Guid.NewGuid(), requestId,
            idempotencyKey), cancellationToken);
    }

    /// <summary>
    /// 3-N11: OCC excludes a service in exception from billing, or includes it again, with a reason (8 to 500
    /// characters). It takes an Idempotency-Key and the review version like any adjustment.
    /// </summary>
    public async Task<OccReviewChargeAdjustResult> SetServiceBillingExclusionAsync(Guid accountId, Guid operationId,
        Guid serviceId, Guid submissionId, string? concurrencyToken, bool excluded, string? reason, Guid? idempotencyKey,
        string? requestId, CancellationToken cancellationToken = default)
    {
        var access = await ResolveAccessAsync(accountId, "operations.review.decide", cancellationToken);
        if (access.Failure is OccReviewFailure failure) return OccReviewChargeAdjustResult.Failed(failure);
        if (idempotencyKey is not { } key || key == Guid.Empty)
            return OccReviewChargeAdjustResult.Failed(OccReviewFailure.InvalidRequest, "idempotency_key_required");
        if (operationId == Guid.Empty || serviceId == Guid.Empty || submissionId == Guid.Empty ||
            string.IsNullOrWhiteSpace(concurrencyToken))
            return OccReviewChargeAdjustResult.Failed(OccReviewFailure.InvalidRequest, InvalidRequestCode);
        var trimmed = AdjustmentReason(reason);
        if (trimmed is null) return OccReviewChargeAdjustResult.Failed(OccReviewFailure.InvalidRequest, "reason_required");
        return await store.SetServiceBillingExclusionAsync(new OccReviewBillingExclusionRequest(accountId,
            access.Stations!, operationId, serviceId, submissionId, concurrencyToken!, excluded, trimmed, key,
            Guid.NewGuid(), requestId), cancellationToken);
    }

    /// <summary>
    /// 3-H: OCC reopens an approval nothing was invoiced from yet, with a reason (8 to 2000 characters), its
    /// Idempotency-Key and the review version it saw. Only an account with <c>operations.review.reopen</c> does it.
    /// </summary>
    public async Task<OccReviewReopenResult> ReopenAsync(Guid accountId, Guid operationId, Guid submissionId,
        string? concurrencyToken, string? reason, Guid? idempotencyKey, string? requestId,
        CancellationToken cancellationToken = default)
    {
        var access = await ResolveAccessAsync(accountId, "operations.review.reopen", cancellationToken);
        if (access.Failure is OccReviewFailure failure) return OccReviewReopenResult.Failed(failure);
        if (idempotencyKey is not { } key || key == Guid.Empty)
            return OccReviewReopenResult.Failed(OccReviewFailure.InvalidRequest, "idempotency_key_required");
        if (operationId == Guid.Empty || submissionId == Guid.Empty || string.IsNullOrWhiteSpace(concurrencyToken))
            return OccReviewReopenResult.Failed(OccReviewFailure.InvalidRequest, InvalidRequestCode);
        if (OccReviewDecisionPolicy.ReopenReason(reason) is not { } trimmed)
            return OccReviewReopenResult.Failed(OccReviewFailure.InvalidRequest, "reason_required");
        return await store.ReopenAsync(new OccReviewReopenRequest(accountId, access.Stations!, operationId, submissionId,
            concurrencyToken!, trimmed, key, Guid.NewGuid(), requestId), cancellationToken);
    }

    /// <summary>The reason of a charge adjustment or a billing exclusion: 8 to 500 characters.</summary>
    private static string? AdjustmentReason(string? reason)
    {
        var trimmed = reason?.Trim();
        return trimmed is { Length: >= 8 and <= 500 } ? trimmed : null;
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
