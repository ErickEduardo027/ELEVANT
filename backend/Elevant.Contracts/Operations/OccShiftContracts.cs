using System.Text.Json.Serialization;

namespace Elevant.Contracts.Operations;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ProgramOccShiftRequest(
    Guid AgentId,
    TimeOnly StartsAtLocal,
    TimeOnly EndsAtLocal);

public sealed record ProgramOccShiftResponse(
    Guid TurnaroundId,
    Guid ShiftId,
    bool Replayed);

/// <summary>
/// The shift an agent already has on a flight's day (3-E): OCC adjusts it with <c>AdjustHumanResourcesShift</c> and
/// this <c>version</c> instead of programming a second one. Local times of the station.
/// </summary>
public sealed record OccAgentShiftResponse(
    Guid ShiftId,
    Guid AgentId,
    DateOnly WorkDate,
    TimeOnly StartsAtLocal,
    TimeOnly EndsAtLocal,
    string TerminalCode,
    string Version);
