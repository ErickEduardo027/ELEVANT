namespace Elevant.Application.Operations.GetOccAgentShift;

public sealed record GetOccAgentShiftQuery(Guid AccountId, Guid TurnaroundId, Guid AgentId);
