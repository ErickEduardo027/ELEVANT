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
