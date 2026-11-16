using Elevant.Persistence.Identity;
using System.Data;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Commercial;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Realtime;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

/// <summary>
/// OCC reports that a service cannot be performed and Contratos decides (four eyes): approval only
/// takes the service out of the public catalog, also when it is already hidden or retired (1-N11).
/// Republishing needs an active service and a reason. Every failure carries a code; the decision and
/// the reopening keep an idempotency receipt (<see cref="CommercialCommandReceipts"/>) when the client
/// sends a key.
/// </summary>
internal sealed class EfServiceClosureStore(ElevantDbContext context,
    CommercialPermissionGuard permissions, IActorContextResolver actors)
    : IServiceClosureStore
{
    private const string DecideAction = "commercial.closure.decide";
    private const string ReopenAction = "commercial.closure.reopen";

    public async Task<ServiceClosurePage?> ListAsync(Guid actorId, string? status,
        int page, int limit, CancellationToken cancellationToken = default)
    {
        if (!await CanAsync(actorId, "read", cancellationToken)) return null;
        if (page < 1 || limit is < 1 or > 100 ||
            page > int.MaxValue / limit ||
            status is not null && !Enum.TryParse<ServiceClosureStatus>(status, true, out _))
            throw new ArgumentOutOfRangeException(nameof(status));
        var query = context.ServiceClosureRequests.AsNoTracking();
        if (status is not null)
        {
            var parsed = Enum.Parse<ServiceClosureStatus>(status, true);
            query = query.Where(item => item.Status == parsed);
        }
        var rows = await query.OrderBy(item => item.Status == ServiceClosureStatus.Pending ? 0 : 1)
            .ThenByDescending(item => item.RequestedAt)
            .ThenByDescending(item => item.Id).Skip((page - 1) * limit)
            .Take(limit + 1).ToArrayAsync(cancellationToken);
        var mapped = new List<ServiceClosureData>(Math.Min(limit, rows.Length));
        foreach (var row in rows.Take(limit))
            mapped.Add(await MapAsync(row, cancellationToken));
        var pendingCount = await context.ServiceClosureRequests.AsNoTracking()
            .CountAsync(item => item.Status == ServiceClosureStatus.Pending,
                cancellationToken);
        var pendingServiceIds = await (from request in context.ServiceClosureRequests.AsNoTracking()
            join service in context.ServiceDefinitions.AsNoTracking() on
                request.ServiceDefinitionId equals service.Id
            where request.Status == ServiceClosureStatus.Pending
            select service.PublicId).ToArrayAsync(cancellationToken);
        return new ServiceClosurePage(mapped, rows.Length > limit, pendingCount,
            pendingServiceIds);
    }

    public async Task<ServiceClosureResult> RequestAsync(Guid actorId, Guid requestId,
        Guid serviceId, string reason, CancellationToken cancellationToken = default)
    {
        if (!await CanAsync(actorId, "request", cancellationToken))
            return ServiceClosureResult.Failed(ServiceClosureFailure.Forbidden);
        if (requestId == Guid.Empty || serviceId == Guid.Empty)
            return ServiceClosureResult.Failed(ServiceClosureFailure.Invalid, CommercialCatalogIssues.InvalidClosure);
        if (!ServiceClosurePolicy.TryNormalizeReason(reason, out var normalized))
            return ServiceClosureResult.Failed(ServiceClosureFailure.Invalid, "reason_required");
        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(
                    IsolationLevel.Serializable, cancellationToken);
                var actorKey = await ActorKeyAsync(actorId, cancellationToken);
                // The request id is the client's idempotency key: the same report replays its request.
                var prior = await context.ServiceClosureRequests.AsNoTracking()
                    .SingleOrDefaultAsync(item => item.PublicId == requestId, cancellationToken);
                if (prior is not null)
                    return prior.RequestedByAccountId == actorKey &&
                        prior.Reason == normalized &&
                        await context.ServiceDefinitions.AnyAsync(item =>
                            item.Id == prior.ServiceDefinitionId && item.PublicId == serviceId,
                            cancellationToken)
                        ? ServiceClosureResult.Success(await MapAsync(prior, cancellationToken))
                        : ServiceClosureResult.Failed(ServiceClosureFailure.Conflict, "idempotency_conflict");
                var service = await context.ServiceDefinitions.SingleOrDefaultAsync(
                    item => item.PublicId == serviceId, cancellationToken);
                if (service is null)
                    return ServiceClosureResult.Failed(ServiceClosureFailure.Invalid,
                        CommercialCatalogIssues.ServiceNotFound);
                if (ServiceClosurePolicy.RequestIssue(service.IsActive, service.IsPublic,
                        await PendingAsync(service.Id, cancellationToken)) is { } issue)
                    return ServiceClosureResult.Failed(ServiceClosureFailure.Conflict, issue);
                var now = DateTimeOffset.UtcNow;
                var request = new ServiceClosureRequest
                {
                    PublicId = requestId,
                    ServiceDefinitionId = service.Id,
                    ServiceNameSnapshot = service.Name,
                    RequestedByAccountId = actorKey,
                    Reason = normalized,
                    Status = ServiceClosureStatus.Pending,
                    RequestedAt = now,
                    CreatedAt = now,
                    UpdatedAt = now,
                };
                context.ServiceClosureRequests.Add(request);
                CommercialAuditWriter.Add(context, actorKey, "commercial.service_closure.requested",
                    "commercial.service_closure_requests", requestId, normalized);
                await NotifyAsync(requestId, serviceId, false, cancellationToken);
                await DepartmentNotificationWriter.NotifyAsync(context, Department.Contracts,
                    "contracts.service_closures.decide", "service_closure", requestId, service.Name, now,
                    cancellationToken, exceptAccountId: actorKey);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                await context.Entry(request).ReloadAsync(cancellationToken);
                return ServiceClosureResult.Success(await MapAsync(request, cancellationToken));
            });
        }
        catch (DbUpdateException exception) when (IsUniqueConflict(exception))
        {
            context.ChangeTracker.Clear();
            var prior = await context.ServiceClosureRequests.AsNoTracking()
                .SingleOrDefaultAsync(item => item.PublicId == requestId, cancellationToken);
            if (prior is not null && prior.Reason == normalized &&
                prior.RequestedByAccountId == await ActorKeyAsync(actorId, cancellationToken) &&
                await context.ServiceDefinitions.AnyAsync(item =>
                    item.Id == prior.ServiceDefinitionId && item.PublicId == serviceId,
                    cancellationToken))
                return ServiceClosureResult.Success(await MapAsync(prior, cancellationToken));
            // Another pending request for the service won the race, or the id was used for another one.
            return ServiceClosureResult.Failed(ServiceClosureFailure.Conflict,
                prior is null ? CommercialCatalogIssues.ClosurePending : "idempotency_conflict");
        }
    }

    public async Task<ServiceClosureResult> DecideAsync(Guid actorId, Guid requestId,
        bool approve, string? reason, string? expectedVersion, Guid? idempotencyKey,
        CancellationToken cancellationToken = default)
    {
        if (!await CanAsync(actorId, "decide", cancellationToken))
            return ServiceClosureResult.Failed(ServiceClosureFailure.Forbidden);
        if (idempotencyKey == Guid.Empty)
            return ServiceClosureResult.Failed(ServiceClosureFailure.Invalid, "idempotency_key_required");
        if (!ValidVersion(expectedVersion))
            return ServiceClosureResult.Failed(ServiceClosureFailure.Invalid, "expected_version_required");
        if (requestId == Guid.Empty)
            return ServiceClosureResult.Failed(ServiceClosureFailure.Invalid, CommercialCatalogIssues.InvalidClosure);
        if ((!approve && !ServiceClosurePolicy.TryNormalizeReason(reason, out _)) ||
            (approve && reason?.Trim().Length > 1000))
            return ServiceClosureResult.Failed(ServiceClosureFailure.Invalid, "reason_required");
        var decisionReason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();
        var actorKey = await ActorKeyAsync(actorId, cancellationToken);
        return await RunAsync(actorKey, idempotencyKey, DecideAction,
            new { requestId, approve, reason = decisionReason, expectedVersion }, async now =>
            {
                var request = await context.ServiceClosureRequests.SingleOrDefaultAsync(
                    item => item.PublicId == requestId, cancellationToken);
                if (request is null)
                    return Fail(ServiceClosureFailure.NotFound, "not_found");
                if (Convert.ToBase64String(request.RowVersion) != expectedVersion)
                    return Fail(ServiceClosureFailure.Conflict, "version_conflict");
                if (request.Status != ServiceClosureStatus.Pending)
                    return Fail(ServiceClosureFailure.Conflict, CommercialCatalogIssues.ClosureNotPending);
                var requesterId = await context.Users.AsNoTracking()
                    .Where(item => item.Id == request.RequestedByAccountId)
                    .Select(item => item.PublicId).SingleAsync(cancellationToken);
                if (!ServiceClosurePolicy.CanDecide(requesterId, actorId))
                    return Fail(ServiceClosureFailure.Forbidden, CommercialCatalogIssues.ClosureSelfDecision);
                var service = await context.ServiceDefinitions.SingleAsync(item =>
                    item.Id == request.ServiceDefinitionId, cancellationToken);
                request.Status = approve ? ServiceClosureStatus.Approved : ServiceClosureStatus.Denied;
                request.DecidedAt = now;
                request.DecidedByAccountId = actorKey;
                request.DecisionReason = decisionReason;
                request.UpdatedAt = now;
                // 1-N11: a service Contratos already hid or retired stays as it is; the approval is recorded.
                var unpublished = approve && service.IsPublic;
                if (unpublished)
                {
                    service.IsPublic = false;
                    service.UpdatedAt = now;
                }
                CommercialAuditWriter.Add(context, actorKey,
                    approve ? "commercial.service_closure.approved" :
                        "commercial.service_closure.denied",
                    "commercial.service_closure_requests", requestId, request.DecisionReason);
                await NotifyAsync(requestId, service.PublicId, unpublished, cancellationToken);
                return (request, null);
            }, cancellationToken);
    }

    public async Task<ServiceClosureResult> ReopenAsync(Guid actorId, Guid serviceId,
        string? reason, string? expectedServiceVersion, Guid? idempotencyKey,
        CancellationToken cancellationToken = default)
    {
        if (!await CanAsync(actorId, "reopen", cancellationToken))
            return ServiceClosureResult.Failed(ServiceClosureFailure.Forbidden);
        if (idempotencyKey == Guid.Empty)
            return ServiceClosureResult.Failed(ServiceClosureFailure.Invalid, "idempotency_key_required");
        if (!ValidVersion(expectedServiceVersion))
            return ServiceClosureResult.Failed(ServiceClosureFailure.Invalid, "expected_version_required");
        if (serviceId == Guid.Empty)
            return ServiceClosureResult.Failed(ServiceClosureFailure.Invalid, CommercialCatalogIssues.InvalidClosure);
        if (!ServiceClosurePolicy.TryNormalizeReason(reason, out var normalized))
            return ServiceClosureResult.Failed(ServiceClosureFailure.Invalid, "reason_required");
        var actorKey = await ActorKeyAsync(actorId, cancellationToken);
        return await RunAsync(actorKey, idempotencyKey, ReopenAction,
            new { serviceId, reason = normalized, expectedServiceVersion }, async now =>
            {
                var service = await context.ServiceDefinitions.SingleOrDefaultAsync(
                    item => item.PublicId == serviceId, cancellationToken);
                if (service is null)
                    return Fail(ServiceClosureFailure.NotFound, "not_found");
                if (Convert.ToBase64String(service.RowVersion) != expectedServiceVersion)
                    return Fail(ServiceClosureFailure.Conflict, "version_conflict");
                var closure = await context.ServiceClosureRequests
                    .Where(item => item.ServiceDefinitionId == service.Id &&
                        item.Status == ServiceClosureStatus.Approved &&
                        item.ReopenedAt == null)
                    .OrderByDescending(item => item.DecidedAt).ThenByDescending(item => item.Id)
                    .FirstOrDefaultAsync(cancellationToken);
                // 1-N11: a retired service is reactivated in the catalog before it is republished.
                if (ServiceClosurePolicy.ReopenIssue(service.IsActive, service.IsPublic,
                        await PendingAsync(service.Id, cancellationToken), closure is not null) is { } issue)
                    return Fail(ServiceClosureFailure.Conflict, issue);
                closure!.ReopenedAt = now;
                closure.ReopenedByAccountId = actorKey;
                closure.ReopenReason = normalized;
                closure.UpdatedAt = now;
                service.IsPublic = true;
                service.UpdatedAt = now;
                CommercialAuditWriter.Add(context, actorKey, "commercial.service_closure.reopened",
                    "commercial.service_closure_requests", closure.PublicId, normalized);
                await NotifyAsync(closure.PublicId, service.PublicId, true, cancellationToken);
                return (closure, null);
            }, cancellationToken);
    }

    private static (ServiceClosureRequest? Request, ServiceClosureResult? Failure) Fail(
        ServiceClosureFailure failure, string code) => (null, ServiceClosureResult.Failed(failure, code));

    /// <summary>
    /// Runs a decision or a reopening serializable. With an Idempotency-Key its receipt is resolved
    /// first (a legitimate retry sees the rowversions already changed) and replays the current request;
    /// the receipt is written in the command's transaction. A failed rule rolls back.
    /// </summary>
    private async Task<ServiceClosureResult> RunAsync(long actorKey, Guid? idempotencyKey, string action,
        object payload,
        Func<DateTimeOffset, Task<(ServiceClosureRequest? Request, ServiceClosureResult? Failure)>> command,
        CancellationToken cancellationToken)
    {
        var hash = CommercialCommandReceipts.Hash(payload);
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
                    var prior = await CommercialCommandReceipts.FindAsync(context, key, actorKey, action, hash,
                        cancellationToken);
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Replay)
                        return await CurrentAsync(prior.ResultId, cancellationToken);
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Conflict)
                        return ServiceClosureResult.Failed(ServiceClosureFailure.Conflict, "idempotency_conflict");
                }
                var now = DateTimeOffset.UtcNow;
                var (request, failure) = await command(now);
                if (request is null)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    context.ChangeTracker.Clear();
                    return failure!;
                }
                if (idempotencyKey is { } receipt)
                    CommercialCommandReceipts.Add(context, receipt, actorKey, action, hash, request.PublicId, now);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                // Answer the stored row (datetimeoffset(3)), the same shape a replay or a later read returns.
                await context.Entry(request).ReloadAsync(cancellationToken);
                return ServiceClosureResult.Success(await MapAsync(request, cancellationToken));
            });
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return ServiceClosureResult.Failed(ServiceClosureFailure.Conflict, "version_conflict");
        }
        catch (DbUpdateException exception) when (idempotencyKey is { } key &&
            CommercialCommandReceipts.IsDuplicateKey(exception))
        {
            // A concurrent command with the same key committed first.
            context.ChangeTracker.Clear();
            var concurrent = await CommercialCommandReceipts.FindAsync(context, key, actorKey, action, hash,
                cancellationToken);
            return concurrent.Outcome == CommercialCommandReceipts.Outcome.Replay
                ? await CurrentAsync(concurrent.ResultId, cancellationToken)
                : ServiceClosureResult.Failed(ServiceClosureFailure.Conflict, "idempotency_conflict");
        }
    }

    /// <summary>The current shape of the closure request a replayed command answered.</summary>
    private async Task<ServiceClosureResult> CurrentAsync(Guid requestId, CancellationToken cancellationToken)
    {
        var request = await context.ServiceClosureRequests.AsNoTracking()
            .SingleOrDefaultAsync(item => item.PublicId == requestId, cancellationToken);
        return request is null
            ? ServiceClosureResult.Failed(ServiceClosureFailure.NotFound, "not_found")
            : ServiceClosureResult.Success(await MapAsync(request, cancellationToken));
    }

    private Task<bool> PendingAsync(long serviceId, CancellationToken cancellationToken) =>
        context.ServiceClosureRequests.AnyAsync(item =>
            item.ServiceDefinitionId == serviceId &&
            item.Status == ServiceClosureStatus.Pending, cancellationToken);

    private async Task<bool> CanAsync(Guid actorId, string action,
        CancellationToken cancellationToken)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        return actor?.Memberships.Any(membership =>
            membership.Kind == MembershipKind.InternalStaff &&
            membership.OrganizationType == OrganizationType.AviamOperator) == true &&
            await permissions.HasAnyAsync(actorId, action switch
            {
                "request" => ["operations.service_closures.create"],
                "read" => ["contracts.service_closures.read", "operations.service_closures.read"],
                _ => ["contracts.service_closures." + action],
            }, cancellationToken);
    }

    private Task<long> ActorKeyAsync(Guid actorId, CancellationToken cancellationToken) =>
        context.Users.Where(item => item.PublicId == actorId)
            .Select(item => item.Id).SingleAsync(cancellationToken);

    private async Task<ServiceClosureData> MapAsync(ServiceClosureRequest request,
        CancellationToken cancellationToken)
    {
        var service = await context.ServiceDefinitions.AsNoTracking().SingleAsync(item =>
            item.Id == request.ServiceDefinitionId, cancellationToken);
        var accountIds = new[] { request.RequestedByAccountId,
            request.DecidedByAccountId ?? 0 }.Where(id => id > 0).Distinct().ToArray();
        var accounts = await context.Users.AsNoTracking().Where(item =>
            accountIds.Contains(item.Id)).ToDictionaryAsync(item => item.Id,
                item => item.PublicId, cancellationToken);
        return new ServiceClosureData(request.PublicId, service.PublicId,
            request.ServiceNameSnapshot, request.Reason, request.Status.ToString(),
            accounts[request.RequestedByAccountId], request.RequestedAt,
            request.DecisionReason,
            request.DecidedByAccountId is long decided ? accounts[decided] : null,
            request.DecidedAt, request.ReopenedAt, request.ReopenReason,
            service.IsPublic, service.IsActive, Convert.ToBase64String(service.RowVersion),
            Convert.ToBase64String(request.RowVersion));
    }

    private async Task NotifyAsync(Guid requestId, Guid serviceId, bool catalogChanged,
        CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        var recipients = await CommercialNotificationRecipients.WithAnyPermissionAsync(context,
            ["contracts.service_closures.read", "operations.service_closures.read"], cancellationToken);
        foreach (var recipient in recipients)
            AccountChangeOutboxWriter.Add(context, recipient, null,
                "service_closures", requestId, now);
        if (!catalogChanged) return;
        var catalogRecipients = await CommercialNotificationRecipients.WithPermissionAsync(context,
            "contracts.catalog.read", cancellationToken);
        foreach (var recipient in catalogRecipients)
            AccountChangeOutboxWriter.Add(context, recipient, null,
                "commercial_catalog", serviceId, now);
    }

    private static bool ValidVersion(string? value)
    {
        try { return Convert.FromBase64String(value ?? string.Empty).Length == 8; }
        catch (FormatException) { return false; }
    }

    private static bool IsUniqueConflict(DbUpdateException exception) =>
        exception.InnerException is SqlException { Number: 2601 or 2627 };
}
