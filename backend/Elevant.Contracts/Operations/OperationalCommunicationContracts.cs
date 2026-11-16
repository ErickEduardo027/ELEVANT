namespace Elevant.Contracts.Operations;

public sealed record OperationMessageResponse(
    Guid Id, Guid OperationId, Guid SenderAccountId, string SenderRole,
    string SenderName, string Content, DateTimeOffset SentAt);

public sealed record OperationConversationResponse(
    Guid OperationId, string OperationCode, DateOnly OperationDate,
    string StationCode, string AirlineName, string? AgentName,
    string Status, OperationMessageResponse? LastMessage, int UnreadCount, DateTimeOffset? OthersReadUpTo);

public sealed record OperationConversationListResponse(
    IReadOnlyList<OperationConversationResponse> Conversations, bool HasMore);

public sealed record OperationMessageListResponse(
    Guid OperationId, IReadOnlyList<OperationMessageResponse> Messages, bool HasMore, DateTimeOffset? OthersReadUpTo);

/// <summary>Moves the reader's cursor up to this message; it never goes back.</summary>
public sealed record MarkOperationalConversationReadRequest(Guid MessageId);

public sealed record SendOperationMessageRequest(string Content);

public sealed record OperationalNotificationResponse(
    Guid Id, Guid OperationId, string OperationCode, string StationCode,
    string Kind, Guid SourceId, DateTimeOffset OccurredAt, DateTimeOffset? ReadAt);

public sealed record OperationalNotificationListResponse(
    IReadOnlyList<OperationalNotificationResponse> Notifications, bool HasMore);

public sealed record SetOperationalNotificationReadRequest(bool Read);
