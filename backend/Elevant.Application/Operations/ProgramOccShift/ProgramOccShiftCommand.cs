namespace Elevant.Application.Operations.ProgramOccShift;

public sealed record ProgramOccShiftCommand(
    Guid AccountId,
    Guid TurnaroundId,
    Guid AgentId,
    TimeOnly StartsAtLocal,
    TimeOnly EndsAtLocal,
    Guid CorrelationId,
    string RequestId);
