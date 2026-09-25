namespace Elevant.Contracts.Commercial;

/// <summary>Airline tenant and stations currently covered by an approved contract.</summary>
public sealed record AirlinePortalBootstrapResponse(
    Guid AirlineId,
    Guid OrganizationId,
    string IataCode,
    string IcaoCode,
    string Name,
    IReadOnlyList<AirlinePortalStationResponse> Stations);

public sealed record AirlinePortalStationResponse(
    Guid Id,
    string Code,
    string Name,
    string IanaTimeZone);
