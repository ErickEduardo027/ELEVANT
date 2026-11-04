namespace Elevant.Application.Operations;

public enum OperationalCommunicationFailure
{
    Unauthorized,
    Forbidden,
    InvalidRequest,
    NotFound,
    Conflict,
}

public sealed record OperationalAccess(
    Guid AccountId, string Role, IReadOnlyCollection<Guid> AllowedStationIds);

public sealed record OperationMessageData(
    Guid Id, Guid OperationId, Guid SenderAccountId, string SenderRole,
    string SenderName, string Content, DateTimeOffset SentAt);

/// <param name="UnreadCount">Messages from others after the reader's cursor (ADR-0029).</param>
/// <param name="OthersReadUpTo">Latest message time the other participants have read («visto»).</param>
public sealed record OperationConversationData(
    Guid OperationId, string OperationCode, DateOnly OperationDate,
    string StationCode, string AirlineName, string? AgentName,
    string Status, OperationMessageData? LastMessage, int UnreadCount = 0, DateTimeOffset? OthersReadUpTo = null);

public sealed record OperationConversationListData(
    IReadOnlyList<OperationConversationData> Conversations, bool HasMore);

public sealed record OperationMessageListData(
    Guid OperationId, IReadOnlyList<OperationMessageData> Messages, bool HasMore, DateTimeOffset? OthersReadUpTo = null);

public sealed record OperationConversationReadData(Guid OperationId, Guid MessageId, DateTimeOffset ReadAt);

public sealed record OperationalNotificationData(
    Guid Id, Guid OperationId, string OperationCode, string StationCode,
    string Kind, Guid SourceId, DateTimeOffset OccurredAt, DateTimeOffset? ReadAt);

public sealed record OperationalNotificationListData(
    IReadOnlyList<OperationalNotificationData> Notifications, bool HasMore);

public sealed record CommunicationResult<T>(T? Value, OperationalCommunicationFailure? Failure)
    where T : class
{
    public bool IsSuccess => Value is not null && Failure is null;
}

public static class CommunicationResults
{
    public static CommunicationResult<T> Success<T>(T value) where T : class => new(value, null);
    public static CommunicationResult<T> Failed<T>(OperationalCommunicationFailure failure)
        where T : class => new(null, failure);
}

public sealed record SendOperationMessageCommand(
    OperationalAccess Access, Guid OperationId, Guid ClientMessageId,
    Guid? InstallationId, string Content);
