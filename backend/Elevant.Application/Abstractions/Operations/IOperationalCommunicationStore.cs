using Elevant.Application.Operations;

namespace Elevant.Application.Abstractions.Operations;

public interface IOperationalCommunicationStore
{
    Task<CommunicationResult<OperationConversationListData>> GetConversationsAsync(
        OperationalAccess access, Guid? stationId, CancellationToken cancellationToken = default);

    Task<CommunicationResult<OperationMessageListData>> GetMessagesAsync(
        OperationalAccess access, Guid operationId, CancellationToken cancellationToken = default);

    Task<CommunicationResult<OperationMessageData>> SendMessageAsync(
        SendOperationMessageCommand command, CancellationToken cancellationToken = default);

    Task<CommunicationResult<OperationalNotificationListData>> GetNotificationsAsync(
        OperationalAccess access, CancellationToken cancellationToken = default);

    Task<CommunicationResult<OperationalNotificationData>> SetNotificationReadAsync(
        OperationalAccess access, Guid notificationId, bool isRead,
        CancellationToken cancellationToken = default);
}
