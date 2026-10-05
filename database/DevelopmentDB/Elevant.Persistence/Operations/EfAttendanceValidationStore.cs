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
using Elevant.Persistence.Realtime;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Elevant.Persistence.Operations;

/// <summary>Reads assignment evidence and appends version-bound G.H. decisions.</summary>
internal sealed class EfAttendanceValidationStore(
    ElevantDbContext context, TimeProvider timeProvider) : IAttendanceValidationStore
{
    public async Task<HumanResourcesAttendancePage?> ListAsync(
        Guid actorAccountId, Guid stationId, DateOnly startDate, DateOnly endDate,
        int page, int limit, CancellationToken cancellationToken = default)
    {
        if (actorAccountId == Guid.Empty || stationId == Guid.Empty || startDate == default ||
            endDate < startDate || endDate.DayNumber - startDate.DayNumber >= 30 || page < 1 ||
            limit is < 1 or > 100 || (long)(page - 1) * limit > int.MaxValue)
            throw new ArgumentOutOfRangeException(nameof(startDate));

        var actor = await ResolveHumanResourcesAsync(actorAccountId, cancellationToken);
        if (actor is null) return null;
        if (!actor.StationScopes.Any(scope => scope.StationId == stationId))
            return new HumanResourcesAttendancePage(stationId, startDate, endDate, page, limit,
                false, []);

        var rows = await (
            from assignment in context.OperationAgentAssignments.AsNoTracking()
            join operation in context.GroundOperations.AsNoTracking()
                on assignment.GroundOperationId equals operation.Id
            join turnaround in context.Turnarounds.AsNoTracking()
                on operation.TurnaroundId equals turnaround.Id
            join station in context.Stations.AsNoTracking()
                on turnaround.StationId equals station.Id
            join agent in context.RampAgents.AsNoTracking()
                on assignment.RampAgentId equals agent.Id
            join person in context.Persons.AsNoTracking()
                on agent.PersonId equals person.Id
            where station.PublicId == stationId && station.IsActive &&
                turnaround.OperationDate >= startDate && turnaround.OperationDate <= endDate
            orderby turnaround.OperationDate, turnaround.OperationCode, assignment.Id
            select new
            {
                AssignmentId = assignment.Id,
                AssignmentPublicId = assignment.PublicId,
                OperationId = operation.PublicId,
                turnaround.OperationDate,
                turnaround.OperationCode,
                person.FirstName,
                person.LastName,
            }).Skip((page - 1) * limit).Take(limit + 1)
            .ToArrayAsync(cancellationToken);

        var pageRows = rows.Take(limit).ToArray();
        if (pageRows.Length == 0)
            return new HumanResourcesAttendancePage(stationId, startDate, endDate,
                page, limit, rows.Length > limit, []);

        var assignmentIds = pageRows.Select(row => row.AssignmentId).ToArray();
        var latestContributions = await context.OperationAttendanceContributionRevisions
            .AsNoTracking()
            .Where(item => assignmentIds.Contains(item.OperationAgentAssignmentId))
            .GroupBy(item => new { item.OperationAgentAssignmentId, item.Lane })
            .Select(group => group.OrderByDescending(item => item.RevisionNumber).First())
            .ToArrayAsync(cancellationToken);
        var contributionsByAssignment = latestContributions.ToDictionary(
            item => (item.OperationAgentAssignmentId, item.Lane));
        var latestDecisions = await context.OperationAttendanceValidations.AsNoTracking()
            .Where(item => assignmentIds.Contains(item.OperationAgentAssignmentId))
            .GroupBy(item => item.OperationAgentAssignmentId)
            .Select(group => group.OrderByDescending(item => item.ValidatedAt)
                .ThenByDescending(item => item.Id).First())
            .ToArrayAsync(cancellationToken);
        var decisionsByAssignment = latestDecisions.ToDictionary(
            item => item.OperationAgentAssignmentId);
        var accountIds = latestContributions.Select(item => item.AuthorAccountId)
            .Concat(latestDecisions.Select(item => item.ValidatedByAccountId))
            .Distinct().ToArray();
        var accountPublicIds = await context.Users.AsNoTracking()
            .Where(item => accountIds.Contains(item.Id))
            .Select(item => new { item.Id, item.PublicId })
            .ToDictionaryAsync(item => item.Id, item => item.PublicId, cancellationToken);
        var referencedRevisionIds = latestDecisions
            .SelectMany(item => new[] { item.OccContributionRevisionId,
                item.RampAgentContributionRevisionId }).Distinct().ToArray();
        var revisionNumbers = await context.OperationAttendanceContributionRevisions
            .AsNoTracking().Where(item => referencedRevisionIds.Contains(item.Id))
            .Select(item => new { item.Id, item.RevisionNumber })
            .ToDictionaryAsync(item => item.Id, item => item.RevisionNumber,
                cancellationToken);

        var result = new List<HumanResourcesAttendanceRow>(pageRows.Length);
        foreach (var row in pageRows)
        {
            contributionsByAssignment.TryGetValue((row.AssignmentId,
                nameof(AttendanceDraftLane.Occ)), out var occ);
            contributionsByAssignment.TryGetValue((row.AssignmentId,
                nameof(AttendanceDraftLane.RampAgent)), out var ramp);
            decisionsByAssignment.TryGetValue(row.AssignmentId, out var decision);
            result.Add(new HumanResourcesAttendanceRow(row.OperationId,
                row.AssignmentPublicId, stationId, row.OperationDate,
                row.OperationCode, $"{row.FirstName} {row.LastName}",
                occ is null ? null : ToContribution(occ,
                    accountPublicIds[occ.AuthorAccountId]),
                ramp is null ? null : ToContribution(ramp,
                    accountPublicIds[ramp.AuthorAccountId]),
                decision is null ? null : ToDecision(decision, row.AssignmentPublicId,
                    accountPublicIds[decision.ValidatedByAccountId],
                    revisionNumbers[decision.OccContributionRevisionId],
                    revisionNumbers[decision.RampAgentContributionRevisionId]),
                decision is not null && occ is not null && ramp is not null &&
                decision.OccContributionRevisionId == occ.Id &&
                decision.RampAgentContributionRevisionId == ramp.Id));
        }
        return new HumanResourcesAttendancePage(stationId, startDate, endDate, page, limit,
            rows.Length > limit, result);
    }

    public async Task<AttendanceValidationResult> ValidateAsync(
        AttendanceValidationCommand command,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        if (command.ActorAccountId == Guid.Empty || command.StationId == Guid.Empty ||
            command.AssignmentId == Guid.Empty || command.IdempotencyKey == Guid.Empty ||
            command.ExpectedOccRevision < 1 || command.ExpectedRampAgentRevision < 1 ||
            command.StartSource is not ("Occ" or "RampAgent") ||
            command.EndSource is not ("Occ" or "RampAgent"))
            return AttendanceValidationResult.Failed(AttendanceValidationFailure.Invalid);

        Guid? appendedId = null;
        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteInTransactionAsync(
                async token =>
                {
                    context.ChangeTracker.Clear();
                    var (result, createdId) = await ValidateInsideTransactionAsync(command, token);
                    appendedId = createdId;
                    if (createdId is null) context.ChangeTracker.Clear();
                    return result;
                },
                async token => appendedId is not Guid decisionId ||
                    await context.OperationAttendanceValidations.AsNoTracking()
                        .AnyAsync(item => item.PublicId == decisionId, token),
                IsolationLevel.Serializable, cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return AttendanceValidationResult.Failed(AttendanceValidationFailure.Conflict);
        }
        catch (DbUpdateException exception) when (IsConflict(exception.GetBaseException()))
        {
            context.ChangeTracker.Clear();
            return AttendanceValidationResult.Failed(AttendanceValidationFailure.Conflict);
        }
        catch (RetryLimitExceededException exception) when (IsConflict(exception.GetBaseException()))
        {
            context.ChangeTracker.Clear();
            return AttendanceValidationResult.Failed(AttendanceValidationFailure.Conflict);
        }
        catch (SqlException exception) when (IsConflict(exception))
        {
            context.ChangeTracker.Clear();
            return AttendanceValidationResult.Failed(AttendanceValidationFailure.Conflict);
        }
    }

    private async Task<(AttendanceValidationResult Result, Guid? CreatedId)>
        ValidateInsideTransactionAsync(AttendanceValidationCommand command,
            CancellationToken cancellationToken)
    {
        var actor = await ResolveHumanResourcesAsync(command.ActorAccountId,
            cancellationToken);
        if (actor is null)
            return (AttendanceValidationResult.Failed(AttendanceValidationFailure.Forbidden), null);
        if (!actor.StationScopes.Any(scope => scope.StationId == command.StationId))
            return (AttendanceValidationResult.Failed(AttendanceValidationFailure.NotFound), null);

        var assignment = await context.OperationAgentAssignments
            .FromSqlInterpolated($"""
                SELECT * FROM [ops].[operation_agent_assignments] WITH (UPDLOCK, HOLDLOCK)
                WHERE [public_id] = {command.AssignmentId}
                """).SingleOrDefaultAsync(cancellationToken);
        if (assignment is null)
            return (AttendanceValidationResult.Failed(AttendanceValidationFailure.NotFound), null);
        var location = await (
            from operation in context.GroundOperations.AsNoTracking()
            join turnaround in context.Turnarounds.AsNoTracking()
                on operation.TurnaroundId equals turnaround.Id
            join station in context.Stations.AsNoTracking()
                on turnaround.StationId equals station.Id
            join airline in context.Airlines.AsNoTracking()
                on turnaround.AirlineId equals airline.Id
            where operation.Id == assignment.GroundOperationId && station.IsActive
            select new { OperationId = operation.PublicId, StationId = station.PublicId,
                StationInternalId = station.Id, AirlineOrganizationId = airline.OrganizationId })
            .SingleOrDefaultAsync(cancellationToken);
        if (location is null || location.StationId != command.StationId)
            return (AttendanceValidationResult.Failed(AttendanceValidationFailure.NotFound), null);
        var actorInternalId = await context.Users.AsNoTracking()
            .Where(item => item.PublicId == command.ActorAccountId)
            .Select(item => item.Id).SingleAsync(cancellationToken);
        var hash = HashPayload(command);
        var existing = await context.OperationAttendanceValidations
            .FromSqlInterpolated($"""
                SELECT * FROM [ops].[operation_attendance_validations] WITH (UPDLOCK, HOLDLOCK)
                WHERE [validated_by_account_id] = {actorInternalId}
                  AND [idempotency_key] = {command.IdempotencyKey}
                """).SingleOrDefaultAsync(cancellationToken);
        if (existing is not null)
        {
            if (existing.OperationAgentAssignmentId != assignment.Id ||
                existing.PayloadSha256 != hash)
                return (AttendanceValidationResult.Failed(AttendanceValidationFailure.Conflict), null);
            return (AttendanceValidationResult.Success(
                await ToDecisionAsync(existing, command.AssignmentId, cancellationToken), true), null);
        }

        var occ = await LatestAsync(assignment.Id, AttendanceDraftLane.Occ,
            cancellationToken);
        var ramp = await LatestAsync(assignment.Id, AttendanceDraftLane.RampAgent,
            cancellationToken);
        if (occ is null || ramp is null)
            return (AttendanceValidationResult.Failed(AttendanceValidationFailure.Invalid), null);
        if (occ.RevisionNumber != command.ExpectedOccRevision ||
            ramp.RevisionNumber != command.ExpectedRampAgentRevision ||
            await context.OperationAttendanceValidations.AsNoTracking().AnyAsync(item =>
                item.OperationAgentAssignmentId == assignment.Id &&
                item.OccContributionRevisionId == occ.Id &&
                item.RampAgentContributionRevisionId == ramp.Id, cancellationToken))
            return (AttendanceValidationResult.Failed(AttendanceValidationFailure.Conflict), null);
        var selection = AttendanceValidationPolicy.Resolve(
            ToContribution(occ, Guid.Empty), ToContribution(ramp, Guid.Empty),
            command.StartSource, command.EndSource, command.Reason);
        if (selection.Failure is not null)
            return (AttendanceValidationResult.Failed(selection.Failure.Value), null);

        var now = Normalize(timeProvider.GetUtcNow());
        var decision = new OperationAttendanceValidation
        {
            PublicId = Guid.CreateVersion7(),
            OperationAgentAssignmentId = assignment.Id,
            OccContributionRevisionId = occ.Id,
            RampAgentContributionRevisionId = ramp.Id,
            StartSource = command.StartSource,
            EndSource = command.EndSource,
            StartAt = selection.StartAt!.Value,
            EndAt = selection.EndAt!.Value,
            Reason = selection.Reason,
            ValidatedByAccountId = actorInternalId,
            ValidatedAt = now,
            IdempotencyKey = command.IdempotencyKey,
            PayloadSha256 = hash,
            CreatedAt = now,
            UpdatedAt = now,
        };
        context.OperationAttendanceValidations.Add(decision);
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(),
            OccurredAt = now,
            ActorType = AuditActorType.Account,
            ActorAccountId = actorInternalId,
            ActorDisplay = actor.DisplayName,
            Action = "hr.attendance.validated",
            EntityType = nameof(OperationAttendanceValidation),
            EntityPublicId = decision.PublicId,
            OrganizationId = location.AirlineOrganizationId,
            StationId = location.StationInternalId,
            Source = AuditSource.Api,
            CorrelationId = command.IdempotencyKey,
            RequestId = command.RequestId,
            MetadataJson = JsonSerializer.Serialize(new
            {
                assignmentId = command.AssignmentId,
                occRevision = occ.RevisionNumber,
                rampAgentRevision = ramp.RevisionNumber,
            }),
        });
        await AddHintsAsync(location.StationInternalId, location.OperationId,
            assignment.RampAgentId, now, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
        return (AttendanceValidationResult.Success(ToDecision(decision,
            command.AssignmentId, command.ActorAccountId,
            occ.RevisionNumber, ramp.RevisionNumber)), decision.PublicId);
    }

    private async Task<Elevant.Application.Identity.ActorContext?> ResolveHumanResourcesAsync(
        Guid accountId, CancellationToken cancellationToken)
    {
        var actor = await new EfActorContextResolver(context, timeProvider)
            .ResolveAsync(accountId, cancellationToken);
        return actor is not null &&
            actor.Roles.Any(role => role.Code == "GESTION_HUMANA" &&
                role.Portal == PortalKind.BackOffice) &&
            actor.Memberships.Any(membership =>
                membership.Kind == MembershipKind.InternalStaff &&
                membership.OrganizationType == OrganizationType.AviamOperator)
            ? actor : null;
    }

    private async Task AddHintsAsync(long stationInternalId, Guid operationId,
        long rampAgentId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var recipients = await (
            from account in context.Users.AsNoTracking()
            join grant in context.AccountStationScopes.AsNoTracking()
                on account.Id equals grant.AccountId
            where account.Status == AccountLifecycleStatus.Active &&
                account.InvitationStatus == InvitationStatus.Accepted &&
                account.EmailConfirmed && grant.StationId == stationInternalId &&
                grant.GrantedAt <= now && grant.RevokedAt == null &&
                context.UserRoles.Any(link => link.UserId == account.Id &&
                    context.Roles.Any(role => role.Id == link.RoleId &&
                        role.Portal == PortalKind.BackOffice &&
                        (role.NormalizedName == "ADMIN_OCC" ||
                         role.NormalizedName == "GESTION_HUMANA")))
            select account.Id).Distinct().ToArrayAsync(cancellationToken);
        var agentRecipients = await (
            from agent in context.RampAgents.AsNoTracking()
            join account in context.Users.AsNoTracking()
                on agent.PersonId equals account.PersonId
            where agent.Id == rampAgentId && agent.IsActive &&
                account.Status == AccountLifecycleStatus.Active
            select account.Id).ToArrayAsync(cancellationToken);
        foreach (var recipient in recipients.Concat(agentRecipients).Distinct())
            AccountChangeOutboxWriter.Add(context, recipient, stationInternalId,
                "attendance_validation", operationId, now);
    }

    private async Task<OperationAttendanceContributionRevision?> LatestAsync(
        long assignmentId, AttendanceDraftLane lane, CancellationToken cancellationToken) =>
        await context.OperationAttendanceContributionRevisions.AsNoTracking()
            .Where(item => item.OperationAgentAssignmentId == assignmentId &&
                item.Lane == lane.ToString())
            .OrderByDescending(item => item.RevisionNumber)
            .FirstOrDefaultAsync(cancellationToken);

    private static AttendanceDraftContributionData ToContribution(
        OperationAttendanceContributionRevision row, Guid authorId) =>
        new(row.RevisionNumber, authorId, row.RecordedAt, row.ObservedStartAt,
            row.ObservedEndAt, row.IncidentNote);

    private async Task<AttendanceValidationDecisionData> ToDecisionAsync(
        OperationAttendanceValidation row, Guid assignmentId,
        CancellationToken cancellationToken)
    {
        var validatorId = await context.Users.AsNoTracking()
            .Where(item => item.Id == row.ValidatedByAccountId)
            .Select(item => item.PublicId).SingleAsync(cancellationToken);
        var occRevision = await context.OperationAttendanceContributionRevisions.AsNoTracking()
            .Where(item => item.Id == row.OccContributionRevisionId)
            .Select(item => item.RevisionNumber).SingleAsync(cancellationToken);
        var rampRevision = await context.OperationAttendanceContributionRevisions.AsNoTracking()
            .Where(item => item.Id == row.RampAgentContributionRevisionId)
            .Select(item => item.RevisionNumber).SingleAsync(cancellationToken);
        return ToDecision(row, assignmentId, validatorId, occRevision, rampRevision);
    }

    private static AttendanceValidationDecisionData ToDecision(
        OperationAttendanceValidation row, Guid assignmentId, Guid validatorId,
        int occRevision, int rampRevision) =>
        new(row.PublicId, assignmentId, occRevision, rampRevision,
            row.StartSource, row.EndSource,
            row.StartAt, row.EndAt, row.Reason, validatorId, row.ValidatedAt);

    private static string HashPayload(AttendanceValidationCommand command)
    {
        var json = JsonSerializer.Serialize(new
        {
            command.StationId,
            command.AssignmentId,
            command.ExpectedOccRevision,
            command.ExpectedRampAgentRevision,
            command.StartSource,
            command.EndSource,
            command.Reason,
        });
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json)))
            .ToLowerInvariant();
    }

    private static DateTimeOffset Normalize(DateTimeOffset value)
    {
        var utc = value.ToUniversalTime();
        return new DateTimeOffset(utc.Ticks - utc.Ticks % TimeSpan.TicksPerMillisecond,
            TimeSpan.Zero);
    }

    private static bool IsConflict(Exception exception) =>
        exception is SqlException sql && sql.Number is 1205 or 1222 or 2601 or 2627 or 3960;
}
