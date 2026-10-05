namespace Elevant.Application.Abstractions.Commercial;

public sealed record ServiceClosureData(Guid Id, Guid ServiceId, string ServiceName,
    string Reason, string Status, Guid RequestedBy, DateTimeOffset RequestedAt,
    string? DecisionReason, Guid? DecidedBy, DateTimeOffset? DecidedAt,
    DateTimeOffset? ReopenedAt, string? ReopenReason, bool IsCurrentlyPublic,
    string ServiceVersion, string Version);

public sealed record ServiceClosurePage(IReadOnlyList<ServiceClosureData> Items,
    bool HasMore, int PendingCount, IReadOnlyList<Guid> PendingServiceIds);

public enum ServiceClosureFailure { Forbidden, Invalid, NotFound, Conflict }

public sealed record ServiceClosureResult(ServiceClosureData? Request,
    ServiceClosureFailure? Failure)
{
    public static ServiceClosureResult Success(ServiceClosureData request) => new(request, null);
    public static ServiceClosureResult Failed(ServiceClosureFailure failure) => new(null, failure);
}

public interface IServiceClosureStore
{
    Task<ServiceClosurePage?> ListAsync(Guid actorId, string? status, int page, int limit,
        CancellationToken cancellationToken = default);
    Task<ServiceClosureResult> RequestAsync(Guid actorId, Guid requestId, Guid serviceId,
        string reason, CancellationToken cancellationToken = default);
    Task<ServiceClosureResult> DecideAsync(Guid actorId, Guid requestId, bool approve,
        string? reason, string expectedVersion, CancellationToken cancellationToken = default);
    Task<ServiceClosureResult> ReopenAsync(Guid actorId, Guid serviceId, string reason,
        string expectedServiceVersion, CancellationToken cancellationToken = default);
}
