namespace Elevant.Contracts.Realtime;

public sealed record AccountChangeResponse(
    Guid EventId,
    string Cursor,
    string Resource,
    Guid ResourceId,
    DateTimeOffset OccurredAt);

public sealed record AccountChangeListResponse(
    IReadOnlyList<AccountChangeResponse> Changes,
    string? NextCursor,
    bool HasMore);
