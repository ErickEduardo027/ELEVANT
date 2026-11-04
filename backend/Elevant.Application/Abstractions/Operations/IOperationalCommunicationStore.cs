using Elevant.Application.Operations;

namespace Elevant.Application.Abstractions.Operations;

public interface IOperationalCommunicationStore
{
    Task<CommunicationResult<OperationConversationListData>> GetConversationsAsync(
        OperationalAccess access, Guid? stationId, CancellationToken cancellationToken = default) =>
        GetConversationsAsync(access, stationId, 0, cancellationToken);

    Task<CommunicationResult<OperationConversationListData>> GetConversationsAsync(
        OperationalAccess access, Guid? stationId, int offset, CancellationToken cancellationToken = default);

    Task<CommunicationResult<OperationMessageListData>> GetMessagesAsync(
        OperationalAccess access, Guid operationId, CancellationToken cancellationToken = default) =>
        GetMessagesAsync(access, operationId, 0, cancellationToken);

    Task<CommunicationResult<OperationMessageListData>> GetMessagesAsync(
        OperationalAccess access, Guid operationId, int offset, CancellationToken cancellationToken = default);

    Task<CommunicationResult<OperationPresenceContactsList>> GetPresenceParticipantsAsync(
        OperationalAccess access, IReadOnlyCollection<Guid> operationIds, CancellationToken cancellationToken = default) =>
        Task.FromResult(CommunicationResults.Success(new OperationPresenceContactsList(Array.Empty<OperationPresenceContacts>())));

    Task<CommunicationResult<OperationConversationReadData>> MarkReadAsync(
        OperationalAccess access, Guid operationId, Guid messageId, CancellationToken cancellationToken = default);

    Task<CommunicationResult<OperationMessageData>> SendMessageAsync(
        SendOperationMessageCommand command, CancellationToken cancellationToken = default);

    Task<CommunicationResult<OperationalNotificationListData>> GetNotificationsAsync(
        OperationalAccess access, CancellationToken cancellationToken = default);

    Task<CommunicationResult<OperationalNotificationData>> SetNotificationReadAsync(
        OperationalAccess access, Guid notificationId, bool isRead,
        CancellationToken cancellationToken = default);
}
