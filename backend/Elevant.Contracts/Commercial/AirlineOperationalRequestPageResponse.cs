namespace Elevant.Contracts.Commercial;

public sealed record AirlineOperationalRequestResponse(
    Guid Id, Guid StationId, string StationCode, string ServiceName,
    string Description, string Status, DateTimeOffset RequestedAt,
    DateTimeOffset? NeededAt, Guid? OperationId, string? OperationCode,
    DateTimeOffset? ResolvedAt);

public sealed record AirlineOperationalRequestPageResponse(
    int Page, int Limit, bool HasMore,
    IReadOnlyList<AirlineOperationalRequestResponse> Requests);
