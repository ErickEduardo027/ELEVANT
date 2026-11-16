namespace Elevant.Application.Abstractions.Realtime;

/// <summary>Reads only the current account's still-authorized change hints.</summary>
public interface IAccountChangeReadStore
{
    /// <returns>A scoped page, or null when the actor is no longer authorized.</returns>
    Task<AccountChangePage?> ReadAsync(Guid accountId, long after, int limit,
        CancellationToken cancellationToken = default);

    /// <summary>Scopes mobile-only hints to the installation making this request.</summary>
    Task<AccountChangePage?> ReadAsync(Guid accountId, long after, int limit,
        Guid? installationId, CancellationToken cancellationToken = default);
}

public sealed record AccountChangeData(
    Guid EventId,
    long Sequence,
    string Resource,
    Guid ResourceId,
    DateTimeOffset OccurredAt);

public sealed record AccountChangePage(
    IReadOnlyList<AccountChangeData> Changes,
    bool HasMore);
