namespace Elevant.Application.Abstractions.Commercial;

/// <summary>
/// A closure request with the current state of its service: <c>IsCurrentlyPublic</c> and
/// <c>IsServiceActive</c> tell whether «Republicar» applies or the service must be reactivated first.
/// </summary>
public sealed record ServiceClosureData(Guid Id, Guid ServiceId, string ServiceName,
    string Reason, string Status, Guid RequestedBy, DateTimeOffset RequestedAt,
    string? DecisionReason, Guid? DecidedBy, DateTimeOffset? DecidedAt,
    DateTimeOffset? ReopenedAt, string? ReopenReason, bool IsCurrentlyPublic,
    bool IsServiceActive, string ServiceVersion, string Version);

public sealed record ServiceClosurePage(IReadOnlyList<ServiceClosureData> Items,
    bool HasMore, int PendingCount, IReadOnlyList<Guid> PendingServiceIds);

public enum ServiceClosureFailure { Forbidden, Invalid, NotFound, Conflict }

/// <summary>Outcome of a closure command; a failure carries the Problem Details code.</summary>
public sealed record ServiceClosureResult(ServiceClosureData? Request,
    ServiceClosureFailure? Failure, string? Code = null)
{
    public static ServiceClosureResult Success(ServiceClosureData request) => new(request, null);
    public static ServiceClosureResult Failed(ServiceClosureFailure failure, string? code = null) =>
        new(null, failure, code);
}

/// <summary>
/// OCC reports a closure, Contratos decides it (four eyes) and republishes the service with a reason.
/// The decision and the reopening take an optional Idempotency-Key while older clients exist (expand).
/// </summary>
public interface IServiceClosureStore
{
    Task<ServiceClosurePage?> ListAsync(Guid actorId, string? status, int page, int limit,
        CancellationToken cancellationToken = default);
    Task<ServiceClosureResult> RequestAsync(Guid actorId, Guid requestId, Guid serviceId,
        string reason, CancellationToken cancellationToken = default);
    Task<ServiceClosureResult> DecideAsync(Guid actorId, Guid requestId, bool approve,
        string? reason, string? expectedVersion, Guid? idempotencyKey,
        CancellationToken cancellationToken = default);
    Task<ServiceClosureResult> ReopenAsync(Guid actorId, Guid serviceId, string? reason,
        string? expectedServiceVersion, Guid? idempotencyKey, CancellationToken cancellationToken = default);
}
