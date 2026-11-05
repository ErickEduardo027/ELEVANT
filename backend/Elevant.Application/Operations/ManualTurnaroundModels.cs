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
    bool Charter = false);

public enum ManualTurnaroundWriteFailure
{
    NotFound,
    Conflict,
}

public sealed record ManualTurnaroundWriteResult(
    Guid? TurnaroundId,
    string? OperationCode,
    bool Replayed,
    ManualTurnaroundWriteFailure? Failure)
{
    public bool IsSuccess => TurnaroundId.HasValue && OperationCode is not null && Failure is null;

    public static ManualTurnaroundWriteResult Created(Guid id, string operationCode) =>
        new(id, operationCode, false, null);

    public static ManualTurnaroundWriteResult Existing(Guid id, string operationCode) =>
        new(id, operationCode, true, null);

    public static ManualTurnaroundWriteResult Failed(ManualTurnaroundWriteFailure failure) =>
        new(null, null, false, failure);
}
