namespace Elevant.Application.Commercial;

public sealed record AirlineOperationalRequestData(
    Guid Id, Guid StationId, string StationCode, string ServiceName,
    string Description, string Status, DateTimeOffset RequestedAt,
    DateTimeOffset? NeededAt, Guid? OperationId, string? OperationCode,
    DateTimeOffset? ResolvedAt);

public sealed record AirlineOperationalRequestPageData(
    IReadOnlyList<AirlineOperationalRequestData> Requests, bool HasMore);

public sealed record AirlineOperationalRequestPageResult(
    AirlineOperationalRequestPageData? Page, AirlinePortalFailure? Failure)
{
    public bool IsSuccess => Page is not null && Failure is null;

    public static AirlineOperationalRequestPageResult Success(
        AirlineOperationalRequestPageData page) => new(page, null);

    public static AirlineOperationalRequestPageResult Failed(
        AirlinePortalFailure failure) => new(null, failure);
}
