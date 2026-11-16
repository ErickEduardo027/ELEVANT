namespace Elevant.Application.Operations;

public sealed record OccShiftWriteRequest(
    Guid ActorAccountId,
    IReadOnlyCollection<Guid> AllowedStationIds,
    Guid TurnaroundId,
    Guid AgentId,
    TimeOnly StartsAtLocal,
    TimeOnly EndsAtLocal,
    Guid CorrelationId,
    string RequestId);

public enum OccShiftWriteFailure { NotFound, Conflict }

/// <summary>
/// Outcome of «Programar turno»; <paramref name="Code"/> names the rule a conflict broke when the screen can act on it:
/// <c>shift_day_taken</c> when the agent already has another shift that day, which OCC adjusts instead (3-E).
/// </summary>
public sealed record OccShiftWriteResult(Guid? ShiftId, bool Replayed, OccShiftWriteFailure? Failure, string? Code = null)
{
    public bool IsSuccess => ShiftId.HasValue && Failure is null;
    public static OccShiftWriteResult Created(Guid id) => new(id, false, null);
    public static OccShiftWriteResult Existing(Guid id) => new(id, true, null);
    public static OccShiftWriteResult Failed(OccShiftWriteFailure failure, string? code = null) => new(null, false, failure, code);
}

/// <summary>The shift of one agent on the day of a flight, as OCC reads it to adjust it (3-E).</summary>
public sealed record OccAgentShiftReadRequest(
    Guid ActorAccountId,
    IReadOnlyCollection<Guid> AllowedStationIds,
    Guid TurnaroundId,
    Guid AgentId);

/// <summary>
/// The agent's shift on the flight's day, in the station's local time (3-E); <paramref name="Version"/> is the shift's
/// rowversion in base64: the expected version of «Ajustar turno».
/// </summary>
public sealed record OccAgentShiftData(
    Guid ShiftId,
    Guid AgentId,
    DateOnly WorkDate,
    TimeOnly StartsAtLocal,
    TimeOnly EndsAtLocal,
    string TerminalCode,
    string Version);

/// <summary><c>ShiftNotFound</c>: the flight is in scope but the agent has no shift that day at its station.</summary>
public enum OccAgentShiftReadFailure { NotFound, ShiftNotFound }

public sealed record OccAgentShiftReadResult(OccAgentShiftData? Shift, OccAgentShiftReadFailure? Failure)
{
    public static OccAgentShiftReadResult Found(OccAgentShiftData shift) => new(shift, null);
    public static OccAgentShiftReadResult Failed(OccAgentShiftReadFailure failure) => new(null, failure);
}
