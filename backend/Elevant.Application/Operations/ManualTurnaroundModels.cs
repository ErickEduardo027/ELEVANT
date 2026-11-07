namespace Elevant.Application.Operations;

public sealed record ManualTurnaroundWriteRequest(
    Guid ActorAccountId,
    IReadOnlyCollection<Guid> AllowedStationIds,
    Guid TurnaroundId,
    Guid StationId,
    Guid AirlineId,
    Guid StandId,
    DateOnly OperationDate,
    string ArrivalFlightNumber,
    string ArrivalOriginIata,
    DateTimeOffset ArrivalScheduledAt,
    string DepartureFlightNumber,
    string DepartureDestinationIata,
    DateTimeOffset DepartureScheduledAt,
    Guid CorrelationId,
    string RequestId,
    bool Charter = false,
    Guid? AircraftTypeId = null);

public enum ManualTurnaroundWriteFailure
{
    NotFound,
    Conflict,
}

/// <summary>
/// The written turnaround, or the failure and its stable Problem Details code when the screens explain it
/// (<c>aircraft_type_unavailable</c>, <c>stand_unavailable</c>).
/// </summary>
public sealed record ManualTurnaroundWriteResult(
    Guid? TurnaroundId,
    string? OperationCode,
    bool Replayed,
    ManualTurnaroundWriteFailure? Failure,
    string? Code = null)
{
    public bool IsSuccess => TurnaroundId.HasValue && OperationCode is not null && Failure is null;

    public static ManualTurnaroundWriteResult Created(Guid id, string operationCode) =>
        new(id, operationCode, false, null);

    public static ManualTurnaroundWriteResult Existing(Guid id, string operationCode) =>
        new(id, operationCode, true, null);

    public static ManualTurnaroundWriteResult Failed(ManualTurnaroundWriteFailure failure, string? code = null) =>
        new(null, null, false, failure, code);
}
