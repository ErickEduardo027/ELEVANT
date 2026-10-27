namespace Elevant.Contracts.Operations;

public sealed record OccPositionTurnaroundResponse(Guid TurnaroundId, string OperationCode, string AirlineName,
    string? AircraftRegistration, string? ArrivalFlightNumber, string? DepartureFlightNumber,
    DateTimeOffset? ArrivalScheduledAt, DateTimeOffset? ArrivedAt, DateTimeOffset? DepartureScheduledAt,
    DateTimeOffset? AssignedFrom, string Status);

public sealed record OccPositionResponse(Guid StandId, string Code, string? TerminalCode, string? StandType, string Status,
    IReadOnlyList<OccPositionTurnaroundResponse> Turnarounds);

public sealed record OccPositionBoardResponse(Guid StationId, string StationCode, DateOnly OperationDate, DateTimeOffset AsOf,
    IReadOnlyList<OccPositionResponse> Positions, IReadOnlyList<OccPositionTurnaroundResponse> Unassigned, bool CanAssign);

public sealed record RecordOccArrivalRequest(string AircraftRegistration, DateTimeOffset? ArrivedAt);

public sealed record AssignOccStandRequest(Guid StandId, string? Reason);
