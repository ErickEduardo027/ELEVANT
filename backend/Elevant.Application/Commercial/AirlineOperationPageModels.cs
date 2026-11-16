namespace Elevant.Application.Commercial;

public sealed record AirlineOperationPageData(
    IReadOnlyList<AirlinePortalOperationData> Operations, bool HasMore);

public sealed record AirlineOperationPageResult(
    AirlineOperationPageData? Page, AirlinePortalFailure? Failure)
{
    public bool IsSuccess => Page is not null && Failure is null;

    public static AirlineOperationPageResult Success(AirlineOperationPageData page) =>
        new(page, null);

    public static AirlineOperationPageResult Failed(AirlinePortalFailure failure) =>
        new(null, failure);
}

public sealed record AirlineOperationDetailResult(
    AirlinePortalOperationData? Operation, AirlinePortalFailure? Failure)
{
    public bool IsSuccess => Operation is not null && Failure is null;

    public static AirlineOperationDetailResult Success(AirlinePortalOperationData operation) =>
        new(operation, null);

    public static AirlineOperationDetailResult Failed(AirlinePortalFailure failure) =>
        new(null, failure);
}
