using System.Text.Json;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>
/// Late evidence (3-N06): a milestone, walk-around damage or flight data the tablet captured before the hand-off that
/// reached the server while OCC reviews the operation. Once applied, the pending hand-off is brought up to date in the
/// same transaction: the automatic surcharges are recalculated with the hand-off as the end, the frozen evidence OCC
/// reviews is captured again and the operation's row version moves, so a reviewer holding the old token gets 412 and
/// re-reads before deciding. Nothing is accepted once OCC approved or returned it.
/// </summary>
internal static class PendingSubmissionEvidenceRefresher
{
    public const string AuditAction = "ramp.operation.evidence.late_accepted";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>
    /// Refreshes the pending hand-off after <c>evidence</c> arrived late (<c>milestone</c>, <c>flight_data</c> or
    /// <c>damage_mark</c>); answers whether the operation was under review and its hand-off was refreshed.
    /// </summary>
    public static async Task<bool> RefreshAsync(ElevantDbContext context, RampExecutionActorAccess actor,
        RampOperationExecutionScope scope, DateTimeOffset now, string evidence, string? requestId,
        CancellationToken cancellationToken)
    {
        var operation = scope.Operation;
        if (!RampOperationExecutionPolicy.AcceptsLateEvidence(operation.CurrentStatus, operation.ActualStartAt,
                operation.ActualEndAt))
            return false;
        var submission = await context.OperationSubmissions
            .Where(item => item.GroundOperationId == operation.Id && item.Status == SubmissionStatus.PendingReview)
            .OrderByDescending(item => item.RevisionNumber)
            .FirstOrDefaultAsync(cancellationToken);
        if (submission is null) return false;

        // The recalculation and the evidence read the late entry.
        await context.SaveChangesAsync(cancellationToken);
        var handedOffAt = operation.ActualEndAt!.Value;
        var surcharges = await AutomaticSurchargeApplier.ReconcileAsync(context, operation.Id, handedOffAt, now,
            actor.RampAgentInternalId, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
        submission.EvidenceJson = (await OperationSubmissionEvidence.CaptureAsync(context, operation.Id,
            cancellationToken, handedOffAt)).ToJson();
        submission.UpdatedAt = now;
        // OCC's review token is built from the operation's row version: touching the row makes it stale.
        operation.UpdatedAt = now;
        context.Entry(operation).Property(item => item.UpdatedAt).IsModified = true;
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = now, ActorType = AuditActorType.Account,
            ActorAccountId = actor.AccountInternalId, ActorDisplay = actor.DisplayName, Action = AuditAction,
            EntityType = nameof(Elevant.Domain.Entities.Operations.OperationSubmission), EntityPublicId = submission.PublicId,
            OrganizationId = scope.AirlineOrganizationInternalId, StationId = scope.StationInternalId,
            Source = AuditSource.MobileSync, CorrelationId = Guid.CreateVersion7(), RequestId = requestId,
            Reason = "Evidence captured on the tablet before the hand-off reached ELEVANT while OCC reviews it.",
            MetadataJson = JsonSerializer.Serialize(new
            {
                operationId = operation.PublicId, evidence, revision = submission.RevisionNumber, handedOffAt,
                appliedSurcharges = surcharges.Applied, retiredSurcharges = surcharges.Retired,
            }, Json),
        });
        foreach (var account in await OperationalNotificationWriter.OccRecipientsAsync(context, scope.StationInternalId,
                     now, null, cancellationToken))
            AccountChangeOutboxWriter.Add(context, account, scope.StationInternalId,
                RampOperationChangeWriter.OccReviewResource, operation.PublicId, now);
        return true;
    }
}
