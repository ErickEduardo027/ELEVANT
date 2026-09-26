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
        var decision = await context.ReviewDecisions.AsNoTracking()
            .Where(item => item.OperationSubmissionId == core.SubmissionInternalId)
            .Select(item => new OccReviewDecisionData(
                item.Outcome.ToString(), item.Reason, item.DecidedAt))
            .SingleOrDefaultAsync(cancellationToken);

        return new OccReviewDetailData(
            core.OperationId, core.SubmissionId, core.RevisionNumber,
            core.Status.ToString(), core.OperationCode, core.OperationDate,
            core.StationId, core.StationCode, core.IanaTimeZone,
            core.AirlineName, core.AgentName.Trim(), core.PlannedStartAt,
            core.PlannedEndAt, core.ActualStartAt, core.SubmittedAt,
            core.SubmittedAt, core.AgentNote, core.ChecklistStatus.ToString(),
            answers, evidence.Services, evidence.Incidents, decision,
            ConcurrencyToken(core.OperationId, core.RowVersion, core.SubmissionId, core.Status));
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
            !liveActor.Roles.Any(role => role.Code == "ADMIN_OCC" &&
                role.Portal == PortalKind.BackOffice) ||
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
        if (outcome == ReviewOutcome.Approved)
            await FinanceApprovedServiceChangeWriter.AddAsync(context,
                scope.StationId, operation.PublicId, now, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
        return OccReviewDecisionWriteResult.Success(new OccReviewDecisionWriteData(
            operation.PublicId, latest.PublicId, latest.Status.ToString(), outcome.ToString(),
            now, request.Reason), audit.PublicId);
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
