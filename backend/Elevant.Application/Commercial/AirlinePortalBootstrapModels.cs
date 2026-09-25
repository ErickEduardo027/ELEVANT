namespace Elevant.Application.Commercial;

public sealed record AirlinePortalStationData(
    Guid Id,
    string Code,
    string Name,
    string IanaTimeZone);

public sealed record AirlinePortalBootstrapData(
    Guid AirlineId,
    Guid OrganizationId,
    string IataCode,
    string IcaoCode,
    string Name,
    IReadOnlyList<AirlinePortalStationData> Stations);

public enum AirlinePortalFailure
{
    Unauthorized,
    Forbidden,
    NotFound,
}

public sealed record AirlinePortalBootstrapResult(
    AirlinePortalBootstrapData? Bootstrap,
    AirlinePortalFailure? Failure)
{
    public bool IsSuccess => Bootstrap is not null && Failure is null;

    public static AirlinePortalBootstrapResult Success(AirlinePortalBootstrapData bootstrap) =>
        new(bootstrap, null);

    public static AirlinePortalBootstrapResult Failed(AirlinePortalFailure failure) =>
        new(null, failure);
}
