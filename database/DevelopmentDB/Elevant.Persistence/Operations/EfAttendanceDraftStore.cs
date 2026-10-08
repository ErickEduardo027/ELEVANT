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

/// <summary>Serializes assignment drafts and commits each revision with audit and hints.</summary>
internal sealed class EfAttendanceDraftStore(
    ElevantDbContext context,
    TimeProvider timeProvider) : IAttendanceDraftStore
{
    public async Task<AttendanceDraftReadResult> GetAsync(
        Guid actorAccountId, Guid operationId, Guid assignmentId,
        Guid? installationId, CancellationToken cancellationToken = default)
    {
        if (actorAccountId == Guid.Empty || operationId == Guid.Empty ||
            assignmentId == Guid.Empty)
            return AttendanceDraftReadResult.Failed(AttendanceDraftFailure.Invalid);

        var strategy = context.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            context.ChangeTracker.Clear();
            await using var transaction = await context.Database.BeginTransactionAsync(
                IsolationLevel.Serializable, cancellationToken);
            var (scope, failure) = await ResolveScopeAsync(actorAccountId, operationId,
                assignmentId, null, installationId, false, cancellationToken);
            if (scope is null)
                return AttendanceDraftReadResult.Failed(failure!.Value);

            var occ = await LatestAsync(scope.Assignment.Id, AttendanceDraftLane.Occ,
                cancellationToken);
            var rampAgent = await LatestAsync(scope.Assignment.Id,
                AttendanceDraftLane.RampAgent, cancellationToken);
            var snapshot = new AttendanceDraftSnapshotData(
                operationId, assignmentId, scope.StationPublicId,
                occ is null ? null : await ToContributionAsync(occ, cancellationToken),
                rampAgent is null ? null : await ToContributionAsync(rampAgent, cancellationToken));
            await transaction.CommitAsync(cancellationToken);
            return AttendanceDraftReadResult.Success(snapshot);
        });
    }

    public async Task<AttendanceDraftWriteResult> SaveAsync(
        AttendanceDraftWriteRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (request.ActorAccountId == Guid.Empty || request.OperationId == Guid.Empty ||
            request.AssignmentId == Guid.Empty || request.IdempotencyKey == Guid.Empty ||
            !AttendanceDraftPolicy.IsValidLane(request.Lane) ||
            !AttendanceDraftPolicy.IsValid(request.ExpectedRevision,
                request.ObservedStartAt, request.ObservedEndAt, request.IncidentNote) ||
            (request.Lane == AttendanceDraftLane.RampAgent &&
                request.InstallationId.GetValueOrDefault() == Guid.Empty) ||
            (request.Lane == AttendanceDraftLane.Occ && request.InstallationId is not null))
            return AttendanceDraftWriteResult.Failed(AttendanceDraftFailure.Invalid);

        AttendanceDraftWriteResult? attempt = null;
        Guid? appendedId = null;
        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteInTransactionAsync(
                async token =>
                {
                    context.ChangeTracker.Clear();
                    (attempt, appendedId) = await SaveInsideTransactionAsync(request, token);
                    if (appendedId is null) context.ChangeTracker.Clear();
                    return attempt;
                },
                async token => appendedId is not Guid revisionId ||
                    await context.OperationAttendanceContributionRevisions.AsNoTracking()
                        .AnyAsync(item => item.PublicId == revisionId, token),
                IsolationLevel.Serializable,
                cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return AttendanceDraftWriteResult.Failed(AttendanceDraftFailure.Conflict);
        }
        catch (DbUpdateException exception) when (IsConflict(exception.GetBaseException()))
        {
            context.ChangeTracker.Clear();
            return AttendanceDraftWriteResult.Failed(AttendanceDraftFailure.Conflict);
        }
        catch (RetryLimitExceededException exception) when (IsConflict(exception.GetBaseException()))
        {
            context.ChangeTracker.Clear();
            return AttendanceDraftWriteResult.Failed(AttendanceDraftFailure.Conflict);
        }
        catch (SqlException exception) when (IsConflict(exception))
        {
            context.ChangeTracker.Clear();
            return AttendanceDraftWriteResult.Failed(AttendanceDraftFailure.Conflict);
        }
    }

    private async Task<(AttendanceDraftWriteResult Result, Guid? AppendedId)>
        SaveInsideTransactionAsync(AttendanceDraftWriteRequest request,
            CancellationToken cancellationToken)
    {
        var (scope, failure) = await ResolveScopeAsync(request.ActorAccountId,
            request.OperationId, request.AssignmentId, request.Lane,
            request.InstallationId, true, cancellationToken);
        if (scope is null)
            return (AttendanceDraftWriteResult.Failed(failure!.Value), null);

        var hash = HashPayload(request);
        var existing = await context.OperationAttendanceContributionRevisions
            .FromSqlInterpolated($"""
                SELECT * FROM [ops].[operation_attendance_contribution_revisions]
                    WITH (UPDLOCK, HOLDLOCK)
                WHERE [author_account_id] = {scope.AccountInternalId}
                  AND [idempotency_key] = {request.IdempotencyKey}
                """)
            .SingleOrDefaultAsync(cancellationToken);
        if (existing is not null)
        {
            if (existing.OperationAgentAssignmentId != scope.Assignment.Id ||
                existing.Lane != request.Lane.ToString() ||
                existing.PayloadSha256 != hash)
                return (AttendanceDraftWriteResult.Failed(AttendanceDraftFailure.Conflict), null);
            return (AttendanceDraftWriteResult.Success(
                ToContribution(existing, request.ActorAccountId), true), null);
        }

        // The assignment row is held with UPDLOCK/HOLDLOCK for the entire
        // serializable transaction, so both lanes' revision decisions are serialized.
        var latest = await LatestAsync(scope.Assignment.Id, request.Lane,
            cancellationToken);
        var revision = latest?.RevisionNumber ?? 0;
        if (revision != request.ExpectedRevision)
            return (AttendanceDraftWriteResult.Failed(AttendanceDraftFailure.Conflict), null);

        var now = Normalize(timeProvider.GetUtcNow());
        var row = new OperationAttendanceContributionRevision
        {
            PublicId = Guid.CreateVersion7(),
            OperationAgentAssignmentId = scope.Assignment.Id,
            Lane = request.Lane.ToString(),
            RevisionNumber = revision + 1,
            AuthorAccountId = scope.AccountInternalId,
            InstallationId = request.InstallationId,
            IdempotencyKey = request.IdempotencyKey,
            PayloadSha256 = hash,
            ObservedStartAt = request.ObservedStartAt is DateTimeOffset start
                ? Normalize(start) : null,
            ObservedEndAt = request.ObservedEndAt is DateTimeOffset end
                ? Normalize(end) : null,
            IncidentNote = AttendanceDraftPolicy.NormalizeNote(request.IncidentNote),
            RecordedAt = now,
            CreatedAt = now,
            UpdatedAt = now,
        };
        context.OperationAttendanceContributionRevisions.Add(row);
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(),
            OccurredAt = now,
            ActorType = AuditActorType.Account,
            ActorAccountId = scope.AccountInternalId,
            ActorDisplay = scope.DisplayName,
            Action = "ops.attendance_draft.saved",
            EntityType = nameof(OperationAttendanceContributionRevision),
            EntityPublicId = row.PublicId,
            OrganizationId = scope.AirlineOrganizationInternalId,
            StationId = scope.StationInternalId,
            Source = request.Lane == AttendanceDraftLane.RampAgent
                ? AuditSource.MobileSync : AuditSource.Api,
            CorrelationId = request.IdempotencyKey,
            RequestId = request.RequestId,
            MetadataJson = JsonSerializer.Serialize(new
            {
                operationId = request.OperationId,
                assignmentId = request.AssignmentId,
                lane = row.Lane,
                revision = row.RevisionNumber,
            }),
        });
        await AddHintsAsync(scope, request.OperationId, now, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
        return (AttendanceDraftWriteResult.Success(
            ToContribution(row, request.ActorAccountId)), row.PublicId);
    }

    private async Task<(AccessScope? Scope, AttendanceDraftFailure? Failure)> ResolveScopeAsync(
        Guid actorAccountId, Guid operationId, Guid assignmentId,
        AttendanceDraftLane? writeLane, Guid? installationId,
        bool lockForWrite, CancellationToken cancellationToken)
    {
        var actor = await new EfActorContextResolver(context, timeProvider)
            .ResolveAsync(actorAccountId, cancellationToken);
        if (actor is null)
            return (null, AttendanceDraftFailure.Unauthorized);
        var internalMember = actor.Memberships.Any(membership =>
            membership.Kind == MembershipKind.InternalStaff &&
            membership.OrganizationType == OrganizationType.AviamOperator);
        if (!internalMember) return (null, AttendanceDraftFailure.Forbidden);

        var occ = actor.HasPermission(writeLane == AttendanceDraftLane.Occ
            ? "operations.attendance.record" : "operations.attendance.read");
        var hr = actor.HasPermission("human_resources.attendance.read");
        var ramp = RampOperationsAccess.IsAuthorized(actor);
        if (writeLane == AttendanceDraftLane.Occ && !occ ||
            writeLane == AttendanceDraftLane.RampAgent && !ramp ||
            writeLane is null && !occ && !hr && !ramp)
            return (null, AttendanceDraftFailure.Forbidden);

        OperationAgentAssignment? assignment;
        if (lockForWrite)
            assignment = await context.OperationAgentAssignments
                .FromSqlInterpolated($"""
                    SELECT * FROM [ops].[operation_agent_assignments] WITH (UPDLOCK, HOLDLOCK)
                    WHERE [public_id] = {assignmentId}
                    """).SingleOrDefaultAsync(cancellationToken);
        else
            assignment = await context.OperationAgentAssignments.AsNoTracking()
                .SingleOrDefaultAsync(item => item.PublicId == assignmentId,
                    cancellationToken);
        if (assignment is null || lockForWrite && assignment.ReleasedAt is not null)
            return (null, AttendanceDraftFailure.NotFound);

        var operation = await (from ground in context.GroundOperations.AsNoTracking()
            join turnaround in context.Turnarounds.AsNoTracking()
                on ground.TurnaroundId equals turnaround.Id
            join station in context.Stations.AsNoTracking()
                on turnaround.StationId equals station.Id
            join airline in context.Airlines.AsNoTracking()
                on turnaround.AirlineId equals airline.Id
            where ground.PublicId == operationId &&
                ground.Id == assignment.GroundOperationId && station.IsActive
            select new
            {
                OperationInternalId = ground.Id,
                StationInternalId = station.Id,
                StationPublicId = station.PublicId,
                AirlineOrganizationInternalId = airline.OrganizationId,
            }).SingleOrDefaultAsync(cancellationToken);
        if (operation is null || !actor.StationScopes.Any(scope =>
                scope.StationId == operation.StationPublicId))
            return (null, AttendanceDraftFailure.NotFound);

        if (writeLane == AttendanceDraftLane.RampAgent ||
            writeLane is null && !occ && !hr && ramp)
        {
            if (installationId is not Guid deviceId || deviceId == Guid.Empty ||
                assignment.ReleasedAt is not null)
                return (null, AttendanceDraftFailure.Forbidden);
            var authorization = new EfRampExecutionAuthorization(context, timeProvider);
            var rampActor = await authorization.ResolveActorAsync(actorAccountId,
                [operation.StationPublicId], deviceId, cancellationToken);
            if (!rampActor.IsSuccess ||
                rampActor.Access!.RampAgentInternalId != assignment.RampAgentId ||
                await authorization.ResolveOperationAsync(rampActor.Access, operationId,
                    lockForWrite, cancellationToken) is null)
                return (null, AttendanceDraftFailure.Forbidden);
        }

        var account = await context.Users.AsNoTracking()
            .Where(user => user.PublicId == actorAccountId)
            .Select(user => user.Id).SingleOrDefaultAsync(cancellationToken);
        if (account <= 0) return (null, AttendanceDraftFailure.Unauthorized);
        return (new AccessScope(assignment, account, actor.DisplayName,
            operation.StationInternalId, operation.StationPublicId,
            operation.AirlineOrganizationInternalId), null);
    }

    private async Task AddHintsAsync(AccessScope scope, Guid operationId,
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        var date = DateOnly.FromDateTime(now.UtcDateTime);
        var recipients = await context.Users.AsNoTracking()
            .Where(account => account.Status == AccountLifecycleStatus.Active &&
                account.InvitationStatus == InvitationStatus.Accepted &&
                account.EmailConfirmed &&
                context.UserRoles.Any(link => link.UserId == account.Id &&
                    context.Roles.Any(role => role.Id == link.RoleId &&
                        role.Portal == PortalKind.BackOffice &&
                        (role.NormalizedName == "ADMIN_OCC" ||
                         role.NormalizedName == "GESTION_HUMANA"))) &&
                context.AccountStationScopes.Any(grant =>
                    grant.AccountId == account.Id &&
                    grant.StationId == scope.StationInternalId &&
                    grant.GrantedAt <= now && grant.RevokedAt == null) &&
                context.OrganizationMemberships.Any(membership =>
                    membership.AccountId == account.Id &&
                    membership.Kind == MembershipKind.InternalStaff &&
                    membership.Status == MembershipStatus.Active &&
                    (membership.ValidFrom == null || membership.ValidFrom <= date) &&
                    (membership.ValidTo == null || membership.ValidTo >= date) &&
                    context.Organizations.Any(organization =>
                        organization.Id == membership.OrganizationId &&
                        organization.Type == OrganizationType.AviamOperator &&
                        organization.Status == OrganizationStatus.Active)))
            .Select(account => account.Id).ToArrayAsync(cancellationToken);
        var agentRecipients = await (from agent in context.RampAgents.AsNoTracking()
            join account in context.Users.AsNoTracking()
                on agent.PersonId equals account.PersonId
            where agent.Id == scope.Assignment.RampAgentId && agent.IsActive &&
                account.Status == AccountLifecycleStatus.Active
            select account.Id).ToArrayAsync(cancellationToken);
        foreach (var recipient in recipients.Concat(agentRecipients).Distinct())
            AccountChangeOutboxWriter.Add(context, recipient, scope.StationInternalId,
                "attendance_draft", operationId, now);
    }

    private async Task<OperationAttendanceContributionRevision?> LatestAsync(
        long assignmentId, AttendanceDraftLane lane, CancellationToken cancellationToken) =>
        await context.OperationAttendanceContributionRevisions.AsNoTracking()
            .Where(item => item.OperationAgentAssignmentId == assignmentId &&
                item.Lane == lane.ToString())
            .OrderByDescending(item => item.RevisionNumber)
            .FirstOrDefaultAsync(cancellationToken);

    private static AttendanceDraftContributionData ToContribution(
        OperationAttendanceContributionRevision row, Guid authorAccountId) => new(
        row.RevisionNumber, authorAccountId,
        row.RecordedAt, row.ObservedStartAt, row.ObservedEndAt, row.IncidentNote);

    private async Task<AttendanceDraftContributionData> ToContributionAsync(
        OperationAttendanceContributionRevision row, CancellationToken cancellationToken)
    {
        var authorAccountId = await context.Users.AsNoTracking()
            .Where(user => user.Id == row.AuthorAccountId)
            .Select(user => user.PublicId).SingleAsync(cancellationToken);
        return ToContribution(row, authorAccountId);
    }

    private static string HashPayload(AttendanceDraftWriteRequest request)
    {
        var json = JsonSerializer.Serialize(new
        {
            operationId = request.OperationId,
            assignmentId = request.AssignmentId,
            lane = request.Lane.ToString(),
            expectedRevision = request.ExpectedRevision,
            request.ObservedStartAt,
            request.ObservedEndAt,
            request.IncidentNote,
            installationId = request.InstallationId,
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

    private sealed record AccessScope(OperationAgentAssignment Assignment,
        long AccountInternalId, string DisplayName, long StationInternalId,
        Guid StationPublicId, long AirlineOrganizationInternalId);
}
