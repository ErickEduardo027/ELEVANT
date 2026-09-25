namespace Elevant.Contracts.Commercial;

/// <summary>Airline tenant and stations currently covered by an approved contract.</summary>
public sealed record AirlinePortalBootstrapResponse(
    Guid AirlineId,
    Guid OrganizationId,
    string IataCode,
    string IcaoCode,
    string Name,
    IReadOnlyList<AirlinePortalStationResponse> Stations,
    IReadOnlyList<AirlinePortalOperationResponse> CurrentOperations);

public sealed record AirlinePortalStationResponse(
    Guid Id,
    string Code,
    string Name,
    string IanaTimeZone);

/// <summary>Bounded, current-operation summary from the authenticated airline's contracted stations.</summary>
public sealed record AirlinePortalOperationResponse(
    Guid Id,
    string Code,
    Guid StationId,
    string StationCode,
    DateOnly OperationDate,
    string Status,
    string? ArrivalFlightNumber,
    string? DepartureFlightNumber,
    DateTimeOffset? PlannedStartAt,
    DateTimeOffset? PlannedEndAt);
