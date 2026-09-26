using System.Data;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Elevant.Persistence.Operations;

/// <summary>Scoped, bounded operational messaging and account-owned notifications.</summary>
internal sealed class EfOperationalCommunicationStore(
    ElevantDbContext context, TimeProvider timeProvider) : IOperationalCommunicationStore
{
    private const int PageLimit = 100;
    private const int MessageLimit = 200;

    public async Task<CommunicationResult<OperationConversationListData>> GetConversationsAsync(
        OperationalAccess access, Guid? stationId, CancellationToken cancellationToken = default)
    {
        var actor = await ResolveActorAsync(access, null, cancellationToken);
        if (actor is null)
            return CommunicationResults.Failed<OperationConversationListData>(OperationalCommunicationFailure.Forbidden);
        var allowed = stationId is Guid selected ? [selected] : access.AllowedStationIds.ToArray();
        var query = from operation in context.GroundOperations.AsNoTracking()
            join turnaround in context.Turnarounds.AsNoTracking()
                on operation.TurnaroundId equals turnaround.Id
            join station in context.Stations.AsNoTracking()
                on turnaround.StationId equals station.Id
            join airline in context.Airlines.AsNoTracking()
                on turnaround.AirlineId equals airline.Id
            where station.IsActive && allowed.Contains(station.PublicId)
            select new
            {
                OperationInternalId = operation.Id, OperationId = operation.PublicId,
                turnaround.OperationCode, turnaround.OperationDate,
                StationInternalId = station.Id,
                StationCode = station.Code, AirlineName = airline.Name,
                Status = operation.CurrentStatus,
            };
        if (access.Role == "agent")
        {
            var agentId = actor.AgentId!.Value;
            query = query.Where(row => context.OperationAgentAssignments.AsNoTracking()
                .Any(assignment => assignment.GroundOperationId == row.OperationInternalId &&
                    assignment.RampAgentId == agentId && assignment.ReleasedAt == null) &&
                context.Set<RampAgentStationScope>().AsNoTracking().Any(scope =>
                    scope.RampAgentId == agentId && scope.StationId == row.StationInternalId &&
                    scope.ValidFrom <= row.OperationDate &&
                    (scope.ValidTo == null || scope.ValidTo >= row.OperationDate)));
        }
        else
        {
            var now = timeProvider.GetUtcNow();
            query = query.Where(row => context.AccountStationScopes.AsNoTracking().Any(scope =>
                scope.AccountId == actor.AccountId && scope.StationId == row.StationInternalId &&
                scope.GrantedAt <= now && scope.RevokedAt == null));
        }
        var rows = await query.OrderByDescending(row => row.OperationDate)
            .ThenByDescending(row => row.OperationInternalId)
            .Take(PageLimit + 1).ToArrayAsync(cancellationToken);
        var visible = rows.Take(PageLimit).ToArray();
        var operationIds = visible.Select(row => row.OperationInternalId).ToArray();
        var latestIds = context.OperationMessages.AsNoTracking()
            .Where(message => operationIds.Contains(message.GroundOperationId))
            .GroupBy(message => message.GroundOperationId)
            .Select(group => new { GroundOperationId = group.Key, MessageId = group.Max(item => item.Id) });
        var latestMessages = await (from latest in latestIds
            join message in context.OperationMessages.AsNoTracking()
                on latest.MessageId equals message.Id
            join sender in context.Users.AsNoTracking()
                on message.SenderAccountId equals sender.Id
            select new
            {
                message.GroundOperationId, message.PublicId,
                SenderAccountId = sender.PublicId,
                message.SenderRole, message.Content, message.SentAt,
            }).ToArrayAsync(cancellationToken);
        var latestByOperation = latestMessages.ToDictionary(message => message.GroundOperationId);
        return CommunicationResults.Success(new OperationConversationListData(
            visible.Select(row =>
            {
                latestByOperation.TryGetValue(row.OperationInternalId, out var last);
                return new OperationConversationData(
                    row.OperationId, row.OperationCode, row.OperationDate,
                    row.StationCode, row.AirlineName, null, row.Status.ToString(),
                    last is null ? null : new OperationMessageData(
                        last.PublicId, row.OperationId, last.SenderAccountId, last.SenderRole,
                        last.SenderRole == "agent" ? "Agente" : "OCC", last.Content,
                        last.SentAt));
            }).ToArray(), rows.Length > PageLimit));
    }

    public async Task<CommunicationResult<OperationMessageListData>> GetMessagesAsync(
        OperationalAccess access, Guid operationId, CancellationToken cancellationToken = default)
    {
        var scope = await ResolveOperationAsync(access, operationId, null, cancellationToken);
        if (scope is null)
            return CommunicationResults.Failed<OperationMessageListData>(OperationalCommunicationFailure.NotFound);
        var rows = await (
            from message in context.OperationMessages.AsNoTracking()
            join sender in context.Users.AsNoTracking()
                on message.SenderAccountId equals sender.Id
            join person in context.Persons.AsNoTracking()
                on sender.PersonId equals person.Id
            where message.GroundOperationId == scope.OperationInternalId
            orderby message.SentAt descending, message.Id descending
            select new
            {
                message.PublicId, senderAccountId = sender.PublicId,
                message.SenderRole, SenderName = person.FirstName + " " + person.LastName,
                message.Content, message.SentAt,
            })
            .Take(MessageLimit + 1).ToArrayAsync(cancellationToken);
        return CommunicationResults.Success(new OperationMessageListData(
            operationId, rows.Take(MessageLimit).Reverse().Select(row =>
                new OperationMessageData(row.PublicId, operationId, row.senderAccountId,
                    row.SenderRole, row.SenderName.Trim(), row.Content, row.SentAt)).ToArray(),
            rows.Length > MessageLimit));
    }

    public async Task<CommunicationResult<OperationMessageData>> SendMessageAsync(
        SendOperationMessageCommand command, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        CommunicationResult<OperationMessageData>? attempt = null;
        Guid? committedMessageId = null;
        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteInTransactionAsync(
                async token =>
                {
                    context.ChangeTracker.Clear();
                    attempt = await SendInsideTransactionAsync(command, token);
                    committedMessageId = attempt.Value?.Id;
                    if (!attempt.IsSuccess) context.ChangeTracker.Clear();
                    return attempt;
                },
                async token => committedMessageId is not Guid messageId ||
                    await context.OperationMessages.AsNoTracking()
                        .AnyAsync(item => item.PublicId == messageId, token),
                IsolationLevel.Serializable,
                cancellationToken);
        }
        catch (DbUpdateException exception) when (IsUniqueConflict(exception))
        {
            context.ChangeTracker.Clear();
            return await ResolveConcurrentReplayAsync(command, cancellationToken);
        }
        catch (RetryLimitExceededException)
        {
            context.ChangeTracker.Clear();
            return CommunicationResults.Failed<OperationMessageData>(OperationalCommunicationFailure.Conflict);
        }
    }

    private async Task<CommunicationResult<OperationMessageData>> SendInsideTransactionAsync(
        SendOperationMessageCommand command, CancellationToken cancellationToken)
    {
        var scope = await ResolveOperationAsync(
            command.Access, command.OperationId, command.InstallationId, cancellationToken);
        if (scope is null)
            return CommunicationResults.Failed<OperationMessageData>(OperationalCommunicationFailure.NotFound);
        var existing = await context.OperationMessages
            .FromSqlInterpolated($"""
                SELECT * FROM [ops].[operation_messages] WITH (UPDLOCK, HOLDLOCK)
                WHERE [sender_account_id] = {scope.AccountInternalId}
                  AND [client_message_id] = {command.ClientMessageId}
                """)
            .SingleOrDefaultAsync(cancellationToken);
        if (existing is not null)
            return await ReplayAsync(existing, scope, command, cancellationToken);

        var now = TruncateMilliseconds(timeProvider.GetUtcNow());
        var senderName = await SenderNameAsync(scope.AccountInternalId, cancellationToken);
        var message = OperationMessageChangeWriter.Add(
            context, scope.OperationInternalId, scope.StationInternalId,
            scope.AccountInternalId, scope.DeviceInternalId,
            command.ClientMessageId, command.Access.Role, command.Content, now);
        if (command.Access.Role == "agent")
            await OperationalNotificationWriter.NotifyOccAsync(
                context, scope.StationInternalId, scope.OperationInternalId,
                message.PublicId, "agent_message", now, scope.AccountInternalId,
                cancellationToken);
        else
            await OperationalNotificationWriter.NotifyAssignedAgentsAsync(
                context, scope.StationInternalId, scope.OperationInternalId,
                message.PublicId, "occ_message", now, scope.AccountInternalId,
                cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
        return CommunicationResults.Success(new OperationMessageData(
            message.PublicId, command.OperationId, command.Access.AccountId,
            command.Access.Role, senderName, message.Content, message.SentAt));
    }

    private async Task<CommunicationResult<OperationMessageData>> ReplayAsync(
        OperationMessage existing, CommunicationOperation scope,
        SendOperationMessageCommand command, CancellationToken cancellationToken)
    {
        if (existing.GroundOperationId != scope.OperationInternalId ||
            existing.SenderRole != command.Access.Role ||
            existing.MobileDeviceId != scope.DeviceInternalId ||
            existing.Content != command.Content)
            return CommunicationResults.Failed<OperationMessageData>(OperationalCommunicationFailure.Conflict);
        var senderName = await SenderNameAsync(scope.AccountInternalId, cancellationToken);
        return CommunicationResults.Success(new OperationMessageData(
            existing.PublicId, command.OperationId, command.Access.AccountId,
            existing.SenderRole, senderName, existing.Content, existing.SentAt));
    }

    private async Task<CommunicationResult<OperationMessageData>> ResolveConcurrentReplayAsync(
        SendOperationMessageCommand command, CancellationToken cancellationToken)
    {
        var scope = await ResolveOperationAsync(
            command.Access, command.OperationId, command.InstallationId, cancellationToken);
        if (scope is null)
            return CommunicationResults.Failed<OperationMessageData>(OperationalCommunicationFailure.NotFound);
        var existing = await context.OperationMessages.AsNoTracking()
            .SingleOrDefaultAsync(item => item.SenderAccountId == scope.AccountInternalId &&
                item.ClientMessageId == command.ClientMessageId, cancellationToken);
        return existing is null
            ? CommunicationResults.Failed<OperationMessageData>(OperationalCommunicationFailure.Conflict)
            : await ReplayAsync(existing, scope, command, cancellationToken);
    }

    private async Task<string> SenderNameAsync(long accountId, CancellationToken cancellationToken) =>
        await (from account in context.Users.AsNoTracking()
            join person in context.Persons.AsNoTracking()
                on account.PersonId equals person.Id
            where account.Id == accountId
            select person.FirstName + " " + person.LastName)
            .SingleAsync(cancellationToken);

    private static DateTimeOffset TruncateMilliseconds(DateTimeOffset value) =>
        new(value.Ticks - value.Ticks % TimeSpan.TicksPerMillisecond, TimeSpan.Zero);

    private static bool IsUniqueConflict(DbUpdateException exception) =>
        exception.InnerException is SqlException sql && sql.Number is 2601 or 2627;

    public async Task<CommunicationResult<OperationalNotificationListData>> GetNotificationsAsync(
        OperationalAccess access, CancellationToken cancellationToken = default)
    {
        var actor = await ResolveActorAsync(access, null, cancellationToken);
        if (actor is null)
            return CommunicationResults.Failed<OperationalNotificationListData>(OperationalCommunicationFailure.Forbidden);
        var rows = await (
            from notification in context.OperationalNotifications.AsNoTracking()
            join operation in context.GroundOperations.AsNoTracking()
                on notification.GroundOperationId equals operation.Id
            join turnaround in context.Turnarounds.AsNoTracking()
                on operation.TurnaroundId equals turnaround.Id
            join station in context.Stations.AsNoTracking()
                on notification.StationId equals station.Id
            where notification.RecipientAccountId == actor.AccountId &&
                  access.AllowedStationIds.Contains(station.PublicId) && station.IsActive
            orderby notification.OccurredAt descending, notification.Id descending
            select new OperationalNotificationData(
                notification.PublicId, operation.PublicId, turnaround.OperationCode,
                station.Code, notification.Kind, notification.SourceId,
                notification.OccurredAt, notification.ReadAt))
            .Take(PageLimit + 1).ToArrayAsync(cancellationToken);
        return CommunicationResults.Success(new OperationalNotificationListData(
            rows.Take(PageLimit).ToArray(), rows.Length > PageLimit));
    }

    public async Task<CommunicationResult<OperationalNotificationData>> SetNotificationReadAsync(
        OperationalAccess access, Guid notificationId, bool isRead,
        CancellationToken cancellationToken = default)
    {
        var actor = await ResolveActorAsync(access, null, cancellationToken);
        if (actor is null)
            return CommunicationResults.Failed<OperationalNotificationData>(OperationalCommunicationFailure.Forbidden);
        var item = await context.OperationalNotifications
            .SingleOrDefaultAsync(notification => notification.PublicId == notificationId &&
                notification.RecipientAccountId == actor.AccountId &&
                context.Stations.Any(station => station.Id == notification.StationId &&
                    station.IsActive && access.AllowedStationIds.Contains(station.PublicId)),
                cancellationToken);
        if (item is null)
            return CommunicationResults.Failed<OperationalNotificationData>(OperationalCommunicationFailure.NotFound);
        if (item.ReadAt.HasValue != isRead)
        {
            var now = TruncateMilliseconds(timeProvider.GetUtcNow());
            item.ReadAt = isRead ? now : null;
            item.UpdatedAt = now;
            try
            {
                await context.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateConcurrencyException)
            {
                context.ChangeTracker.Clear();
                return CommunicationResults.Failed<OperationalNotificationData>(
                    OperationalCommunicationFailure.Conflict);
            }
        }
        var contextRow = await (
            from operation in context.GroundOperations.AsNoTracking()
            join turnaround in context.Turnarounds.AsNoTracking()
                on operation.TurnaroundId equals turnaround.Id
            join station in context.Stations.AsNoTracking()
                on item.StationId equals station.Id
            where operation.Id == item.GroundOperationId
            select new { operation.PublicId, turnaround.OperationCode, StationCode = station.Code })
            .SingleAsync(cancellationToken);
        return CommunicationResults.Success(new OperationalNotificationData(
            item.PublicId, contextRow.PublicId, contextRow.OperationCode,
            contextRow.StationCode, item.Kind, item.SourceId, item.OccurredAt, item.ReadAt));
    }

    private async Task<CommunicationActor?> ResolveActorAsync(
        OperationalAccess access, Guid? installationId, CancellationToken cancellationToken)
    {
        if (access.Role == "agent")
        {
            var authorization = new EfRampExecutionAuthorization(context, timeProvider);
            var result = await authorization.ResolveActorAsync(
                access.AccountId, access.AllowedStationIds, installationId, cancellationToken);
            return result.IsSuccess
                ? new CommunicationActor(result.Access!.AccountInternalId,
                    result.Access.RampAgentInternalId, result.Access.Device?.Id)
                : null;
        }
        if (access.Role != "occ") return null;
        var live = await new EfActorContextResolver(context, timeProvider)
            .ResolveAsync(access.AccountId, cancellationToken);
        if (live is null ||
            !live.Roles.Any(role => role.Code == "ADMIN_OCC" && role.Portal == PortalKind.BackOffice) ||
            !live.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff)) return null;
        var accountId = await context.Users.AsNoTracking()
            .Where(user => user.PublicId == access.AccountId)
            .Select(user => user.Id).SingleOrDefaultAsync(cancellationToken);
        return accountId == 0 ? null : new CommunicationActor(accountId, null, null);
    }

    private async Task<CommunicationOperation?> ResolveOperationAsync(
        OperationalAccess access, Guid operationId, Guid? installationId,
        CancellationToken cancellationToken)
    {
        var actor = await ResolveActorAsync(access, installationId, cancellationToken);
        if (actor is null) return null;
        if (access.Role == "agent")
        {
            var authorization = new EfRampExecutionAuthorization(context, timeProvider);
            var actorResult = await authorization.ResolveActorAsync(
                access.AccountId, access.AllowedStationIds, installationId, cancellationToken);
            if (!actorResult.IsSuccess) return null;
            var scope = await authorization.ResolveOperationAsync(
                actorResult.Access!, operationId, false, cancellationToken);
            return scope is null ? null : new CommunicationOperation(
                scope.Operation.Id, scope.StationInternalId, actor.AccountId,
                actor.DeviceId);
        }
        var now = timeProvider.GetUtcNow();
        var row = await (
            from operation in context.GroundOperations.AsNoTracking()
            join turnaround in context.Turnarounds.AsNoTracking()
                on operation.TurnaroundId equals turnaround.Id
            join station in context.Stations.AsNoTracking()
                on turnaround.StationId equals station.Id
            where operation.PublicId == operationId && station.IsActive &&
                  access.AllowedStationIds.Contains(station.PublicId) &&
                  context.AccountStationScopes.AsNoTracking().Any(scope =>
                      scope.AccountId == actor.AccountId && scope.StationId == station.Id &&
                      scope.GrantedAt <= now && scope.RevokedAt == null)
            select new { operation.Id, StationId = station.Id })
            .SingleOrDefaultAsync(cancellationToken);
        return row is null ? null : new CommunicationOperation(
            row.Id, row.StationId, actor.AccountId, null);
    }

    private sealed record CommunicationActor(long AccountId, long? AgentId, long? DeviceId);
    private sealed record CommunicationOperation(
        long OperationInternalId, long StationInternalId,
        long AccountInternalId, long? DeviceInternalId);
}
