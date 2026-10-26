namespace Elevant.Application.Abstractions.Identity;

public sealed record DepartmentNotificationData(Guid Id, string Department, string Kind, Guid SourceId,
    string? Subject, string? StationCode, DateTimeOffset OccurredAt, DateTimeOffset? ReadAt);

public sealed record DepartmentNotificationListData(IReadOnlyList<DepartmentNotificationData> Notifications,
    int UnreadCount, bool HasMore);

public enum DepartmentNotificationFailure { Forbidden, NotFound, Conflict }

public sealed record DepartmentNotificationResult<T>(T? Value, DepartmentNotificationFailure? Failure)
{
    public bool IsSuccess => Failure is null;

    public static DepartmentNotificationResult<T> Success(T value) => new(value, null);

    public static DepartmentNotificationResult<T> Failed(DepartmentNotificationFailure failure) => new(default, failure);
}

/// <summary>On-screen alerts of the caller's department (ADR-0018); OCC keeps its operational feed.</summary>
public interface IDepartmentNotificationStore
{
    Task<DepartmentNotificationResult<DepartmentNotificationListData>> ListAsync(Guid accountId,
        CancellationToken cancellationToken = default);

    Task<DepartmentNotificationResult<DepartmentNotificationData>> SetReadAsync(Guid accountId,
        Guid notificationId, bool read, CancellationToken cancellationToken = default);
}
