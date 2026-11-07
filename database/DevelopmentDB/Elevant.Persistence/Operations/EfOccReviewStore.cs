using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Elevant.Persistence.Finance;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Elevant.Persistence.Operations;

/// <summary>Station-scoped OCC review projections and serialized decisions.</summary>
internal sealed class EfOccReviewStore(ElevantDbContext context, TimeProvider timeProvider) : IOccReviewStore
{
    private const int QueueLimit = 100;

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
        var canAdjust = core.Status == SubmissionStatus.PendingReview && core.RevisionNumber == latestRevision;
        var close = await CloseAsync(core.OperationInternalId, evidence,
            decisionRow?.ApprovedEvidenceJson is { } approved ? OperationSubmissionEvidence.Parse(approved) : null,
            canAdjust, cancellationToken);

        return new OccReviewDetailData(
            core.OperationId, core.SubmissionId, core.RevisionNumber,
            core.Status.ToString(), core.OperationCode, core.OperationDate,
            core.StationId, core.StationCode, core.IanaTimeZone,
            core.AirlineName, core.AgentName.Trim(), core.PlannedStartAt,
            core.PlannedEndAt, core.ActualStartAt, core.ActualEndAt ?? core.SubmittedAt,
            core.SubmittedAt, core.AgentNote, core.ChecklistStatus.ToString(),
            answers, evidence.Services, evidence.Incidents, decision,
            ConcurrencyToken(core.OperationId, core.RowVersion, core.SubmissionId, core.Status), close);
    }

    /// <summary>
    /// What OCC closes the operation with (ADR-0034): recorded times, the charges (live while it can
    /// still adjust them, otherwise as approved or as handed off) and the charges it may add.
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
                .Select(service => new { service.PublicId, service.ServiceDefinitionId }).ToArrayAsync(cancellationToken);
            var links = await context.ChargeDefinitionServices.AsNoTracking()
                .Select(link => new { link.ChargeDefinitionId, link.ServiceDefinitionId }).ToArrayAsync(cancellationToken);
            foreach (var charge in definitions.Where(item => item.IsActive).OrderBy(item => item.Name))
            {
                var serviceIds = services.Where(service => charge.AppliesToAllServices || links.Any(link =>
                        link.ChargeDefinitionId == charge.Id && link.ServiceDefinitionId == service.ServiceDefinitionId))
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
        return new OccReviewCloseData(milestones, charges, options, timing, canAdjust, damages);
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
        var strategy = context.Database.CreateExecutionStrategy();
        OccReviewChargeAdjustResult? attempt = null;
        Guid? auditId = null;
        try
        {
            return await strategy.ExecuteInTransactionAsync(
                async token =>
                {
                    context.ChangeTracker.Clear();
                    (attempt, auditId) = await AdjustInsideTransactionAsync(request, token);
                    if (!attempt.IsSuccess) context.ChangeTracker.Clear();
                    return attempt;
                },
                async token =>
                {
                    context.ChangeTracker.Clear();
                    return auditId is not Guid id ||
                        await context.AuditEntries.AsNoTracking().AnyAsync(item => item.PublicId == id, token);
                },
                IsolationLevel.Serializable,
                cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return new OccReviewChargeAdjustResult(null, OccReviewFailure.PreconditionFailed);
        }
        catch (Exception exception) when (exception is RetryLimitExceededException or DbUpdateException or SqlException &&
            exception.GetBaseException() is SqlException { Number: 1205 or 1222 or 3960 or 2601 or 2627 or 547 })
        {
            context.ChangeTracker.Clear();
            return new OccReviewChargeAdjustResult(null, OccReviewFailure.Conflict);
        }
    }

    private async Task<(OccReviewChargeAdjustResult Result, Guid? AuditId)> AdjustInsideTransactionAsync(
        OccReviewChargeAdjustRequest request, CancellationToken cancellationToken)
    {
        static (OccReviewChargeAdjustResult, Guid?) Fail(OccReviewFailure failure) =>
            (new OccReviewChargeAdjustResult(null, failure), null);
        var liveActor = await new EfActorContextResolver(context, timeProvider)
            .ResolveAsync(request.ActorAccountId, cancellationToken);
        if (liveActor is null || !liveActor.HasPermission("operations.review.decide"))
            return Fail(OccReviewFailure.NotFound);
        var liveStations = liveActor.StationScopes.Select(item => item.StationId)
            .Intersect(request.AllowedStationIds).ToArray();
        if (liveStations.Length == 0) return Fail(OccReviewFailure.NotFound);
        var now = NormalizeToMilliseconds(timeProvider.GetUtcNow());
        var operation = await context.GroundOperations
            .FromSqlInterpolated($"""
                SELECT * FROM [ops].[ground_operations] WITH (UPDLOCK, HOLDLOCK)
                WHERE [public_id] = {request.OperationId}
                """)
            .SingleOrDefaultAsync(cancellationToken);
        if (operation is null) return Fail(OccReviewFailure.NotFound);
        var scope = await (from turnaround in context.Turnarounds.AsNoTracking()
                           join station in context.Stations.AsNoTracking() on turnaround.StationId equals station.Id
                           join airline in context.Airlines.AsNoTracking() on turnaround.AirlineId equals airline.Id
                           join account in context.Users.AsNoTracking() on request.ActorAccountId equals account.PublicId
                           where turnaround.Id == operation.TurnaroundId && station.IsActive &&
                                 liveStations.Contains(station.PublicId)
                           select new { StationId = station.Id, AirlineOrganizationId = airline.OrganizationId,
                               AccountId = account.Id, ActorName = account.UserName })
            .SingleOrDefaultAsync(cancellationToken);
        if (scope is null) return Fail(OccReviewFailure.NotFound);
        var latest = await context.OperationSubmissions.AsNoTracking()
            .Where(item => item.GroundOperationId == operation.Id)
            .OrderByDescending(item => item.RevisionNumber).FirstOrDefaultAsync(cancellationToken);
        if (latest is null || latest.PublicId != request.SubmissionId ||
            ConcurrencyToken(operation.PublicId, operation.RowVersion, latest.PublicId, latest.Status) != request.ConcurrencyToken)
            return Fail(OccReviewFailure.PreconditionFailed);
        if (!OccReviewDecisionPolicy.CanDecide(operation.CurrentStatus.ToString(), latest.Status.ToString()))
            return Fail(OccReviewFailure.Conflict);

        string action;
        object metadata;
        if (request.MarkId is Guid markId)
        {
            // Tracked on purpose: a join with an AsNoTracking source would leave the mark untracked and unsaved.
            var mark = await context.OperationServiceCharges.SingleOrDefaultAsync(item => item.PublicId == markId &&
                context.OperationServices.Any(service => service.Id == item.OperationServiceId &&
                    service.GroundOperationId == operation.Id), cancellationToken);
            if (mark is null) return Fail(OccReviewFailure.NotFound);
            if (mark.RemovedAt is not null) return Fail(OccReviewFailure.Conflict);
            mark.RemovedAt = now;
            mark.RemovedByAccountId = scope.AccountId;
            mark.AdjustmentReason = request.Reason;
            mark.UpdatedAt = now;
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
            if (service is null || charge is null) return Fail(OccReviewFailure.NotFound);
            var applies = charge.AppliesToAllServices || await context.ChargeDefinitionServices.AsNoTracking()
                .AnyAsync(link => link.ChargeDefinitionId == charge.Id && link.ServiceDefinitionId == service.ServiceDefinitionId,
                    cancellationToken);
            var duplicate = !charge.AllowMultiple && await context.OperationServiceCharges.AsNoTracking()
                .AnyAsync(item => item.OperationServiceId == service.Id && item.ChargeDefinitionId == charge.Id &&
                    item.RemovedAt == null, cancellationToken);
            if (!applies || duplicate) return Fail(OccReviewFailure.Conflict);
            var added = new OperationServiceCharge
            {
                PublicId = Guid.CreateVersion7(), OperationServiceId = service.Id, ChargeDefinitionId = charge.Id,
                Source = ChargeMarkSource.Occ, AppliedByAccountId = scope.AccountId, AdjustmentReason = request.Reason,
                AppliedAt = now, CreatedAt = now, UpdatedAt = now,
            };
            context.OperationServiceCharges.Add(added);
            action = "added";
            metadata = new { operationId = operation.PublicId, markId = added.PublicId, serviceId = service.PublicId,
                charge = charge.Code };
        }
        // The operation version moves, so a decision prepared on the previous charges is refused.
        operation.UpdatedAt = now;
        var audit = new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = now, ActorType = AuditActorType.Account,
            ActorAccountId = scope.AccountId, ActorDisplay = scope.ActorName, Action = $"occ.operation.charge.{action}",
            EntityType = nameof(OperationServiceCharge), EntityPublicId = latest.PublicId,
            OrganizationId = scope.AirlineOrganizationId, StationId = scope.StationId, Source = AuditSource.Api,
            CorrelationId = request.CorrelationId, RequestId = request.RequestId, Reason = request.Reason,
            MetadataJson = JsonSerializer.Serialize(metadata),
        };
        context.AuditEntries.Add(audit);
        await context.SaveChangesAsync(cancellationToken);
        return (new OccReviewChargeAdjustResult(
            ConcurrencyToken(operation.PublicId, operation.RowVersion, latest.PublicId, latest.Status), null), audit.PublicId);
    }

    public async Task<OccReviewDecisionWriteResult> DecideAsync(
        OccReviewDecisionWriteRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var strategy = context.Database.CreateExecutionStrategy();
        OccReviewDecisionWriteResult? attempt = null;
        try
        {
            return await strategy.ExecuteInTransactionAsync(
                async token =>
                {
                    context.ChangeTracker.Clear();
                    attempt = await DecideInsideTransactionAsync(request, token);
                    if (!attempt.IsSuccess) context.ChangeTracker.Clear();
                    return attempt;
                },
                async token =>
                {
                    context.ChangeTracker.Clear();
                    return attempt?.CommitAuditId is not Guid auditId ||
                        await context.AuditEntries.AsNoTracking().AnyAsync(item =>
                            item.PublicId == auditId &&
                            item.CorrelationId == request.CorrelationId &&
                            item.Action == "occ.operation.review.decided", token);
                },
                IsolationLevel.Serializable,
                cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return OccReviewDecisionWriteResult.Failed(OccReviewFailure.PreconditionFailed);
        }
        catch (RetryLimitExceededException exception) when (IsSerializationConflict(exception))
        {
            context.ChangeTracker.Clear();
            return OccReviewDecisionWriteResult.Failed(OccReviewFailure.Conflict);
        }
        catch (DbUpdateException exception) when (IsOperationalConflict(exception))
        {
            context.ChangeTracker.Clear();
            return OccReviewDecisionWriteResult.Failed(OccReviewFailure.Conflict);
        }
        catch (SqlException exception) when (IsSerializationConflict(exception.Number))
        {
            context.ChangeTracker.Clear();
            return OccReviewDecisionWriteResult.Failed(OccReviewFailure.Conflict);
        }
    }

    private async Task<OccReviewDecisionWriteResult> DecideInsideTransactionAsync(
        OccReviewDecisionWriteRequest request, CancellationToken cancellationToken)
    {
        if (request.ActorAccountId == Guid.Empty || request.OperationId == Guid.Empty ||
            request.SubmissionId == Guid.Empty ||
            !OccReviewDecisionPolicy.HasValidRequest(request.Outcome, request.Reason))
            return Failed(OccReviewFailure.InvalidRequest);
        var liveActor = await new EfActorContextResolver(context, timeProvider)
            .ResolveAsync(request.ActorAccountId, cancellationToken);
        if (liveActor is null ||
            !liveActor.HasPermission("operations.review.decide") ||
            !liveActor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff))
            return Failed(OccReviewFailure.NotFound);
        var liveStations = liveActor.StationScopes.Select(item => item.StationId)
            .Intersect(request.AllowedStationIds).ToArray();
        if (liveStations.Length == 0) return Failed(OccReviewFailure.NotFound);

        var now = NormalizeToMilliseconds(timeProvider.GetUtcNow());
        var operation = await context.GroundOperations
            .FromSqlInterpolated($"""
                SELECT * FROM [ops].[ground_operations] WITH (UPDLOCK, HOLDLOCK)
                WHERE [public_id] = {request.OperationId}
                """)
            .SingleOrDefaultAsync(cancellationToken);
        if (operation is null) return Failed(OccReviewFailure.NotFound);
        var scope = await (
            from turnaround in context.Turnarounds.AsNoTracking()
            join station in context.Stations.AsNoTracking()
                on turnaround.StationId equals station.Id
            join airline in context.Airlines.AsNoTracking()
                on turnaround.AirlineId equals airline.Id
            join account in context.Users.AsNoTracking()
                on request.ActorAccountId equals account.PublicId
            where turnaround.Id == operation.TurnaroundId && station.IsActive &&
                  liveStations.Contains(station.PublicId) &&
                  context.AccountStationScopes.AsNoTracking().Any(actorScope =>
                      actorScope.AccountId == account.Id &&
                      actorScope.StationId == station.Id &&
                      actorScope.GrantedAt <= now && actorScope.RevokedAt == null)
            select new { StationId = station.Id, AirlineOrganizationId = airline.OrganizationId,
                AccountId = account.Id, ActorName = account.UserName })
            .SingleOrDefaultAsync(cancellationToken);
        if (scope is null) return Failed(OccReviewFailure.NotFound);

        var submissions = await context.OperationSubmissions
            .FromSqlInterpolated($"""
                SELECT * FROM [ops].[operation_submissions] WITH (UPDLOCK, HOLDLOCK)
                WHERE [ground_operation_id] = {operation.Id}
                """)
            .ToArrayAsync(cancellationToken);
        var latest = submissions.MaxBy(item => item.RevisionNumber);
        if (latest is null || latest.PublicId != request.SubmissionId)
            return Failed(OccReviewFailure.PreconditionFailed);
        if (ConcurrencyToken(operation.PublicId, operation.RowVersion,
                latest.PublicId, latest.Status) != request.ConcurrencyToken)
            return Failed(OccReviewFailure.PreconditionFailed);
        if (!OccReviewDecisionPolicy.CanDecide(
                operation.CurrentStatus.ToString(), latest.Status.ToString()))
            return Failed(OccReviewFailure.Conflict);
        if (await context.ReviewDecisions.AsNoTracking().AnyAsync(item =>
                item.OperationSubmissionId == latest.Id, cancellationToken))
            return Failed(OccReviewFailure.Conflict);

        var outcome = request.Outcome == "Approved" ? ReviewOutcome.Approved : ReviewOutcome.Returned;
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
        var audit = new AuditEntry
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
        };
        context.AuditEntries.Add(audit);
        await AirlineOperationChangeWriter.AddAsync(context,
            scope.AirlineOrganizationId, operation.PublicId, now, cancellationToken);
        await RampOperationChangeWriter.AnnounceAsync(context, operation.Id, now, true, cancellationToken,
            latest.SubmittedByRampAgentId);
        if (outcome == ReviewOutcome.Approved)
            await FinanceApprovedServiceChangeWriter.AddAsync(context,
                scope.StationId, operation.PublicId, now, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
        return OccReviewDecisionWriteResult.Success(new OccReviewDecisionWriteData(
            operation.PublicId, latest.PublicId, latest.Status.ToString(), outcome.ToString(),
            now, request.Reason), audit.PublicId);
    }

    /// <summary>
    /// ADR-0034: what OCC approves is the handed-off evidence with the charges as they stand after its
    /// adjustments; the open incidents are closed and the turnaround completes when every operation of
    /// it is approved.
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
                item.Status != IncidentStatus.Resolved && item.Status != IncidentStatus.Closed)
            .ToArrayAsync(cancellationToken);
        foreach (var incident in incidents)
        {
            incident.Status = IncidentStatus.Resolved;
            incident.ResolvedAt = now;
            incident.ResolvedByAccountId = reviewerAccountId;
            incident.ResolutionNote = "Cerrada al aprobar la revisión de OCC.";
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

    private static string ConcurrencyToken(
        Guid operationId, byte[] rowVersion, Guid submissionId, SubmissionStatus status)
    {
        var source = $"{operationId:D}|{Convert.ToHexString(rowVersion)}|{submissionId:D}|{status}";
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(source));
        return $"\"{Convert.ToHexString(hash).ToLowerInvariant()}\"";
    }

    private static DateTimeOffset NormalizeToMilliseconds(DateTimeOffset value)
    {
        var utc = value.ToUniversalTime();
        return new DateTimeOffset(utc.Ticks - utc.Ticks % TimeSpan.TicksPerMillisecond, TimeSpan.Zero);
    }

    private static OccReviewDecisionWriteResult Failed(OccReviewFailure failure) =>
        OccReviewDecisionWriteResult.Failed(failure);

    private static bool IsOperationalConflict(DbUpdateException exception) =>
        exception.GetBaseException() is SqlException sqlException &&
        (sqlException.Number is 2601 or 2627 or 547 || IsSerializationConflict(sqlException.Number));

    private static bool IsSerializationConflict(int number) => number is 1205 or 1222 or 3960;

    private static bool IsSerializationConflict(Exception exception) =>
        exception.GetBaseException() is SqlException sqlException &&
        IsSerializationConflict(sqlException.Number);
}
