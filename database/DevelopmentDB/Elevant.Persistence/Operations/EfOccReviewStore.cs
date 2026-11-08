using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Finance;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Commercial;
using Elevant.Persistence.Identity;
using Elevant.Persistence.Finance;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Elevant.Persistence.Operations;

/// <summary>
/// Station-scoped OCC review projections and serialized decisions. Every command (decision, charge adjustment,
/// billing exclusion, reopening) runs in one serializable transaction, checks the review version OCC saw and, with an
/// Idempotency-Key, keeps its receipt (<see cref="CommercialCommandReceipts"/>): a retry replays the first answer and
/// never repeats its audit or announcements. Refusals carry a stable code.
/// </summary>
internal sealed class EfOccReviewStore(ElevantDbContext context, TimeProvider timeProvider) : IOccReviewStore
{
    private const int QueueLimit = 100;
    private const string DecideAction = "occ.review.decide";
    private const string AddChargeAction = "occ.review.charge.add";
    private const string RemoveChargeAction = "occ.review.charge.remove";
    private const string BillingExclusionAction = "occ.review.service_billing_exclusion";
    private const string ReopenAction = "occ.review.reopen";
    private const string DecidePermission = "operations.review.decide";
    private const string ReopenPermission = "operations.review.reopen";

    /// <summary>The note an approval leaves on the incidents OCC did not manage (ADR-0034).</summary>
    public const string ApprovalResolutionNote = "Cerrada al aprobar la revisión de OCC.";

    /// <summary>What one command step answered: the record it wrote, or the failure and code that roll it back.</summary>
    private readonly record struct ReviewStep(Guid ResultId, OccReviewFailure? Failure, string? Code)
    {
        public static ReviewStep Done(Guid resultId) => new(resultId, null, null);

        public static ReviewStep Fail(OccReviewFailure failure, string code) => new(Guid.Empty, failure, code);
    }

    /// <summary>The operation and its hand-offs locked for one command, with the actor's live scope.</summary>
    private sealed record CommandScope(GroundOperation Operation, OperationSubmission Latest, long StationId,
        long AirlineOrganizationId, long AccountId, string ActorName);

    public async Task<OccReviewQueueData?> GetQueueAsync(
        Guid stationId, CancellationToken cancellationToken = default)
    {
        var station = await context.Stations.AsNoTracking()
            .Where(item => item.PublicId == stationId && item.IsActive)
            .Select(item => new { item.Id, item.PublicId, item.Code, item.Name, item.IanaTimeZone })
            .SingleOrDefaultAsync(cancellationToken);
        if (station is null) return null;

        var rows = await (
            from submission in context.OperationSubmissions.AsNoTracking()
            join operation in context.GroundOperations.AsNoTracking()
                on submission.GroundOperationId equals operation.Id
            join turnaround in context.Turnarounds.AsNoTracking()
                on operation.TurnaroundId equals turnaround.Id
            join airline in context.Airlines.AsNoTracking()
                on turnaround.AirlineId equals airline.Id
            join agent in context.RampAgents.AsNoTracking()
                on submission.SubmittedByRampAgentId equals agent.Id
            join person in context.Persons.AsNoTracking()
                on agent.PersonId equals person.Id
            where turnaround.StationId == station.Id &&
                  !context.OperationSubmissions.AsNoTracking().Any(other =>
                      other.GroundOperationId == operation.Id &&
                      other.RevisionNumber > submission.RevisionNumber)
            orderby submission.Status == SubmissionStatus.PendingReview descending,
                submission.SubmittedAt descending, submission.Id descending
            select new
            {
                OperationId = operation.PublicId,
                SubmissionId = submission.PublicId,
                submission.RevisionNumber,
                submission.Status,
                turnaround.OperationCode,
                turnaround.OperationDate,
                AirlineName = airline.Name,
                AgentName = person.FirstName + " " + person.LastName,
                submission.SubmittedAt,
                submission.EvidenceJson,
                ServiceCount = context.OperationServices.AsNoTracking()
                    .Count(item => item.GroundOperationId == operation.Id),
                IncidentCount = context.Incidents.AsNoTracking()
                    .Count(item => item.GroundOperationId == operation.Id),
            })
            .Take(QueueLimit + 1)
            .ToArrayAsync(cancellationToken);

        return new OccReviewQueueData(
            station.PublicId, station.Code, station.Name, station.IanaTimeZone,
            rows.Take(QueueLimit).Select(row => new OccReviewQueueItemData(
                row.OperationId, row.SubmissionId, row.RevisionNumber,
                row.Status.ToString(), row.OperationCode, row.OperationDate,
                row.AirlineName, row.AgentName.Trim(), row.SubmittedAt,
                row.EvidenceJson is null ? row.ServiceCount :
                    OperationSubmissionEvidence.Parse(row.EvidenceJson).Services.Length,
                row.EvidenceJson is null ? row.IncidentCount :
                    OperationSubmissionEvidence.Parse(row.EvidenceJson).Incidents.Length)).ToArray(),
            rows.Length > QueueLimit);
    }

    public async Task<OccReviewDetailData?> GetDetailAsync(
        Guid operationId, IReadOnlyCollection<Guid> allowedStationIds,
        CancellationToken cancellationToken = default) =>
        await GetDetailCoreAsync(operationId, null, allowedStationIds, cancellationToken);

    public async Task<OccReviewDetailData?> GetSubmissionDetailAsync(
        Guid operationId, Guid submissionId, IReadOnlyCollection<Guid> allowedStationIds,
        CancellationToken cancellationToken = default) =>
        await GetDetailCoreAsync(operationId, submissionId, allowedStationIds, cancellationToken);

    public async Task<OccReviewSubmissionHistoryData?> GetSubmissionHistoryAsync(
        Guid operationId, IReadOnlyCollection<Guid> allowedStationIds,
        CancellationToken cancellationToken = default)
    {
        if (allowedStationIds.Count == 0) return null;
        var rows = await (
            from operation in context.GroundOperations.AsNoTracking()
            join turnaround in context.Turnarounds.AsNoTracking()
                on operation.TurnaroundId equals turnaround.Id
            join station in context.Stations.AsNoTracking()
                on turnaround.StationId equals station.Id
            join submission in context.OperationSubmissions.AsNoTracking()
                on operation.Id equals submission.GroundOperationId
            join decisionRow in context.ReviewDecisions.AsNoTracking()
                on submission.Id equals decisionRow.OperationSubmissionId into decisions
            from decision in decisions.DefaultIfEmpty()
            where operation.PublicId == operationId && station.IsActive &&
                  allowedStationIds.Contains(station.PublicId)
            orderby submission.RevisionNumber descending
            select new
            {
                submission.PublicId,
                submission.RevisionNumber,
                submission.Status,
                submission.SubmittedAt,
                Outcome = decision == null ? (ReviewOutcome?)null : decision.Outcome,
                DecidedAt = decision == null ? (DateTimeOffset?)null : decision.DecidedAt,
            })
            .Take(QueueLimit + 1)
            .ToArrayAsync(cancellationToken);

        if (rows.Length == 0) return null;
        return new OccReviewSubmissionHistoryData(
            operationId,
            rows.Take(QueueLimit).Select(row => new OccReviewSubmissionHistoryItemData(
                row.PublicId, row.RevisionNumber, row.Status.ToString(),
                row.SubmittedAt, row.Outcome?.ToString(), row.DecidedAt)).ToArray(),
            rows.Length > QueueLimit);
    }

    private async Task<OccReviewDetailData?> GetDetailCoreAsync(
        Guid operationId, Guid? submissionId, IReadOnlyCollection<Guid> allowedStationIds,
        CancellationToken cancellationToken)
    {
        if (allowedStationIds.Count == 0) return null;
        var core = await (
            from operation in context.GroundOperations.AsNoTracking()
            join turnaround in context.Turnarounds.AsNoTracking()
                on operation.TurnaroundId equals turnaround.Id
            join station in context.Stations.AsNoTracking()
                on turnaround.StationId equals station.Id
            join airline in context.Airlines.AsNoTracking()
                on turnaround.AirlineId equals airline.Id
            join submission in context.OperationSubmissions.AsNoTracking()
                on operation.Id equals submission.GroundOperationId
            join agent in context.RampAgents.AsNoTracking()
                on submission.SubmittedByRampAgentId equals agent.Id
            join person in context.Persons.AsNoTracking()
                on agent.PersonId equals person.Id
            join checklist in context.OperationChecklists.AsNoTracking()
                on submission.OperationChecklistId equals checklist.Id
            where operation.PublicId == operationId && station.IsActive &&
                  (submissionId == null || submission.PublicId == submissionId) &&
                  allowedStationIds.Contains(station.PublicId)
            orderby submission.RevisionNumber descending
            select new
            {
                OperationInternalId = operation.Id,
                OperationId = operation.PublicId,
                operation.RowVersion,
                operation.PlannedStartAt,
                operation.PlannedEndAt,
                operation.ActualStartAt,
                operation.ActualEndAt,
                SubmissionInternalId = submission.Id,
                SubmissionId = submission.PublicId,
                submission.RevisionNumber,
                submission.Status,
                submission.SubmittedAt,
                submission.AgentNote,
                submission.EvidenceJson,
                submission.ReopenedFromSubmissionId,
                submission.ReopenedByAccountId,
                submission.ReopenReason,
                SubmissionCreatedAt = submission.CreatedAt,
                ChecklistInternalId = checklist.Id,
                ChecklistStatus = checklist.Status,
                turnaround.OperationCode,
                turnaround.OperationDate,
                StationId = station.PublicId,
                StationCode = station.Code,
                station.IanaTimeZone,
                AirlineName = airline.Name,
                AgentName = person.FirstName + " " + person.LastName,
            })
            .FirstOrDefaultAsync(cancellationToken);
        if (core is null) return null;

        var evidence = core.EvidenceJson is null
            ? await OperationSubmissionEvidence.CaptureAsync(
                context, core.OperationInternalId, cancellationToken)
            : OperationSubmissionEvidence.Parse(core.EvidenceJson);
        var answers = await (
            from answer in context.Set<ChecklistAnswer>().AsNoTracking()
            join item in context.Set<ChecklistTemplateItem>().AsNoTracking()
                on answer.ChecklistTemplateItemId equals item.Id
            where answer.OperationChecklistId == core.ChecklistInternalId
            orderby item.SortOrder
            select new OccReviewChecklistAnswerData(
                item.SectionName, item.ItemCode, item.Label,
                answer.Value.ToString(), answer.Note))
            .ToArrayAsync(cancellationToken);
        var decisionRow = await context.ReviewDecisions.AsNoTracking()
            .Where(item => item.OperationSubmissionId == core.SubmissionInternalId)
            .Select(item => new { item.Outcome, item.Reason, item.DecidedAt, item.ApprovedEvidenceJson })
            .SingleOrDefaultAsync(cancellationToken);
        var decision = decisionRow is null ? null
            : new OccReviewDecisionData(decisionRow.Outcome.ToString(), decisionRow.Reason, decisionRow.DecidedAt);
        var latestRevision = await context.OperationSubmissions.AsNoTracking()
            .Where(item => item.GroundOperationId == core.OperationInternalId)
            .MaxAsync(item => item.RevisionNumber, cancellationToken);
        var isLatest = core.RevisionNumber == latestRevision;
        var canAdjust = core.Status == SubmissionStatus.PendingReview && isLatest;
        var close = await CloseAsync(core.OperationInternalId, evidence,
            decisionRow?.ApprovedEvidenceJson is { } approved ? OperationSubmissionEvidence.Parse(approved) : null,
            canAdjust, cancellationToken);
        // 3-N02: the state of the Service Order the decision approves; an earlier revision is history.
        var serviceOrderState = isLatest
            ? (await ServiceOrderSignatures.EvaluateAsync(context, core.OperationInternalId, timeProvider,
                cancellationToken)).State
            : null;
        // 3-H: a reopened revision says which approval it reopens, why, when and who.
        OccReviewReopeningData? reopening = null;
        if (core.ReopenedFromSubmissionId is long reopenedFrom)
        {
            var fromRevision = await context.OperationSubmissions.AsNoTracking()
                .Where(item => item.Id == reopenedFrom).Select(item => item.RevisionNumber)
                .SingleAsync(cancellationToken);
            reopening = new OccReviewReopeningData(fromRevision, core.ReopenReason ?? string.Empty,
                core.SubmissionCreatedAt,
                await AccountDisplayNames.OfAsync(context, core.ReopenedByAccountId, cancellationToken));
        }

        return new OccReviewDetailData(
            core.OperationId, core.SubmissionId, core.RevisionNumber,
            core.Status.ToString(), core.OperationCode, core.OperationDate,
            core.StationId, core.StationCode, core.IanaTimeZone,
            core.AirlineName, core.AgentName.Trim(), core.PlannedStartAt,
            core.PlannedEndAt, core.ActualStartAt, core.ActualEndAt ?? core.SubmittedAt,
            core.SubmittedAt, core.AgentNote, core.ChecklistStatus.ToString(),
            answers, evidence.Services, evidence.Incidents, decision,
            ConcurrencyToken(core.OperationId, core.RowVersion, core.SubmissionId, core.Status), close,
            serviceOrderState, reopening);
    }

    /// <summary>
    /// What OCC closes the operation with (ADR-0034): recorded times, the charges (live while it can
    /// still adjust them, otherwise as approved or as handed off), the charges it may add and the
    /// services it excluded from billing.
    /// </summary>
    private async Task<OccReviewCloseData> CloseAsync(long operationId, OperationSubmissionEvidence submitted,
        OperationSubmissionEvidence? approved, bool canAdjust, CancellationToken cancellationToken)
    {
        var milestones = await context.Set<OperationMilestone>().AsNoTracking()
            .Where(item => item.GroundOperationId == operationId && item.ActualAt != null)
            .OrderBy(item => item.ActualAt)
            .Select(item => new OccReviewMilestoneData(item.Code, item.ActualAt!.Value))
            .ToArrayAsync(cancellationToken);
        var serviceCodes = submitted.Services.ToDictionary(service => service.Id, service => service.Code);
        var definitions = await context.ChargeDefinitions.AsNoTracking()
            .Select(charge => new { charge.Id, charge.PublicId, charge.Code, charge.Name, charge.IsActive,
                charge.AppliesToAllServices })
            .ToArrayAsync(cancellationToken);
        IReadOnlyList<OccReviewChargeData> charges;
        if (canAdjust)
        {
            charges = await (from mark in context.OperationServiceCharges.AsNoTracking()
                             join service in context.OperationServices.AsNoTracking() on mark.OperationServiceId equals service.Id
                             join definition in context.ServiceDefinitions.AsNoTracking()
                                 on service.ServiceDefinitionId equals definition.Id
                             join charge in context.ChargeDefinitions.AsNoTracking() on mark.ChargeDefinitionId equals charge.Id
                             where service.GroundOperationId == operationId && mark.RemovedAt == null
                             orderby service.LineNumber, mark.AppliedAt, mark.Id
                             select new OccReviewChargeData(mark.PublicId, service.PublicId, definition.Code, charge.PublicId,
                                 charge.Code, charge.Name, mark.Source.ToString(), mark.AppliedAt, mark.AdjustmentReason))
                .ToArrayAsync(cancellationToken);
        }
        else
        {
            charges = ((approved ?? submitted).Charges ?? []).Select(item => new OccReviewChargeData(item.MarkId,
                    item.ServiceId, serviceCodes.GetValueOrDefault(item.ServiceId, string.Empty), item.ChargeId, item.Code,
                    definitions.FirstOrDefault(definition => definition.PublicId == item.ChargeId)?.Name ?? item.Code,
                    item.Source ?? nameof(ChargeMarkSource.Agent), item.AppliedAt, null))
                .ToArray();
        }
        var options = new List<OccReviewChargeOptionData>();
        if (canAdjust)
        {
            var services = await context.OperationServices.AsNoTracking()
                .Where(service => service.GroundOperationId == operationId)
                .Select(service => new { service.Id, service.PublicId, service.ServiceDefinitionId }).ToArrayAsync(cancellationToken);
            var links = await context.ChargeDefinitionServices.AsNoTracking()
                .Select(link => new { link.ChargeDefinitionId, link.ServiceDefinitionId }).ToArrayAsync(cancellationToken);
            // 3-N29: a charge the service's contract excludes is not offered for that service.
            var exclusions = await ContractChargeExclusions.ForServicesAsync(context,
                services.Select(service => service.Id).ToArray(), cancellationToken);
            foreach (var charge in definitions.Where(item => item.IsActive).OrderBy(item => item.Name))
            {
                var serviceIds = services.Where(service => (charge.AppliesToAllServices || links.Any(link =>
                        link.ChargeDefinitionId == charge.Id && link.ServiceDefinitionId == service.ServiceDefinitionId)) &&
                        !exclusions.Contains(service.Id, charge.Id))
                    .Select(service => service.PublicId).ToArray();
                if (serviceIds.Length > 0)
                    options.Add(new OccReviewChargeOptionData(charge.PublicId, charge.Code, charge.Name,
                        charge.AppliesToAllServices, serviceIds));
            }
        }
        var frozen = submitted.Close;
        var timing = frozen is not null
            ? new OccReviewTimingData(frozen.GroundMinutes, frozen.AllowedGroundMinutes, frozen.ArrivalDelayMinutes,
                frozen.AircraftCategory)
            : await LiveTimingAsync(operationId, cancellationToken);
        var damages = await context.Set<OperationDamageMark>().AsNoTracking()
            .CountAsync(item => item.GroundOperationId == operationId, cancellationToken);
        var exclusionsInReview = await context.OperationServices.AsNoTracking()
            .Where(service => service.GroundOperationId == operationId && service.BillingExcludedAt != null)
            .OrderBy(service => service.LineNumber)
            .Select(service => new OccReviewBillingExclusionData(service.PublicId, service.BillingExclusionReason!,
                service.BillingExcludedAt!.Value))
            .ToArrayAsync(cancellationToken);
        return new OccReviewCloseData(milestones, charges, options, timing, canAdjust, damages, exclusionsInReview);
    }

    private async Task<OccReviewTimingData> LiveTimingAsync(long operationId, CancellationToken cancellationToken)
    {
        var facts = await OperationCloseFacts.LoadAsync(context, operationId, null, cancellationToken);
        return new OccReviewTimingData(facts.GroundMinutes, facts.AllowedGroundMinutes, facts.ArrivalDelayMinutes,
            facts.Category?.ToString());
    }

    public async Task<OccReviewChargeAdjustResult> AdjustChargeAsync(
        OccReviewChargeAdjustRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var hash = CommercialCommandReceipts.Hash(new
        {
            request.OperationId, request.SubmissionId, request.ServiceId, request.ChargeId, request.MarkId, request.Reason,
            expected = request.ConcurrencyToken,
        });
        var (step, _) = await RunAsync(request.ActorAccountId, request.IdempotencyKey,
            request.MarkId is null ? AddChargeAction : RemoveChargeAction, hash,
            token => AdjustInsideTransactionAsync(request, token), cancellationToken);
        return step.Failure is { } failure
            ? OccReviewChargeAdjustResult.Failed(failure, step.Code)
            : await VersionResultAsync(request.OperationId, cancellationToken);
    }

    private async Task<ReviewStep> AdjustInsideTransactionAsync(OccReviewChargeAdjustRequest request,
        CancellationToken cancellationToken)
    {
        var now = Now();
        var (scope, refusal) = await LockAsync(request.ActorAccountId, request.AllowedStationIds, request.OperationId,
            DecidePermission, now, cancellationToken);
        if (scope is null) return refusal;
        var operation = scope.Operation;
        var latest = scope.Latest;
        if (!Matches(scope, request.SubmissionId, request.ConcurrencyToken))
            return ReviewStep.Fail(OccReviewFailure.PreconditionFailed, "version_conflict");
        if (!OccReviewDecisionPolicy.CanDecide(operation.CurrentStatus.ToString(), latest.Status.ToString()))
            return ReviewStep.Fail(OccReviewFailure.Conflict, "review_closed");
        var order = await ServiceOrderSignatures.EvaluateAsync(context, operation.Id, timeProvider, cancellationToken);

        Guid markPublicId;
        string action;
        object metadata;
        if (request.MarkId is Guid markId)
        {
            // Tracked on purpose: a join with an AsNoTracking source would leave the mark untracked and unsaved.
            var mark = await context.OperationServiceCharges.SingleOrDefaultAsync(item => item.PublicId == markId &&
                context.OperationServices.Any(service => service.Id == item.OperationServiceId &&
                    service.GroundOperationId == operation.Id), cancellationToken);
            if (mark is null) return ReviewStep.Fail(OccReviewFailure.NotFound, "not_found");
            if (mark.RemovedAt is not null) return ReviewStep.Fail(OccReviewFailure.Conflict, "charge_already_removed");
            mark.RemovedAt = now;
            mark.RemovedByAccountId = scope.AccountId;
            mark.AdjustmentReason = request.Reason;
            mark.UpdatedAt = now;
            markPublicId = mark.PublicId;
            action = "removed";
            metadata = new { operationId = operation.PublicId, markId, source = mark.Source.ToString() };
        }
        else
        {
            var service = await context.OperationServices.AsNoTracking()
                .SingleOrDefaultAsync(item => item.PublicId == request.ServiceId && item.GroundOperationId == operation.Id,
                    cancellationToken);
            var charge = await context.ChargeDefinitions.AsNoTracking()
                .SingleOrDefaultAsync(item => item.PublicId == request.ChargeId && item.IsActive, cancellationToken);
            if (service is null || charge is null) return ReviewStep.Fail(OccReviewFailure.NotFound, "not_found");
            var applies = charge.AppliesToAllServices || await context.ChargeDefinitionServices.AsNoTracking()
                .AnyAsync(link => link.ChargeDefinitionId == charge.Id && link.ServiceDefinitionId == service.ServiceDefinitionId,
                    cancellationToken);
            if (!applies) return ReviewStep.Fail(OccReviewFailure.Conflict, "charge_not_applicable");
            // 3-N29: OCC never adds what the airline's contract excludes for this service.
            if ((await ContractChargeExclusions.ForServicesAsync(context, [service.Id], cancellationToken))
                .Contains(service.Id, charge.Id))
                return ReviewStep.Fail(OccReviewFailure.Conflict, "charge_excluded_by_contract");
            var duplicate = !charge.AllowMultiple && await context.OperationServiceCharges.AsNoTracking()
                .AnyAsync(item => item.OperationServiceId == service.Id && item.ChargeDefinitionId == charge.Id &&
                    item.RemovedAt == null, cancellationToken);
            if (duplicate) return ReviewStep.Fail(OccReviewFailure.Conflict, "charge_already_marked");
            var added = new OperationServiceCharge
            {
                PublicId = Guid.CreateVersion7(), OperationServiceId = service.Id, ChargeDefinitionId = charge.Id,
                Source = ChargeMarkSource.Occ, AppliedByAccountId = scope.AccountId, AdjustmentReason = request.Reason,
                AppliedAt = now, CreatedAt = now, UpdatedAt = now,
            };
            context.OperationServiceCharges.Add(added);
            markPublicId = added.PublicId;
            action = "added";
            metadata = new { operationId = operation.PublicId, markId = added.PublicId, serviceId = service.PublicId,
                charge = charge.Code };
        }
        // The operation version moves, so a decision prepared on the previous charges is refused.
        operation.UpdatedAt = now;
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = now, ActorType = AuditActorType.Account,
            ActorAccountId = scope.AccountId, ActorDisplay = scope.ActorName, Action = $"occ.operation.charge.{action}",
            EntityType = nameof(OperationServiceCharge), EntityPublicId = latest.PublicId,
            OrganizationId = scope.AirlineOrganizationId, StationId = scope.StationId, Source = AuditSource.Api,
            CorrelationId = request.CorrelationId, RequestId = request.RequestId, Reason = request.Reason,
            MetadataJson = JsonSerializer.Serialize(metadata),
        });
        await context.SaveChangesAsync(cancellationToken);
        // 3-N02: a change to a signed Service Order is recorded as OCC's correction, with this reason.
        await ServiceOrderSignatures.RecordCorrectionAsync(context, operation.Id, order, request.Reason, scope.AccountId,
            now, cancellationToken);
        await RampOperationChangeWriter.AnnounceAsync(context, operation.Id, now, true, cancellationToken);
        return ReviewStep.Done(markPublicId);
    }

    public async Task<OccReviewChargeAdjustResult> SetServiceBillingExclusionAsync(
        OccReviewBillingExclusionRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var hash = CommercialCommandReceipts.Hash(new
        {
            request.OperationId, request.ServiceId, request.SubmissionId, request.Excluded, request.Reason,
            expected = request.ConcurrencyToken,
        });
        var (step, _) = await RunAsync(request.ActorAccountId, request.IdempotencyKey, BillingExclusionAction, hash,
            token => ExcludeInsideTransactionAsync(request, token), cancellationToken);
        return step.Failure is { } failure
            ? OccReviewChargeAdjustResult.Failed(failure, step.Code)
            : await VersionResultAsync(request.OperationId, cancellationToken);
    }

    /// <summary>
    /// 3-N11: excludes a service in exception with an executed quantity from billing (when, who and why), or includes
    /// it again; the history stays in the audit. The review version moves and a signed Service Order records the
    /// change as OCC's correction.
    /// </summary>
    private async Task<ReviewStep> ExcludeInsideTransactionAsync(OccReviewBillingExclusionRequest request,
        CancellationToken cancellationToken)
    {
        var now = Now();
        var (scope, refusal) = await LockAsync(request.ActorAccountId, request.AllowedStationIds, request.OperationId,
            DecidePermission, now, cancellationToken);
        if (scope is null) return refusal;
        var operation = scope.Operation;
        if (!Matches(scope, request.SubmissionId, request.ConcurrencyToken))
            return ReviewStep.Fail(OccReviewFailure.PreconditionFailed, "version_conflict");
        if (!OccReviewDecisionPolicy.CanDecide(operation.CurrentStatus.ToString(), scope.Latest.Status.ToString()))
            return ReviewStep.Fail(OccReviewFailure.Conflict, "review_closed");
        var service = await context.OperationServices.SingleOrDefaultAsync(item =>
            item.PublicId == request.ServiceId && item.GroundOperationId == operation.Id, cancellationToken);
        if (service is null) return ReviewStep.Fail(OccReviewFailure.NotFound, "not_found");
        if (!ServiceBillability.CanExclude(service.CurrentStatus, service.ExecutedQuantity))
            return ReviewStep.Fail(OccReviewFailure.Conflict, "billing_exclusion_not_allowed");
        // Already as asked: nothing changes and the version stays.
        if ((service.BillingExcludedAt is not null) == request.Excluded) return ReviewStep.Done(service.PublicId);
        var order = await ServiceOrderSignatures.EvaluateAsync(context, operation.Id, timeProvider, cancellationToken);
        var previousReason = service.BillingExclusionReason;
        service.BillingExcludedAt = request.Excluded ? now : null;
        service.BillingExcludedByAccountId = request.Excluded ? scope.AccountId : null;
        service.BillingExclusionReason = request.Excluded ? request.Reason : null;
        service.UpdatedAt = now;
        operation.UpdatedAt = now;
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = now, ActorType = AuditActorType.Account,
            ActorAccountId = scope.AccountId, ActorDisplay = scope.ActorName,
            Action = request.Excluded ? "occ.operation.service.billing_excluded" : "occ.operation.service.billing_included",
            EntityType = nameof(OperationService), EntityPublicId = service.PublicId,
            OrganizationId = scope.AirlineOrganizationId, StationId = scope.StationId, Source = AuditSource.Api,
            CorrelationId = request.CorrelationId, RequestId = request.RequestId, Reason = request.Reason,
            MetadataJson = JsonSerializer.Serialize(new
            {
                operationId = operation.PublicId, serviceId = service.PublicId, submissionId = scope.Latest.PublicId,
                excluded = request.Excluded, previousReason,
            }),
        });
        await context.SaveChangesAsync(cancellationToken);
        await ServiceOrderSignatures.RecordCorrectionAsync(context, operation.Id, order, request.Reason, scope.AccountId,
            now, cancellationToken);
        await RampOperationChangeWriter.AnnounceAsync(context, operation.Id, now, true, cancellationToken);
        return ReviewStep.Done(service.PublicId);
    }

    public async Task<OccReviewDecisionWriteResult> DecideAsync(
        OccReviewDecisionWriteRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (request.ActorAccountId == Guid.Empty || request.OperationId == Guid.Empty ||
            request.SubmissionId == Guid.Empty ||
            !OccReviewDecisionPolicy.HasValidRequest(request.Outcome, request.Reason))
            return OccReviewDecisionWriteResult.Failed(OccReviewFailure.InvalidRequest, OccReviewHandler.InvalidRequestCode);
        var hash = CommercialCommandReceipts.Hash(new
        {
            request.OperationId, request.SubmissionId, request.Outcome, request.Reason, expected = request.ConcurrencyToken,
        });
        var (step, _) = await RunAsync(request.ActorAccountId, request.IdempotencyKey, DecideAction, hash,
            token => DecideInsideTransactionAsync(request, token), cancellationToken);
        if (step.Failure is { } failure) return OccReviewDecisionWriteResult.Failed(failure, step.Code);
        var decision = await DecisionAsync(step.ResultId, cancellationToken);
        return decision is null
            ? OccReviewDecisionWriteResult.Failed(OccReviewFailure.NotFound, "not_found")
            : OccReviewDecisionWriteResult.Success(decision, step.ResultId);
    }

    private async Task<ReviewStep> DecideInsideTransactionAsync(
        OccReviewDecisionWriteRequest request, CancellationToken cancellationToken)
    {
        var now = Now();
        var (scope, refusal) = await LockAsync(request.ActorAccountId, request.AllowedStationIds, request.OperationId,
            DecidePermission, now, cancellationToken);
        if (scope is null) return refusal;
        var operation = scope.Operation;
        var latest = scope.Latest;
        if (!Matches(scope, request.SubmissionId, request.ConcurrencyToken))
            return ReviewStep.Fail(OccReviewFailure.PreconditionFailed, "version_conflict");
        if (!OccReviewDecisionPolicy.CanDecide(operation.CurrentStatus.ToString(), latest.Status.ToString()))
            return ReviewStep.Fail(OccReviewFailure.Conflict, "review_closed");
        if (await context.ReviewDecisions.AsNoTracking().AnyAsync(item =>
                item.OperationSubmissionId == latest.Id, cancellationToken))
            return ReviewStep.Fail(OccReviewFailure.Conflict, "review_already_decided");

        var outcome = request.Outcome == "Approved" ? ReviewOutcome.Approved : ReviewOutcome.Returned;
        // 3-H: a reopened revision has nobody on the ramp to correct it; OCC corrects and approves it.
        if (outcome == ReviewOutcome.Returned &&
            !OccReviewDecisionPolicy.CanReturn(latest.ReopenedFromSubmissionId is not null))
            return ReviewStep.Fail(OccReviewFailure.Conflict, "reopened_review_cannot_return");
        if (outcome == ReviewOutcome.Approved)
        {
            // 3-N02: what is approved and billed is the Service Order the airline and AVIAM signed (or OCC's
            // correction of it); otherwise OCC returns it to the ramp to be signed again.
            var order = await ServiceOrderSignatures.EvaluateAsync(context, operation.Id, timeProvider, cancellationToken);
            if (!order.CanBeApproved)
                return ReviewStep.Fail(OccReviewFailure.Conflict,
                    order.State == ServiceOrderStates.Stale ? "service_order_stale" : "service_order_unsigned");
        }

        var status = outcome == ReviewOutcome.Approved
            ? GroundOperationStatus.Approved : GroundOperationStatus.Returned;
        operation.CurrentStatus = status;
        operation.UpdatedAt = now;
        latest.Status = outcome == ReviewOutcome.Approved
            ? SubmissionStatus.Approved : SubmissionStatus.Returned;
        latest.UpdatedAt = now;
        var reviewDecision = new ReviewDecision
        {
            PublicId = Guid.CreateVersion7(),
            OperationSubmissionId = latest.Id,
            Outcome = outcome,
            ReviewerAccountId = scope.AccountId,
            DecidedAt = now,
            Reason = request.Reason,
            CreatedAt = now,
            UpdatedAt = now,
        };
        context.ReviewDecisions.Add(reviewDecision);
        if (outcome == ReviewOutcome.Approved)
            await CloseApprovedAsync(operation, latest, reviewDecision, scope.AccountId, now, cancellationToken);
        await OperationalNotificationWriter.NotifyAgentAsync(
            context, latest.SubmittedByRampAgentId, scope.StationId,
            operation.Id, reviewDecision.PublicId,
            outcome == ReviewOutcome.Approved ? "operation_approved" : "operation_returned",
            now, cancellationToken);
        context.Set<GroundOperationStatusEvent>().Add(new GroundOperationStatusEvent
        {
            GroundOperationId = operation.Id,
            FromStatus = GroundOperationStatus.PendingReview,
            ToStatus = status,
            OccurredAt = now,
            ActorAccountId = scope.AccountId,
            Reason = outcome == ReviewOutcome.Approved
                ? "OCC approved the submitted operation."
                : "OCC returned the submitted operation for correction.",
        });
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(),
            OccurredAt = now,
            ActorType = AuditActorType.Account,
            ActorAccountId = scope.AccountId,
            ActorDisplay = scope.ActorName,
            Action = "occ.operation.review.decided",
            EntityType = nameof(ReviewDecision),
            EntityPublicId = latest.PublicId,
            OrganizationId = scope.AirlineOrganizationId,
            StationId = scope.StationId,
            Source = AuditSource.Api,
            CorrelationId = request.CorrelationId,
            RequestId = request.RequestId,
            Reason = "OCC recorded a scoped review decision.",
            MetadataJson = JsonSerializer.Serialize(new
            {
                operationId = operation.PublicId,
                submissionId = latest.PublicId,
                revision = latest.RevisionNumber,
                outcome = outcome.ToString(),
            }),
        });
        await AirlineOperationChangeWriter.AddAsync(context,
            scope.AirlineOrganizationId, operation.PublicId, now, cancellationToken);
        await RampOperationChangeWriter.AnnounceAsync(context, operation.Id, now, true, cancellationToken,
            latest.SubmittedByRampAgentId);
        if (outcome == ReviewOutcome.Approved)
        {
            await FinanceApprovedServiceChangeWriter.AddAsync(context,
                scope.StationId, operation.PublicId, now, cancellationToken);
            await NotifyReadyToInvoiceAsync(operation, scope.StationId, now, cancellationToken);
        }
        await context.SaveChangesAsync(cancellationToken);
        return ReviewStep.Done(reviewDecision.PublicId);
    }

    /// <summary>
    /// 4-N26: an approved operation with a billable service reaches «Por facturar», so Finance gets an alert. It is one
    /// per airline, station and business day: each approval marks it unread again. Only accounts of Finance with
    /// «Notificaciones», «Facturación» and a live scope on the station receive it.
    /// </summary>
    private async Task NotifyReadyToInvoiceAsync(GroundOperation operation, long stationId, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        if (!await context.OperationServices.AsNoTracking().Where(ServiceBillability.Billable)
                .AnyAsync(service => service.GroundOperationId == operation.Id, cancellationToken))
            return;
        var target = await (from turnaround in context.Turnarounds.AsNoTracking()
                            join airline in context.Airlines.AsNoTracking() on turnaround.AirlineId equals airline.Id
                            join station in context.Stations.AsNoTracking() on turnaround.StationId equals station.Id
                            where turnaround.Id == operation.TurnaroundId
                            select new { Airline = airline.PublicId, airline.Name, Station = station.PublicId })
            .SingleAsync(cancellationToken);
        var day = Elevant.Application.Common.BusinessCalendar.Today(now);
        var sourceId = new Guid(SHA256.HashData(Encoding.UTF8.GetBytes(
            $"operation_ready_to_invoice|{target.Airline:D}|{target.Station:D}|{day:yyyy-MM-dd}")).AsSpan(0, 16));
        await DepartmentNotificationWriter.NotifyAsync(context, Department.Finance,
            GetFinancePendingOperationsHandler.ReadPermission, "operation_ready_to_invoice", sourceId, target.Name, now,
            cancellationToken, stationId);
    }

    /// <summary>
    /// ADR-0034: what OCC approves is the handed-off evidence with the charges as they stand after its
    /// adjustments; the incidents OCC did not manage are resolved with the approval's note (3-G: one OCC
    /// already resolved or closed keeps its note and its author) and the turnaround completes when every
    /// operation of it is approved. A reopened revision (3-H) goes through here again: the release of
    /// block B only announces, so it is the same the second time.
    /// </summary>
    private async Task CloseApprovedAsync(GroundOperation operation, OperationSubmission submission,
        ReviewDecision decision, long reviewerAccountId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var submitted = submission.EvidenceJson is null
            ? await OperationSubmissionEvidence.CaptureAsync(context, operation.Id, cancellationToken)
            : OperationSubmissionEvidence.Parse(submission.EvidenceJson);
        var charges = await OperationSubmissionEvidence.CaptureChargesAsync(context, operation.Id, cancellationToken);
        decision.ApprovedEvidenceJson = (submitted with { Charges = charges }).ToJson();

        var incidents = await context.Incidents
            .Where(item => item.GroundOperationId == operation.Id &&
                (item.Status == IncidentStatus.Open || item.Status == IncidentStatus.InReview))
            .ToArrayAsync(cancellationToken);
        foreach (var incident in incidents)
        {
            context.Set<IncidentStatusEvent>().Add(new IncidentStatusEvent
            {
                IncidentId = incident.Id, FromStatus = incident.Status, ToStatus = IncidentStatus.Resolved,
                Note = ApprovalResolutionNote, OccurredAt = now, ActorAccountId = reviewerAccountId,
            });
            incident.Status = IncidentStatus.Resolved;
            incident.ResolvedAt = now;
            incident.ResolvedByAccountId = reviewerAccountId;
            incident.ResolutionNote = ApprovalResolutionNote;
            incident.UpdatedAt = now;
        }

        var turnaround = await context.Turnarounds.SingleAsync(item => item.Id == operation.TurnaroundId, cancellationToken);
        var othersOpen = await context.GroundOperations.AsNoTracking()
            .AnyAsync(item => item.TurnaroundId == turnaround.Id && item.Id != operation.Id &&
                item.CurrentStatus != GroundOperationStatus.Approved, cancellationToken);
        if (!othersOpen && turnaround.CurrentStatus is not (TurnaroundStatus.Completed or TurnaroundStatus.Cancelled or
                TurnaroundStatus.Diverted))
        {
            context.Set<TurnaroundStatusEvent>().Add(new TurnaroundStatusEvent
            {
                TurnaroundId = turnaround.Id, FromStatus = turnaround.CurrentStatus, ToStatus = TurnaroundStatus.Completed,
                OccurredAt = now, ActorAccountId = reviewerAccountId, Source = OperationalDataSource.Manual,
                Reason = "OCC aprobó la operación: la escala queda cerrada.",
            });
            turnaround.CurrentStatus = TurnaroundStatus.Completed;
            turnaround.UpdatedAt = now;
        }

        // 3-D: the approved operation no longer holds its agent nor its stand (OperationOccupancyRules); the planning
        // board and the agent's schedule hear that both are free. Nothing is closed: the assignment and the stand stay
        // as the record. RampAgentRelease owns this step; every approval keeps calling it.
        await RampAgentRelease.ReleaseOnApprovalAsync(context, operation, turnaround.StationId, now, cancellationToken);
    }

    public async Task<OccReviewReopenResult> ReopenAsync(OccReviewReopenRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var hash = CommercialCommandReceipts.Hash(new
        {
            request.OperationId, request.SubmissionId, request.Reason, expected = request.ConcurrencyToken,
        });
        var (step, replayed) = await RunAsync(request.ActorAccountId, request.IdempotencyKey, ReopenAction, hash,
            token => ReopenInsideTransactionAsync(request, token), cancellationToken);
        if (step.Failure is { } failure) return OccReviewReopenResult.Failed(failure, step.Code);
        var data = await ReopenDataAsync(step.ResultId, cancellationToken);
        return data is null
            ? OccReviewReopenResult.Failed(OccReviewFailure.NotFound, "not_found")
            : new OccReviewReopenResult(data, null, null, replayed);
    }

    /// <summary>
    /// 3-H: an approval nothing was invoiced from yet becomes revision N+1, pending, with the same hand-off (evidence,
    /// time, agent, checklist and note), its reason and who reopened it. Revision N keeps its decision and its
    /// approved evidence as history. The turnaround stays completed and the agent and the stand stay free (3-D);
    /// the incidents keep their state. «Por facturar» stops listing it until OCC approves it again.
    /// </summary>
    private async Task<ReviewStep> ReopenInsideTransactionAsync(OccReviewReopenRequest request,
        CancellationToken cancellationToken)
    {
        var now = Now();
        var (scope, refusal) = await LockAsync(request.ActorAccountId, request.AllowedStationIds, request.OperationId,
            ReopenPermission, now, cancellationToken);
        if (scope is null) return refusal;
        var operation = scope.Operation;
        var latest = scope.Latest;
        if (!Matches(scope, request.SubmissionId, request.ConcurrencyToken))
            return ReviewStep.Fail(OccReviewFailure.PreconditionFailed, "version_conflict");
        if (!OccReviewDecisionPolicy.CanReopen(operation.CurrentStatus.ToString(), latest.Status.ToString()))
            return ReviewStep.Fail(OccReviewFailure.Conflict, "review_not_approved");
        // Once anything of it is on a preinvoice (an issued e-CF included), the correction is a credit note.
        var serviceIds = await context.OperationServices.AsNoTracking()
            .Where(service => service.GroundOperationId == operation.Id).Select(service => service.Id)
            .ToArrayAsync(cancellationToken);
        if (await context.PreinvoiceLines.AsNoTracking().AnyAsync(line => line.ReleasedAt == null &&
                ((line.OperationServiceId != null && serviceIds.Contains(line.OperationServiceId.Value)) ||
                 line.ApprovedSubmissionId == latest.Id), cancellationToken))
            return ReviewStep.Fail(OccReviewFailure.Conflict, "already_invoiced");
        // 3-N02: the new revision is approved again only on a signed (or corrected) Service Order and never goes back
        // to the ramp to be signed, so an approval whose order is not signed as it stands is not reopened.
        var order = await ServiceOrderSignatures.EvaluateAsync(context, operation.Id, timeProvider, cancellationToken);
        if (!order.CanBeApproved)
            return ReviewStep.Fail(OccReviewFailure.Conflict,
                order.State == ServiceOrderStates.Stale ? "service_order_stale" : "service_order_unsigned");

        var reopened = new OperationSubmission
        {
            PublicId = Guid.CreateVersion7(),
            GroundOperationId = operation.Id,
            OperationChecklistId = latest.OperationChecklistId,
            RevisionNumber = checked(latest.RevisionNumber + 1),
            Status = SubmissionStatus.PendingReview,
            SubmittedByRampAgentId = latest.SubmittedByRampAgentId,
            SubmittedAt = latest.SubmittedAt,
            AgentNote = latest.AgentNote,
            EvidenceJson = latest.EvidenceJson,
            ReopenedFromSubmissionId = latest.Id,
            ReopenedByAccountId = scope.AccountId,
            ReopenReason = request.Reason,
            CreatedAt = now,
            UpdatedAt = now,
        };
        context.OperationSubmissions.Add(reopened);
        operation.CurrentStatus = GroundOperationStatus.PendingReview;
        operation.UpdatedAt = now;
        context.Set<GroundOperationStatusEvent>().Add(new GroundOperationStatusEvent
        {
            GroundOperationId = operation.Id,
            FromStatus = GroundOperationStatus.Approved,
            ToStatus = GroundOperationStatus.PendingReview,
            OccurredAt = now,
            ActorAccountId = scope.AccountId,
            Reason = Truncate($"OCC reabrió la aprobación: {request.Reason}", 1000),
        });
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = now, ActorType = AuditActorType.Account,
            ActorAccountId = scope.AccountId, ActorDisplay = scope.ActorName, Action = "occ.operation.review.reopened",
            EntityType = nameof(OperationSubmission), EntityPublicId = reopened.PublicId,
            OrganizationId = scope.AirlineOrganizationId, StationId = scope.StationId, Source = AuditSource.Api,
            CorrelationId = request.CorrelationId, RequestId = request.RequestId, Reason = request.Reason,
            MetadataJson = JsonSerializer.Serialize(new
            {
                operationId = operation.PublicId, submissionId = reopened.PublicId, reopenedFrom = latest.PublicId,
                revision = reopened.RevisionNumber,
            }),
        });
        await AirlineOperationChangeWriter.AddAsync(context, scope.AirlineOrganizationId, operation.PublicId, now,
            cancellationToken);
        await RampOperationChangeWriter.AnnounceAsync(context, operation.Id, now, true, cancellationToken,
            latest.SubmittedByRampAgentId);
        await FinanceApprovedServiceChangeWriter.AddAsync(context, scope.StationId, operation.PublicId, now,
            cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
        return ReviewStep.Done(reopened.PublicId);
    }

    /// <summary>
    /// Runs one review command in a serializable transaction. With an Idempotency-Key the receipt is looked up first
    /// and written with the work: a replay answers the record the first attempt wrote, the key with another actor,
    /// command or body is <c>idempotency_conflict</c>. A stale row is a failed precondition (<c>version_conflict</c>,
    /// 412); a deadlock or snapshot conflict that kept repeating is a 409 <c>version_conflict</c>: re-read and decide
    /// again.
    /// </summary>
    private async Task<(ReviewStep Step, bool Replayed)> RunAsync(Guid actorId, Guid? idempotencyKey, string action,
        string hash, Func<CancellationToken, Task<ReviewStep>> work, CancellationToken cancellationToken)
    {
        long accountId = 0;
        if (idempotencyKey is Guid)
        {
            var account = await context.Users.AsNoTracking().Where(user => user.PublicId == actorId)
                .Select(user => (long?)user.Id).SingleOrDefaultAsync(cancellationToken);
            if (account is not long id) return (ReviewStep.Fail(OccReviewFailure.NotFound, "not_found"), false);
            accountId = id;
        }
        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(IsolationLevel.Serializable,
                    cancellationToken);
                if (idempotencyKey is Guid key)
                {
                    var prior = await CommercialCommandReceipts.FindAsync(context, key, accountId, action, hash,
                        cancellationToken);
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Conflict)
                        return (ReviewStep.Fail(OccReviewFailure.Conflict, "idempotency_conflict"), false);
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Replay)
                        return (ReviewStep.Done(prior.ResultId), true);
                }
                var step = await work(cancellationToken);
                if (step.Failure is not null)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    context.ChangeTracker.Clear();
                    return (step, false);
                }
                if (idempotencyKey is Guid used)
                    CommercialCommandReceipts.Add(context, used, accountId, action, hash, step.ResultId, Now());
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return (step, false);
            });
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return (ReviewStep.Fail(OccReviewFailure.PreconditionFailed, "version_conflict"), false);
        }
        catch (DbUpdateException exception) when (idempotencyKey is Guid key && CommercialCommandReceipts.IsDuplicateKey(exception))
        {
            // A concurrent attempt with the same key committed first: answer what it wrote.
            context.ChangeTracker.Clear();
            var concurrent = await CommercialCommandReceipts.FindAsync(context, key, accountId, action, hash,
                cancellationToken);
            return concurrent.Outcome == CommercialCommandReceipts.Outcome.Replay
                ? (ReviewStep.Done(concurrent.ResultId), true)
                : (ReviewStep.Fail(OccReviewFailure.Conflict, "idempotency_conflict"), false);
        }
        catch (Exception exception) when (exception is RetryLimitExceededException or DbUpdateException or SqlException &&
            exception.GetBaseException() is SqlException { Number: 1205 or 1222 or 3960 or 2601 or 2627 or 547 })
        {
            context.ChangeTracker.Clear();
            return (ReviewStep.Fail(OccReviewFailure.Conflict, "version_conflict"), false);
        }
    }

    /// <summary>
    /// Re-resolves the live actor (permission, internal membership and station) and locks the operation and its
    /// hand-offs; a refused actor sees nothing (<c>not_found</c>).
    /// </summary>
    private async Task<(CommandScope? Scope, ReviewStep Refusal)> LockAsync(Guid actorAccountId,
        IReadOnlyCollection<Guid> allowedStationIds, Guid operationId, string permission, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var notFound = ReviewStep.Fail(OccReviewFailure.NotFound, "not_found");
        var liveActor = await new EfActorContextResolver(context, timeProvider)
            .ResolveAsync(actorAccountId, cancellationToken);
        if (liveActor is null || !liveActor.HasPermission(permission) ||
            !liveActor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff))
            return (null, notFound);
        var liveStations = liveActor.StationScopes.Select(item => item.StationId)
            .Intersect(allowedStationIds).ToArray();
        if (liveStations.Length == 0) return (null, notFound);
        var operation = await context.GroundOperations
            .FromSqlInterpolated($"""
                SELECT * FROM [ops].[ground_operations] WITH (UPDLOCK, HOLDLOCK)
                WHERE [public_id] = {operationId}
                """)
            .SingleOrDefaultAsync(cancellationToken);
        if (operation is null) return (null, notFound);
        var scope = await (
            from turnaround in context.Turnarounds.AsNoTracking()
            join station in context.Stations.AsNoTracking()
                on turnaround.StationId equals station.Id
            join airline in context.Airlines.AsNoTracking()
                on turnaround.AirlineId equals airline.Id
            join account in context.Users.AsNoTracking()
                on actorAccountId equals account.PublicId
            where turnaround.Id == operation.TurnaroundId && station.IsActive &&
                  liveStations.Contains(station.PublicId) &&
                  context.AccountStationScopes.AsNoTracking().Any(actorScope =>
                      actorScope.AccountId == account.Id &&
                      actorScope.StationId == station.Id &&
                      actorScope.GrantedAt <= now && actorScope.RevokedAt == null)
            select new { StationId = station.Id, AirlineOrganizationId = airline.OrganizationId,
                AccountId = account.Id, ActorName = account.UserName })
            .SingleOrDefaultAsync(cancellationToken);
        if (scope is null) return (null, notFound);
        var submissions = await context.OperationSubmissions
            .FromSqlInterpolated($"""
                SELECT * FROM [ops].[operation_submissions] WITH (UPDLOCK, HOLDLOCK)
                WHERE [ground_operation_id] = {operation.Id}
                """)
            .ToArrayAsync(cancellationToken);
        var latest = submissions.MaxBy(item => item.RevisionNumber);
        if (latest is null) return (null, notFound);
        return (new CommandScope(operation, latest, scope.StationId, scope.AirlineOrganizationId, scope.AccountId,
            scope.ActorName ?? string.Empty), default);
    }

    /// <summary>The command names the latest hand-off with the review version OCC saw.</summary>
    private static bool Matches(CommandScope scope, Guid submissionId, string concurrencyToken) =>
        scope.Latest.PublicId == submissionId &&
        ConcurrencyToken(scope.Operation.PublicId, scope.Operation.RowVersion, scope.Latest.PublicId,
            scope.Latest.Status) == concurrencyToken;

    /// <summary>The review version as it stands now: what the next command must send in If-Match.</summary>
    private async Task<OccReviewChargeAdjustResult> VersionResultAsync(Guid operationId,
        CancellationToken cancellationToken)
    {
        var row = await context.GroundOperations.AsNoTracking()
            .Where(operation => operation.PublicId == operationId)
            .Select(operation => new
            {
                operation.PublicId, operation.RowVersion,
                Latest = context.OperationSubmissions.Where(item => item.GroundOperationId == operation.Id)
                    .OrderByDescending(item => item.RevisionNumber)
                    .Select(item => new { item.PublicId, item.Status }).FirstOrDefault(),
            })
            .SingleOrDefaultAsync(cancellationToken);
        return row?.Latest is null
            ? OccReviewChargeAdjustResult.Failed(OccReviewFailure.NotFound, "not_found")
            : new OccReviewChargeAdjustResult(
                ConcurrencyToken(row.PublicId, row.RowVersion, row.Latest.PublicId, row.Latest.Status), null);
    }

    private async Task<OccReviewDecisionWriteData?> DecisionAsync(Guid decisionId, CancellationToken cancellationToken)
    {
        var row = await (from decision in context.ReviewDecisions.AsNoTracking()
                         join submission in context.OperationSubmissions.AsNoTracking()
                             on decision.OperationSubmissionId equals submission.Id
                         join operation in context.GroundOperations.AsNoTracking()
                             on submission.GroundOperationId equals operation.Id
                         where decision.PublicId == decisionId
                         select new
                         {
                             OperationId = operation.PublicId, SubmissionId = submission.PublicId, submission.Status,
                             decision.Outcome, decision.DecidedAt, decision.Reason,
                         }).SingleOrDefaultAsync(cancellationToken);
        return row is null ? null : new OccReviewDecisionWriteData(row.OperationId, row.SubmissionId,
            row.Status.ToString(), row.Outcome.ToString(), row.DecidedAt, row.Reason);
    }

    private async Task<OccReviewReopenData?> ReopenDataAsync(Guid submissionId, CancellationToken cancellationToken)
    {
        var row = await (from submission in context.OperationSubmissions.AsNoTracking()
                         join operation in context.GroundOperations.AsNoTracking()
                             on submission.GroundOperationId equals operation.Id
                         where submission.PublicId == submissionId
                         select new
                         {
                             OperationId = operation.PublicId, operation.RowVersion, submission.PublicId,
                             submission.RevisionNumber, submission.Status,
                             Latest = context.OperationSubmissions.Where(item => item.GroundOperationId == operation.Id)
                                 .OrderByDescending(item => item.RevisionNumber)
                                 .Select(item => new { item.PublicId, item.Status }).FirstOrDefault(),
                         }).SingleOrDefaultAsync(cancellationToken);
        if (row?.Latest is null) return null;
        return new OccReviewReopenData(row.OperationId, row.PublicId, row.RevisionNumber, row.Status.ToString(),
            ConcurrencyToken(row.OperationId, row.RowVersion, row.Latest.PublicId, row.Latest.Status));
    }

    private static string ConcurrencyToken(
        Guid operationId, byte[] rowVersion, Guid submissionId, SubmissionStatus status)
    {
        var source = $"{operationId:D}|{Convert.ToHexString(rowVersion)}|{submissionId:D}|{status}";
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(source));
        return $"\"{Convert.ToHexString(hash).ToLowerInvariant()}\"";
    }

    private DateTimeOffset Now() => NormalizeToMilliseconds(timeProvider.GetUtcNow());

    private static DateTimeOffset NormalizeToMilliseconds(DateTimeOffset value)
    {
        var utc = value.ToUniversalTime();
        return new DateTimeOffset(utc.Ticks - utc.Ticks % TimeSpan.TicksPerMillisecond, TimeSpan.Zero);
    }

    private static string Truncate(string value, int maximum) => value.Length <= maximum ? value : value[..maximum];
}
