namespace Elevant.Contracts.Operations;

public sealed record OccPositionTurnaroundResponse(Guid TurnaroundId, string OperationCode, string AirlineName,
    string? AircraftRegistration, string? ArrivalFlightNumber, string? DepartureFlightNumber,
    DateTimeOffset? ArrivalScheduledAt, DateTimeOffset? ArrivedAt, DateTimeOffset? DepartureScheduledAt,
    DateTimeOffset? AssignedFrom, string Status);

/// <param name="Latitude">WGS84 location OCC placed on the map (ADR-0027); null until placed.</param>
public sealed record OccPositionResponse(Guid StandId, string Code, string? TerminalCode, string? StandType, string Status,
    IReadOnlyList<OccPositionTurnaroundResponse> Turnarounds, decimal? Latitude, decimal? Longitude);

/// <summary>Both null clears the stand's location.</summary>
public sealed record LocateOccStandRequest(decimal? Latitude, decimal? Longitude, DateOnly OperationDate);

public sealed record OccPositionBoardResponse(Guid StationId, string StationCode, DateOnly OperationDate, DateTimeOffset AsOf,
    IReadOnlyList<OccPositionResponse> Positions, IReadOnlyList<OccPositionTurnaroundResponse> Unassigned, bool CanAssign);

public sealed record RecordOccArrivalRequest(string AircraftRegistration, DateTimeOffset? ArrivedAt);

public sealed record AssignOccStandRequest(Guid StandId, string? Reason);
