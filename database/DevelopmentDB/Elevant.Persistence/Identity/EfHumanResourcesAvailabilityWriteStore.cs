using System.Data;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Common;
using Elevant.Application.Identity;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Audit;
using Elevant.Persistence.Commercial;
using Elevant.Persistence.Operations;
using Elevant.Persistence.Realtime;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

internal sealed class EfHumanResourcesAvailabilityWriteStore(
    ElevantDbContext context, IActorContextResolver actors, TimeProvider clock)
    : IHumanResourcesAvailabilityWriteStore
{
    private const string ResolveAction = "hr.availability.resolve";
    private const string AmendAction = "hr.availability.amend";

    public async Task<HumanResourcesAvailabilityWriteResult> RecordAsync(
        Guid actorId, Guid requestId, RecordHumanResourcesAvailabilityInput input,
        CancellationToken cancellationToken = default)
    {
        var actorKey = await AuthorizedActorKeyAsync(actorId, "human_resources.availability.create", cancellationToken);
        if (actorKey is null) return Fail(HumanResourcesAvailabilityWriteFailure.Forbidden);
        if (requestId == Guid.Empty || input is null ||
            input.RampProfileId == Guid.Empty || input.StartsOn == default ||
            input.EndsOn < input.StartsOn ||
            input.EndsOn.DayNumber - input.StartsOn.DayNumber > 30 ||
            string.IsNullOrWhiteSpace(input.Reason) || input.Reason.Trim().Length > 1000 ||
            !TryType(input.Type, out var type))
            return Fail(HumanResourcesAvailabilityWriteFailure.Invalid, "invalid_availability_request");

        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(
                    IsolationLevel.Serializable, cancellationToken);
                var existing = await context.AvailabilityRequests.AsNoTracking()
                    .SingleOrDefaultAsync(request => request.PublicId == requestId,
                        cancellationToken);
                if (existing is not null)
                    return await ReplayRecordAsync(existing, actorKey.Value, input,
                        type, cancellationToken);

                var agentKey = await context.RampAgents.AsNoTracking()
                    .Where(agent => agent.PublicId == input.RampProfileId && agent.IsActive)
                    .Select(agent => (long?)agent.Id).SingleOrDefaultAsync(cancellationToken);
                if (agentKey is null)
                    return Fail(HumanResourcesAvailabilityWriteFailure.Conflict, "agent_unavailable");
                if (await context.AvailabilityRequests.AsNoTracking()
                    .AnyAsync(request => request.RampAgentId == agentKey &&
                        request.Type == type &&
                        (request.Status == AvailabilityRequestStatus.Pending ||
                         request.Status == AvailabilityRequestStatus.Approved) &&
                        request.StartsOn <= input.EndsOn && request.EndsOn >= input.StartsOn,
                        cancellationToken))
                    return Fail(HumanResourcesAvailabilityWriteFailure.Conflict, "availability_overlap");

                var now = clock.GetUtcNow();
                context.AvailabilityRequests.Add(new AvailabilityRequest
                {
                    PublicId = requestId,
                    CreatedAt = now,
                    UpdatedAt = now,
                    RampAgentId = agentKey.Value,
                    StartsOn = input.StartsOn,
                    EndsOn = input.EndsOn,
                    Type = type,
                    Status = AvailabilityRequestStatus.Pending,
                    Reason = input.Reason.Trim(),
                    RequestedAt = now,
                });
                AddAudit(actorKey.Value, requestId, "hr.availability.recorded", now);
                await AddHumanResourcesHintsAsync(requestId, now, cancellationToken);
                await DepartmentNotificationWriter.NotifyAsync(context, Department.HumanResources,
                    "human_resources.availability.decide", "availability_request", requestId, null, now,
                    cancellationToken, exceptAccountId: actorKey.Value);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return HumanResourcesAvailabilityWriteResult.Success(requestId, "Pending");
            });
        }
        catch (DbUpdateException exception) when (
            exception.InnerException is SqlException { Number: 2601 or 2627 })
        {
            context.ChangeTracker.Clear();
            var existing = await context.AvailabilityRequests.AsNoTracking()
                .SingleOrDefaultAsync(request => request.PublicId == requestId,
                    cancellationToken);
            return existing is null
                ? Fail(HumanResourcesAvailabilityWriteFailure.Conflict, "availability_overlap")
                : await ReplayRecordAsync(existing, actorKey.Value, input, type,
                    cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Fail(HumanResourcesAvailabilityWriteFailure.Conflict, "version_conflict");
        }
    }

    public async Task<HumanResourcesAvailabilityWriteResult> ResolveAsync(
        Guid actorId, Guid requestId, ResolveHumanResourcesAvailabilityInput input, Guid? idempotencyKey,
        CancellationToken cancellationToken = default)
    {
        var actorKey = await AuthorizedActorKeyAsync(actorId, "human_resources.availability.decide", cancellationToken);
        if (actorKey is null) return Fail(HumanResourcesAvailabilityWriteFailure.Forbidden);
        // Expand phase: the key and the expected version are optional for older clients; a key needs the version.
        if (idempotencyKey == Guid.Empty)
            return Fail(HumanResourcesAvailabilityWriteFailure.Invalid, "idempotency_key_required");
        var expected = string.IsNullOrWhiteSpace(input?.ExpectedVersion) ? null : input.ExpectedVersion.Trim();
        if (idempotencyKey is not null && expected is null)
            return Fail(HumanResourcesAvailabilityWriteFailure.Invalid, "expected_version_required");
        var targetStatus = input?.Decision switch
        {
            "Approve" => AvailabilityRequestStatus.Approved,
            "Reject" => AvailabilityRequestStatus.Rejected,
            "Cancel" => AvailabilityRequestStatus.Cancelled,
            _ => (AvailabilityRequestStatus?)null,
        };
        if (requestId == Guid.Empty || targetStatus is null || input!.Note?.Trim().Length > 1000)
            return Fail(HumanResourcesAvailabilityWriteFailure.Invalid, "invalid_availability_request");
        var note = Normalize(input.Note);
        var hash = CommercialCommandReceipts.Hash(new { requestId, decision = input.Decision, note, version = expected });

        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(
                    IsolationLevel.Serializable, cancellationToken);
                if (idempotencyKey is { } key)
                {
                    var prior = await CommercialCommandReceipts.FindAsync(context, key, actorKey.Value, ResolveAction,
                        hash, cancellationToken);
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Conflict)
                        return Fail(HumanResourcesAvailabilityWriteFailure.Conflict, "idempotency_conflict");
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Replay)
                        return HumanResourcesAvailabilityWriteResult.Success(requestId, targetStatus.Value.ToString());
                }
                var request = await context.AvailabilityRequests
                    .SingleOrDefaultAsync(item => item.PublicId == requestId,
                        cancellationToken);
                if (request is null)
                    return Fail(HumanResourcesAvailabilityWriteFailure.NotFound, "not_found");
                if (expected is not null && GovernanceSupport.Version(request.RowVersion) != expected)
                    return Fail(HumanResourcesAvailabilityWriteFailure.Conflict, "version_conflict");
                if (request.Status != AvailabilityRequestStatus.Pending)
                    return idempotencyKey is null
                        ? await ReplayResolutionAsync(request, actorKey.Value, targetStatus.Value, note, cancellationToken)
                        : Fail(HumanResourcesAvailabilityWriteFailure.Conflict, "availability_request_closed");

                var now = clock.GetUtcNow();
                // 2-N08: an approved day off or restriction takes the agent's work of those days through the
                // release path (coverages as the agent or the mentor, unstarted operations and shifts).
                if (targetStatus == AvailabilityRequestStatus.Approved && IsAbsence(request.Type) &&
                    (await RampAgentRelease.ReleaseAbsenceAsync(context, request.RampAgentId, request.StartsOn,
                        request.EndsOn, actorKey.Value, now, cancellationToken)).Blocked)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    context.ChangeTracker.Clear();
                    return Fail(HumanResourcesAvailabilityWriteFailure.Conflict, RampAgentRelease.OperationInProgressCode);
                }

                request.Status = targetStatus.Value;
                request.ResolvedAt = now;
                request.ResolvedByAccountId = actorKey.Value;
                request.ResolutionNote = note;
                request.UpdatedAt = now;
                AddAudit(actorKey.Value, requestId, ResolutionAction(targetStatus.Value), now);
                await AddHumanResourcesHintsAsync(requestId, now, cancellationToken);
                if (targetStatus == AvailabilityRequestStatus.Approved && IsAbsence(request.Type))
                    await OccPlanningChangeWriter.AddForAgentAsync(context,
                        request.RampAgentId, request.StartsOn, request.EndsOn,
                        now, cancellationToken);
                if (idempotencyKey is { } receipt)
                    CommercialCommandReceipts.Add(context, receipt, actorKey.Value, ResolveAction, hash, requestId, now);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return HumanResourcesAvailabilityWriteResult.Success(
                    requestId, targetStatus.Value.ToString());
            });
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return Fail(HumanResourcesAvailabilityWriteFailure.Conflict, "version_conflict");
        }
        catch (DbUpdateException exception) when (idempotencyKey is { } key &&
            CommercialCommandReceipts.IsDuplicateKey(exception))
        {
            context.ChangeTracker.Clear();
            var concurrent = await CommercialCommandReceipts.FindAsync(context, key, actorKey.Value, ResolveAction, hash,
                cancellationToken);
            return concurrent.Outcome == CommercialCommandReceipts.Outcome.Replay
                ? HumanResourcesAvailabilityWriteResult.Success(requestId, targetStatus.Value.ToString())
                : Fail(HumanResourcesAvailabilityWriteFailure.Conflict, "idempotency_conflict");
        }
    }

    public async Task<HumanResourcesAvailabilityAmendmentResult> AmendAsync(Guid actorId, Guid requestId,
        AmendHumanResourcesAvailabilityInput input, Guid idempotencyKey, CancellationToken cancellationToken = default)
    {
        var actorKey = await AuthorizedActorKeyAsync(actorId, "human_resources.availability.decide", cancellationToken);
        if (actorKey is null)
            return HumanResourcesAvailabilityAmendmentResult.Failed(HumanResourcesAvailabilityWriteFailure.Forbidden,
                "forbidden");
        if (idempotencyKey == Guid.Empty) return Invalid("idempotency_key_required");
        if (string.IsNullOrWhiteSpace(input?.ExpectedVersion)) return Invalid("expected_version_required");
        var action = input.Action switch
        {
            "Cancel" => AbsenceAmendmentAction.Cancel,
            "Shorten" => AbsenceAmendmentAction.Shorten,
            _ => (AbsenceAmendmentAction?)null,
        };
        if (requestId == Guid.Empty || action is null ||
            (action == AbsenceAmendmentAction.Cancel) != (input.EndsOn is null))
            return Invalid("invalid_absence_amendment");
        if (input.Reason?.Trim().Length is not (>= 5 and <= 1000)) return Invalid("reason_required");
        var reason = input.Reason.Trim();
        var expected = input.ExpectedVersion.Trim();
        var hash = CommercialCommandReceipts.Hash(new { requestId, action = input.Action, input.EndsOn, reason, expected });

        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(
                    IsolationLevel.Serializable, cancellationToken);
                var prior = await CommercialCommandReceipts.FindAsync(context, idempotencyKey, actorKey.Value, AmendAction,
                    hash, cancellationToken);
                if (prior.Outcome == CommercialCommandReceipts.Outcome.Conflict)
                    return HumanResourcesAvailabilityAmendmentResult.Failed(HumanResourcesAvailabilityWriteFailure.Conflict,
                        "idempotency_conflict");
                if (prior.Outcome == CommercialCommandReceipts.Outcome.Replay)
                    return await AmendedAsync(requestId, cancellationToken);
                var request = await context.AvailabilityRequests.SingleOrDefaultAsync(item => item.PublicId == requestId,
                    cancellationToken);
                if (request is null)
                    return HumanResourcesAvailabilityAmendmentResult.Failed(HumanResourcesAvailabilityWriteFailure.NotFound,
                        "not_found");
                if (GovernanceSupport.Version(request.RowVersion) != expected)
                    return HumanResourcesAvailabilityAmendmentResult.Failed(HumanResourcesAvailabilityWriteFailure.Conflict,
                        "version_conflict");
                if (request.Status != AvailabilityRequestStatus.Approved)
                    return HumanResourcesAvailabilityAmendmentResult.Failed(HumanResourcesAvailabilityWriteFailure.Conflict,
                        "absence_not_approved");
                var now = clock.GetUtcNow();
                if (AbsenceAmendmentRules.Check(action.Value, request.StartsOn, request.EndsOn, input.EndsOn,
                        BusinessCalendar.Today(now)) is { } broken)
                    return HumanResourcesAvailabilityAmendmentResult.Failed(broken == "absence_end_invalid"
                        ? HumanResourcesAvailabilityWriteFailure.Invalid : HumanResourcesAvailabilityWriteFailure.Conflict,
                        broken);

                // Nothing the approval released comes back: the agent is free again from the freed days on.
                var freedFrom = action == AbsenceAmendmentAction.Cancel ? request.StartsOn : input.EndsOn!.Value.AddDays(1);
                var freedTo = request.EndsOn;
                if (action == AbsenceAmendmentAction.Cancel)
                {
                    request.Status = AvailabilityRequestStatus.Cancelled;
                    AddAudit(actorKey.Value, requestId, "hr.availability.approval_cancelled", now, reason,
                        new AuditFieldChangeData("availability.status", nameof(AvailabilityRequestStatus.Approved),
                            nameof(AvailabilityRequestStatus.Cancelled)));
                }
                else
                {
                    AddAudit(actorKey.Value, requestId, "hr.availability.shortened", now, reason,
                        new AuditFieldChangeData("availability.ends_on", Day(request.EndsOn), Day(input.EndsOn!.Value)));
                    request.EndsOn = input.EndsOn!.Value;
                }
                request.UpdatedAt = now;
                await AddHumanResourcesHintsAsync(requestId, now, cancellationToken);
                if (IsAbsence(request.Type))
                    await OccPlanningChangeWriter.AddForAgentAsync(context, request.RampAgentId, freedFrom, freedTo, now,
                        cancellationToken);
                CommercialCommandReceipts.Add(context, idempotencyKey, actorKey.Value, AmendAction, hash, requestId, now);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return HumanResourcesAvailabilityAmendmentResult.Success(new HumanResourcesAvailabilityAmended(requestId,
                    request.Status.ToString(), request.EndsOn, GovernanceSupport.Version(request.RowVersion)));
            });
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return HumanResourcesAvailabilityAmendmentResult.Failed(HumanResourcesAvailabilityWriteFailure.Conflict,
                "version_conflict");
        }
        catch (DbUpdateException exception) when (CommercialCommandReceipts.IsDuplicateKey(exception))
        {
            context.ChangeTracker.Clear();
            var concurrent = await CommercialCommandReceipts.FindAsync(context, idempotencyKey, actorKey.Value, AmendAction,
                hash, cancellationToken);
            return concurrent.Outcome == CommercialCommandReceipts.Outcome.Replay
                ? await AmendedAsync(requestId, cancellationToken)
                : HumanResourcesAvailabilityAmendmentResult.Failed(HumanResourcesAvailabilityWriteFailure.Conflict,
                    "idempotency_conflict");
        }

        static HumanResourcesAvailabilityAmendmentResult Invalid(string code) =>
            HumanResourcesAvailabilityAmendmentResult.Failed(HumanResourcesAvailabilityWriteFailure.Invalid, code);
    }

    /// <summary>The amended request as it stands, for a replay.</summary>
    private async Task<HumanResourcesAvailabilityAmendmentResult> AmendedAsync(Guid requestId,
        CancellationToken cancellationToken)
    {
        var request = await context.AvailabilityRequests.AsNoTracking().SingleOrDefaultAsync(item =>
            item.PublicId == requestId, cancellationToken);
        return request is null
            ? HumanResourcesAvailabilityAmendmentResult.Failed(HumanResourcesAvailabilityWriteFailure.NotFound, "not_found")
            : HumanResourcesAvailabilityAmendmentResult.Success(new HumanResourcesAvailabilityAmended(request.PublicId,
                request.Status.ToString(), request.EndsOn, GovernanceSupport.Version(request.RowVersion)));
    }

    private static bool IsAbsence(AvailabilityRequestType type) =>
        type is AvailabilityRequestType.DayOff or AvailabilityRequestType.Restriction;

    private static string Day(DateOnly day) => day.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);

    private async Task<long?> AuthorizedActorKeyAsync(Guid actorId, string permission,
        CancellationToken cancellationToken)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor?.HasPermission(permission) != true ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff)) return null;
        return await context.Users.AsNoTracking().Where(user => user.PublicId == actorId)
            .Select(user => (long?)user.Id).SingleOrDefaultAsync(cancellationToken);
    }

    private async Task<HumanResourcesAvailabilityWriteResult> ReplayRecordAsync(
        AvailabilityRequest existing, long actorKey,
        RecordHumanResourcesAvailabilityInput input, AvailabilityRequestType type,
        CancellationToken cancellationToken)
    {
        var matches = existing.StartsOn == input.StartsOn &&
            existing.EndsOn == input.EndsOn && existing.Type == type &&
            existing.Reason == input.Reason.Trim() &&
            await context.RampAgents.AsNoTracking().AnyAsync(agent =>
                agent.Id == existing.RampAgentId &&
                agent.PublicId == input.RampProfileId, cancellationToken) &&
            await context.AuditEntries.AsNoTracking().AnyAsync(entry =>
                entry.Action == "hr.availability.recorded" &&
                entry.EntityPublicId == existing.PublicId &&
                entry.ActorAccountId == actorKey &&
                entry.CorrelationId == existing.PublicId, cancellationToken);
        return matches
            ? HumanResourcesAvailabilityWriteResult.Success(existing.PublicId,
                existing.Status.ToString())
            : Fail(HumanResourcesAvailabilityWriteFailure.Conflict, "idempotency_conflict");
    }

    private async Task<HumanResourcesAvailabilityWriteResult> ReplayResolutionAsync(
        AvailabilityRequest existing, long actorKey,
        AvailabilityRequestStatus status, string? note,
        CancellationToken cancellationToken)
    {
        var action = ResolutionAction(status);
        var matches = existing.Status == status &&
            existing.ResolvedByAccountId == actorKey &&
            existing.ResolutionNote == note &&
            await context.AuditEntries.AsNoTracking().AnyAsync(entry =>
                entry.Action == action && entry.EntityPublicId == existing.PublicId &&
                entry.ActorAccountId == actorKey &&
                entry.CorrelationId == existing.PublicId, cancellationToken);
        return matches
            ? HumanResourcesAvailabilityWriteResult.Success(existing.PublicId,
                status.ToString())
            : Fail(HumanResourcesAvailabilityWriteFailure.Conflict, "availability_request_closed");
    }

    private static string ResolutionAction(AvailabilityRequestStatus status) => status switch
    {
        AvailabilityRequestStatus.Approved => "hr.availability.approved",
        AvailabilityRequestStatus.Cancelled => "hr.availability.cancelled",
        _ => "hr.availability.rejected",
    };

    private void AddAudit(long actorKey, Guid id, string action, DateTimeOffset now, string? reason = null,
        params AuditFieldChangeData[] changes) =>
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(),
            OccurredAt = now,
            ActorType = AuditActorType.Account,
            ActorAccountId = actorKey,
            Source = AuditSource.Api,
            CorrelationId = id,
            Action = action,
            EntityType = "hr.availability_requests",
            EntityPublicId = id,
            Reason = reason,
            MetadataJson = SafeAuditChanges.Serialize(changes),
        });

    private async Task AddHumanResourcesHintsAsync(Guid id, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var recipients = await (from link in context.Set<IdentityUserRole<long>>()
            join role in context.Roles on link.RoleId equals role.Id
            where role.NormalizedName == "SUPERADMIN" ||
                  role.NormalizedName == "GESTION_HUMANA"
            select link.UserId).Distinct().ToArrayAsync(cancellationToken);
        foreach (var recipient in recipients)
            AccountChangeOutboxWriter.Add(context, recipient, null,
                "hr_absences", id, now);
    }

    private static bool TryType(string? text, out AvailabilityRequestType type)
    {
        type = text switch
        {
            "DayOff" => AvailabilityRequestType.DayOff,
            "ShiftChange" => AvailabilityRequestType.ShiftChange,
            "Restriction" => AvailabilityRequestType.Restriction,
            _ => default,
        };
        return text is "DayOff" or "ShiftChange" or "Restriction";
    }

    private static string? Normalize(string? note) =>
        string.IsNullOrWhiteSpace(note) ? null : note.Trim();

    private static HumanResourcesAvailabilityWriteResult Fail(
        HumanResourcesAvailabilityWriteFailure failure, string? code = null) =>
        HumanResourcesAvailabilityWriteResult.Failed(failure, code);
}
