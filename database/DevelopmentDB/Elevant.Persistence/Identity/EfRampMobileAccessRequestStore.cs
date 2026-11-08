using System.Data;
using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Realtime;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

internal sealed class EfRampMobileAccessRequestStore(ElevantDbContext context,
    IActorContextResolver actors) : IRampMobileAccessRequestStore
{
    public async Task<IReadOnlyList<RampMobileAccessRequestData>?> ListForHumanResourcesAsync(
        Guid actorId, CancellationToken cancellationToken = default)
    {
        if (!await HasRoleAsync(actorId, "GESTION_HUMANA", cancellationToken)) return null;
        return await ListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<RampMobileAccessRequestData>?> ListForGovernanceAsync(
        Guid actorId, CancellationToken cancellationToken = default)
    {
        if (!await HasRoleAsync(actorId, "SUPERADMIN", cancellationToken)) return null;
        return await ListAsync(cancellationToken);
    }

    public async Task<MobileAccessRequestResult> RequestAsync(Guid actorId, Guid profileId,
        Guid requestId, CancellationToken cancellationToken = default)
    {
        if (!await HasRoleAsync(actorId, "GESTION_HUMANA", cancellationToken))
            return MobileAccessRequestResult.Failed(MobileAccessRequestFailure.Forbidden);
        if (profileId == Guid.Empty || requestId == Guid.Empty)
            return MobileAccessRequestResult.Failed(MobileAccessRequestFailure.Invalid);
        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(
                    IsolationLevel.Serializable, cancellationToken);
                var profile = await context.RampAgents.SingleOrDefaultAsync(item =>
                    item.PublicId == profileId, cancellationToken);
                if (profile is null)
                    return MobileAccessRequestResult.Failed(MobileAccessRequestFailure.NotFound);
                var prior = await context.RampMobileAccessRequests.AsNoTracking()
                    .SingleOrDefaultAsync(item => item.PublicId == requestId, cancellationToken);
                if (prior is not null)
                    return prior.RampAgentId == profile.Id && prior.RequestedByAccountId ==
                        await ActorKeyAsync(actorId, cancellationToken)
                        ? MobileAccessRequestResult.Success(await MapAsync(prior, cancellationToken))
                        : MobileAccessRequestResult.Failed(MobileAccessRequestFailure.Conflict);
                if (!profile.IsActive || await context.Users.AnyAsync(item =>
                        item.PersonId == profile.PersonId, cancellationToken) ||
                    await context.RampMobileAccessRequests.AnyAsync(item =>
                        item.RampAgentId == profile.Id &&
                        item.Status == RampMobileAccessRequestStatus.Pending, cancellationToken) ||
                    !await context.Set<RampAgentStationScope>().AnyAsync(item =>
                        item.RampAgentId == profile.Id &&
                        item.ValidFrom <= DateOnly.FromDateTime(DateTime.UtcNow) &&
                        (item.ValidTo == null || item.ValidTo >= DateOnly.FromDateTime(DateTime.UtcNow)),
                        cancellationToken))
                    return MobileAccessRequestResult.Failed(MobileAccessRequestFailure.Conflict);
                var now = DateTimeOffset.UtcNow;
                var actorKey = await ActorKeyAsync(actorId, cancellationToken);
                var request = new RampMobileAccessRequest
                {
                    PublicId = requestId,
                    RampAgentId = profile.Id,
                    RequestedByAccountId = actorKey,
                    Status = RampMobileAccessRequestStatus.Pending,
                    RequestedAt = now,
                    CreatedAt = now,
                    UpdatedAt = now,
                };
                context.RampMobileAccessRequests.Add(request);
                AddAudit(actorKey, "hr.mobile_access.requested", requestId, null, now);
                await AddHintsAsync(request, now, cancellationToken);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                await context.Entry(request).ReloadAsync(cancellationToken);
                return MobileAccessRequestResult.Success(await MapAsync(request,
                    cancellationToken));
            });
        }
        catch (DbUpdateException exception) when (IsUniqueConflict(exception))
        {
            context.ChangeTracker.Clear();
            var prior = await context.RampMobileAccessRequests.AsNoTracking()
                .SingleOrDefaultAsync(item => item.PublicId == requestId, cancellationToken);
            if (prior is not null && prior.RequestedByAccountId ==
                    await ActorKeyAsync(actorId, cancellationToken) &&
                await context.RampAgents.AsNoTracking().AnyAsync(item =>
                    item.Id == prior.RampAgentId && item.PublicId == profileId,
                    cancellationToken))
                return MobileAccessRequestResult.Success(await MapAsync(prior, cancellationToken));
            return MobileAccessRequestResult.Failed(MobileAccessRequestFailure.Conflict);
        }
    }

    public async Task<MobileAccessRequestResult> RejectAsync(Guid actorId, Guid requestId,
        string reason, string expectedVersion, CancellationToken cancellationToken = default)
    {
        if (!await HasRoleAsync(actorId, "SUPERADMIN", cancellationToken))
            return MobileAccessRequestResult.Failed(MobileAccessRequestFailure.Forbidden);
        // 2-N39: every refusal names its rule, like the governance commands this legacy route lives with.
        if (requestId == Guid.Empty)
            return MobileAccessRequestResult.Failed(MobileAccessRequestFailure.Invalid);
        if (string.IsNullOrWhiteSpace(reason) || reason.Trim().Length > 500)
            return MobileAccessRequestResult.Failed(MobileAccessRequestFailure.Invalid, "reason_required");
        if (string.IsNullOrWhiteSpace(expectedVersion))
            return MobileAccessRequestResult.Failed(MobileAccessRequestFailure.Invalid, "expected_version_required");
        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(
                    IsolationLevel.Serializable, cancellationToken);
                var request = await context.RampMobileAccessRequests.SingleOrDefaultAsync(item =>
                    item.PublicId == requestId, cancellationToken);
                if (request is null)
                    return MobileAccessRequestResult.Failed(MobileAccessRequestFailure.NotFound, "not_found");
                if (request.Status == RampMobileAccessRequestStatus.Rejected &&
                    request.DecidedByAccountId == await ActorKeyAsync(actorId, cancellationToken) &&
                    request.DecisionReason == reason.Trim())
                    return MobileAccessRequestResult.Success(await MapAsync(request, cancellationToken));
                if (request.Status != RampMobileAccessRequestStatus.Pending)
                    return MobileAccessRequestResult.Failed(MobileAccessRequestFailure.Conflict,
                        "access_request_closed");
                if (Convert.ToBase64String(request.RowVersion) != expectedVersion)
                    return MobileAccessRequestResult.Failed(MobileAccessRequestFailure.Conflict, "version_conflict");
                var now = DateTimeOffset.UtcNow;
                var actorKey = await ActorKeyAsync(actorId, cancellationToken);
                request.Status = RampMobileAccessRequestStatus.Rejected;
                request.DecidedByAccountId = actorKey;
                request.DecidedAt = now;
                request.DecisionReason = reason.Trim();
                request.UpdatedAt = now;
                AddAudit(actorKey, "hr.mobile_access.rejected", requestId, reason.Trim(), now);
                await AddHintsAsync(request, now, cancellationToken);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                await context.Entry(request).ReloadAsync(cancellationToken);
                return MobileAccessRequestResult.Success(await MapAsync(request, cancellationToken));
            });
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return MobileAccessRequestResult.Failed(MobileAccessRequestFailure.Conflict, "version_conflict");
        }
    }

    private async Task<IReadOnlyList<RampMobileAccessRequestData>> ListAsync(
        CancellationToken cancellationToken)
    {
        var rows = await context.RampMobileAccessRequests.AsNoTracking()
            .OrderByDescending(item => item.RequestedAt)
            .ToArrayAsync(cancellationToken);
        var profileKeys = rows.Select(row => row.RampAgentId).Distinct().ToArray();
        var accountKeys = rows.Where(row => row.CreatedAccountId.HasValue)
            .Select(row => row.CreatedAccountId!.Value).Distinct().ToArray();
        var profiles = await context.RampAgents.AsNoTracking()
            .Where(item => profileKeys.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id, item => item.PublicId, cancellationToken);
        var accounts = await context.Users.AsNoTracking()
            .Where(item => accountKeys.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id, item => item.PublicId, cancellationToken);
        return rows.Select(item => new RampMobileAccessRequestData(item.PublicId,
            profiles[item.RampAgentId], item.Status.ToString(), item.RequestedAt,
            item.DecidedAt, item.DecisionReason,
            item.CreatedAccountId is long accountId ? accounts[accountId] : null,
            Convert.ToBase64String(item.RowVersion)))
            .ToArray();
    }

    private async Task<RampMobileAccessRequestData> MapAsync(RampMobileAccessRequest request,
        CancellationToken cancellationToken)
    {
        var profileId = await context.RampAgents.Where(item => item.Id == request.RampAgentId)
            .Select(item => item.PublicId).SingleAsync(cancellationToken);
        var accountId = request.CreatedAccountId is long key
            ? await context.Users.Where(item => item.Id == key).Select(item => item.PublicId)
                .SingleAsync(cancellationToken)
            : (Guid?)null;
        return new RampMobileAccessRequestData(request.PublicId, profileId,
            request.Status.ToString(), request.RequestedAt, request.DecidedAt,
            request.DecisionReason, accountId, Convert.ToBase64String(request.RowVersion));
    }

    private async Task<bool> HasRoleAsync(Guid actorId, string roleCode,
        CancellationToken cancellationToken)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        return actor?.Roles.Any(role => role.Portal == PortalKind.BackOffice &&
            role.Code == roleCode) == true &&
            actor.Memberships.Any(item => item.Kind == MembershipKind.InternalStaff &&
                item.OrganizationType == OrganizationType.AviamOperator);
    }

    private Task<long> ActorKeyAsync(Guid actorId, CancellationToken cancellationToken) =>
        context.Users.Where(item => item.PublicId == actorId)
            .Select(item => item.Id).SingleAsync(cancellationToken);

    private void AddAudit(long actorKey, string action, Guid requestId,
        string? reason, DateTimeOffset now) => context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(),
            OccurredAt = now,
            ActorType = AuditActorType.Account,
            ActorAccountId = actorKey,
            Action = action,
            EntityType = "hr.ramp_mobile_access_requests",
            EntityPublicId = requestId,
            Source = AuditSource.Api,
            CorrelationId = Guid.CreateVersion7(),
            Reason = reason,
        });

    private async Task AddHintsAsync(RampMobileAccessRequest request,
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        var recipients = await (from link in context.Set<IdentityUserRole<long>>()
                                join role in context.Roles on link.RoleId equals role.Id
                                join membership in context.OrganizationMemberships on link.UserId equals membership.AccountId
                                join organization in context.Organizations on membership.OrganizationId equals organization.Id
                                join account in context.Users on link.UserId equals account.Id
                                where role.IsActive && (role.NormalizedName == "SUPERADMIN" ||
                                    role.NormalizedName == "GESTION_HUMANA") &&
                                    membership.Status == MembershipStatus.Active &&
                                    membership.Kind == MembershipKind.InternalStaff &&
                                    organization.Type == OrganizationType.AviamOperator &&
                                    account.Status == AccountLifecycleStatus.Active
                                select link.UserId).Distinct().ToArrayAsync(cancellationToken);
        foreach (var recipient in recipients.Append(request.RequestedByAccountId).Distinct())
            AccountChangeOutboxWriter.Add(context, recipient, null,
                "ramp_mobile_access_requests", request.PublicId, now);
    }

    private static bool IsUniqueConflict(DbUpdateException exception) =>
        exception.InnerException is SqlException sql && sql.Number is 2601 or 2627;
}
