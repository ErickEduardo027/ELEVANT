namespace Elevant.Contracts.Identity;

public sealed record DepartmentNotificationResponse(
    Guid Id, string Department, string Kind, Guid SourceId, string? Subject,
    string? StationCode, DateTimeOffset OccurredAt, DateTimeOffset? ReadAt);

public sealed record DepartmentNotificationListResponse(
    IReadOnlyList<DepartmentNotificationResponse> Notifications, int UnreadCount, bool HasMore);

public sealed record SetDepartmentNotificationReadRequest(bool Read);
