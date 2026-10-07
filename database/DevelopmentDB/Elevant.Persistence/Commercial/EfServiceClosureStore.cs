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

internal sealed class EfServiceClosureStore(ElevantDbContext context,
    CommercialPermissionGuard permissions, IActorContextResolver actors)
    : IServiceClosureStore
{
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
        if (requestId == Guid.Empty || serviceId == Guid.Empty ||
            !ServiceClosurePolicy.TryNormalizeReason(reason, out var normalized))
            return ServiceClosureResult.Failed(ServiceClosureFailure.Invalid);
        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(
                    IsolationLevel.Serializable, cancellationToken);
                var actorKey = await ActorKeyAsync(actorId, cancellationToken);
                var prior = await context.ServiceClosureRequests.AsNoTracking()
                    .SingleOrDefaultAsync(item => item.PublicId == requestId, cancellationToken);
                if (prior is not null)
                    return prior.RequestedByAccountId == actorKey &&
                        prior.Reason == normalized &&
                        await context.ServiceDefinitions.AnyAsync(item =>
                            item.Id == prior.ServiceDefinitionId && item.PublicId == serviceId,
                            cancellationToken)
                        ? ServiceClosureResult.Success(await MapAsync(prior, cancellationToken))
                        : ServiceClosureResult.Failed(ServiceClosureFailure.Conflict);
                var service = await context.ServiceDefinitions.SingleOrDefaultAsync(
                    item => item.PublicId == serviceId, cancellationToken);
                if (service is null)
                    return ServiceClosureResult.Failed(ServiceClosureFailure.NotFound);
                if (!service.IsActive || !service.IsPublic ||
                    await context.ServiceClosureRequests.AnyAsync(item =>
                        item.ServiceDefinitionId == service.Id &&
                        item.Status == ServiceClosureStatus.Pending, cancellationToken))
                    return ServiceClosureResult.Failed(ServiceClosureFailure.Conflict);
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
            return ServiceClosureResult.Failed(ServiceClosureFailure.Conflict);
        }
    }

    public async Task<ServiceClosureResult> DecideAsync(Guid actorId, Guid requestId,
        bool approve, string? reason, string expectedVersion,
        CancellationToken cancellationToken = default)
    {
        if (!await CanAsync(actorId, "decide", cancellationToken))
            return ServiceClosureResult.Failed(ServiceClosureFailure.Forbidden);
        if (requestId == Guid.Empty || !ValidVersion(expectedVersion) ||
            (!approve && !ServiceClosurePolicy.TryNormalizeReason(reason, out _)) ||
            (approve && reason?.Trim().Length > 1000))
            return ServiceClosureResult.Failed(ServiceClosureFailure.Invalid);
        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(
                    IsolationLevel.Serializable, cancellationToken);
                var request = await context.ServiceClosureRequests.SingleOrDefaultAsync(
                    item => item.PublicId == requestId, cancellationToken);
                if (request is null)
                    return ServiceClosureResult.Failed(ServiceClosureFailure.NotFound);
                if (request.Status != ServiceClosureStatus.Pending ||
                    Convert.ToBase64String(request.RowVersion) != expectedVersion)
                    return ServiceClosureResult.Failed(ServiceClosureFailure.Conflict);
                var actorKey = await ActorKeyAsync(actorId, cancellationToken);
                var requesterId = await context.Users.AsNoTracking()
                    .Where(item => item.Id == request.RequestedByAccountId)
                    .Select(item => item.PublicId).SingleAsync(cancellationToken);
                if (!ServiceClosurePolicy.CanDecide(requesterId, actorId))
                    return ServiceClosureResult.Failed(ServiceClosureFailure.Forbidden);
                var service = await context.ServiceDefinitions.SingleAsync(item =>
                    item.Id == request.ServiceDefinitionId, cancellationToken);
                if (approve && (!service.IsActive || !service.IsPublic))
                    return ServiceClosureResult.Failed(ServiceClosureFailure.Conflict);
                var now = DateTimeOffset.UtcNow;
                request.Status = approve ? ServiceClosureStatus.Approved : ServiceClosureStatus.Denied;
                request.DecidedAt = now;
                request.DecidedByAccountId = actorKey;
                request.DecisionReason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();
                request.UpdatedAt = now;
                if (approve)
                {
                    service.IsPublic = false;
                    service.UpdatedAt = now;
                }
                CommercialAuditWriter.Add(context, actorKey,
                    approve ? "commercial.service_closure.approved" :
                        "commercial.service_closure.denied",
                    "commercial.service_closure_requests", requestId, request.DecisionReason);
                await NotifyAsync(requestId, service.PublicId, approve, cancellationToken);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                await context.Entry(request).ReloadAsync(cancellationToken);
                if (approve) await context.Entry(service).ReloadAsync(cancellationToken);
                return ServiceClosureResult.Success(await MapAsync(request, cancellationToken));
            });
        }
        catch (DbUpdateConcurrencyException)
        {
            return ServiceClosureResult.Failed(ServiceClosureFailure.Conflict);
        }
    }

    public async Task<ServiceClosureResult> ReopenAsync(Guid actorId, Guid serviceId,
        string reason, string expectedServiceVersion,
        CancellationToken cancellationToken = default)
    {
        if (!await CanAsync(actorId, "reopen", cancellationToken))
            return ServiceClosureResult.Failed(ServiceClosureFailure.Forbidden);
        if (serviceId == Guid.Empty || !ValidVersion(expectedServiceVersion) ||
            !ServiceClosurePolicy.TryNormalizeReason(reason, out var normalized))
            return ServiceClosureResult.Failed(ServiceClosureFailure.Invalid);
        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(
                    IsolationLevel.Serializable, cancellationToken);
                var service = await context.ServiceDefinitions.SingleOrDefaultAsync(
                    item => item.PublicId == serviceId, cancellationToken);
                if (service is null)
                    return ServiceClosureResult.Failed(ServiceClosureFailure.NotFound);
                if (!service.IsActive || service.IsPublic ||
                    Convert.ToBase64String(service.RowVersion) != expectedServiceVersion ||
                    await context.ServiceClosureRequests.AnyAsync(item =>
                        item.ServiceDefinitionId == service.Id &&
                        item.Status == ServiceClosureStatus.Pending, cancellationToken))
                    return ServiceClosureResult.Failed(ServiceClosureFailure.Conflict);
                var closure = await context.ServiceClosureRequests
                    .Where(item => item.ServiceDefinitionId == service.Id &&
                        item.Status == ServiceClosureStatus.Approved &&
                        item.ReopenedAt == null)
                    .OrderByDescending(item => item.DecidedAt).ThenByDescending(item => item.Id)
                    .FirstOrDefaultAsync(cancellationToken);
                if (closure is null)
                    return ServiceClosureResult.Failed(ServiceClosureFailure.Conflict);
                var now = DateTimeOffset.UtcNow;
                var actorKey = await ActorKeyAsync(actorId, cancellationToken);
                closure.ReopenedAt = now;
                closure.ReopenedByAccountId = actorKey;
                closure.ReopenReason = normalized;
                closure.UpdatedAt = now;
                service.IsPublic = true;
                service.UpdatedAt = now;
                CommercialAuditWriter.Add(context, actorKey, "commercial.service_closure.reopened",
                    "commercial.service_closure_requests", closure.PublicId, normalized);
                await NotifyAsync(closure.PublicId, service.PublicId, true, cancellationToken);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                await context.Entry(closure).ReloadAsync(cancellationToken);
                await context.Entry(service).ReloadAsync(cancellationToken);
                return ServiceClosureResult.Success(await MapAsync(closure, cancellationToken));
            });
        }
        catch (DbUpdateConcurrencyException)
        {
            return ServiceClosureResult.Failed(ServiceClosureFailure.Conflict);
        }
    }

    private async Task<bool> CanAsync(Guid actorId, string action,
        CancellationToken cancellationToken)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        return actor?.Memberships.Any(membership =>
            membership.Kind == MembershipKind.InternalStaff &&
            membership.OrganizationType == OrganizationType.AviamOperator) == true &&
            await permissions.HasAnyAsync(actorId, action switch
            {
                "request" => ["operations.service_closures.request"],
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
            service.IsPublic, Convert.ToBase64String(service.RowVersion),
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
