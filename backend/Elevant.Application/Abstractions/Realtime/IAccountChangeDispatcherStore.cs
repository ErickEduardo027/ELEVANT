namespace Elevant.Application.Abstractions.Realtime;

/// <summary>Atomically projects committed account outbox events into the ordered feed.</summary>
public interface IAccountChangeDispatcherStore
{
    Task<IReadOnlyList<AccountChangeDispatchNotice>> DispatchPendingAsync(
        int limit, CancellationToken cancellationToken = default);
}

/// <summary>Post-commit push target; the internal sequence must be encoded before sending to clients.</summary>
public sealed record AccountChangeDispatchNotice(
    Guid AccountPublicId,
    Guid OutboxPublicId,
    Guid EventId,
    string Resource,
    long Sequence);
