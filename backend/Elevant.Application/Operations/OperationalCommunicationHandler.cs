using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;

namespace Elevant.Application.Operations;

/// <summary>Authorizes OCC and assigned mobile actors before operational communication.</summary>
public sealed class OperationalCommunicationHandler(
    IActorContextResolver actorResolver, IOperationalCommunicationStore store)
{
    public async Task<CommunicationResult<OperationConversationListData>> GetConversationsAsync(
        Guid accountId, Guid? stationId, CancellationToken cancellationToken = default)
    {
        var access = await ResolveAccessAsync(accountId, cancellationToken);
        if (access.Failure is { } failure)
            return CommunicationResults.Failed<OperationConversationListData>(failure);
        if (stationId == Guid.Empty || (stationId is Guid requested &&
            !access.Value!.AllowedStationIds.Contains(requested)))
            return CommunicationResults.Failed<OperationConversationListData>(OperationalCommunicationFailure.NotFound);
        return await store.GetConversationsAsync(access.Value!, stationId, cancellationToken);
    }

    public async Task<CommunicationResult<OperationMessageListData>> GetMessagesAsync(
        Guid accountId, Guid operationId, CancellationToken cancellationToken = default)
    {
        var access = await ResolveAccessAsync(accountId, cancellationToken);
        if (access.Failure is { } failure)
            return CommunicationResults.Failed<OperationMessageListData>(failure);
        if (operationId == Guid.Empty)
            return CommunicationResults.Failed<OperationMessageListData>(OperationalCommunicationFailure.InvalidRequest);
        return await store.GetMessagesAsync(access.Value!, operationId, cancellationToken);
    }

    public async Task<CommunicationResult<OperationMessageData>> SendMessageAsync(
        Guid accountId, Guid operationId, Guid clientMessageId, Guid? installationId,
        string? content, CancellationToken cancellationToken = default)
    {
        var access = await ResolveAccessAsync(accountId, cancellationToken);
        if (access.Failure is { } failure)
            return CommunicationResults.Failed<OperationMessageData>(failure);
        var body = content?.Trim();
        if (operationId == Guid.Empty || clientMessageId == Guid.Empty ||
            string.IsNullOrWhiteSpace(body) || body.Length > 2000 ||
            body.Any(character => char.IsControl(character) &&
                character is not '\t' and not '\n' and not '\r') ||
            (access.Value!.Role == "agent" && (!installationId.HasValue || installationId.Value == Guid.Empty)))
            return CommunicationResults.Failed<OperationMessageData>(OperationalCommunicationFailure.InvalidRequest);
        return await store.SendMessageAsync(new SendOperationMessageCommand(
            access.Value!, operationId, clientMessageId, installationId, body), cancellationToken);
    }

    public async Task<CommunicationResult<OperationalNotificationListData>> GetNotificationsAsync(
        Guid accountId, CancellationToken cancellationToken = default)
    {
        var access = await ResolveAccessAsync(accountId, cancellationToken);
        return access.Failure is { } failure
            ? CommunicationResults.Failed<OperationalNotificationListData>(failure)
            : await store.GetNotificationsAsync(access.Value!, cancellationToken);
    }

    public async Task<CommunicationResult<OperationalNotificationData>> SetNotificationReadAsync(
        Guid accountId, Guid notificationId, bool isRead,
        CancellationToken cancellationToken = default)
    {
        var access = await ResolveAccessAsync(accountId, cancellationToken);
        if (access.Failure is { } failure)
            return CommunicationResults.Failed<OperationalNotificationData>(failure);
        if (notificationId == Guid.Empty)
            return CommunicationResults.Failed<OperationalNotificationData>(OperationalCommunicationFailure.InvalidRequest);
        return await store.SetNotificationReadAsync(access.Value!, notificationId, isRead, cancellationToken);
    }

    private async Task<CommunicationResult<OperationalAccess>> ResolveAccessAsync(
        Guid accountId, CancellationToken cancellationToken)
    {
        if (accountId == Guid.Empty)
            return CommunicationResults.Failed<OperationalAccess>(OperationalCommunicationFailure.Unauthorized);
        var actor = await actorResolver.ResolveAsync(accountId, cancellationToken);
        if (!ActorContextValidator.IsValid(actor, accountId))
            return CommunicationResults.Failed<OperationalAccess>(OperationalCommunicationFailure.Unauthorized);
        var role = OccPlanningAccess.IsAuthorized(actor!) ? "occ" :
            RampOperationsAccess.IsAuthorized(actor!) ? "agent" : null;
        if (role is null)
            return CommunicationResults.Failed<OperationalAccess>(OperationalCommunicationFailure.Forbidden);
        var stationIds = actor!.StationScopes.Select(scope => scope.StationId)
            .Where(id => id != Guid.Empty).Distinct().ToArray();
        return stationIds.Length == 0
            ? CommunicationResults.Failed<OperationalAccess>(OperationalCommunicationFailure.NotFound)
            : CommunicationResults.Success(new OperationalAccess(accountId, role, stationIds));
    }
}
