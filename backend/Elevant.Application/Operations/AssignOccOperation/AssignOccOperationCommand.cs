namespace Elevant.Application.Operations.AssignOccOperation;

public sealed record AssignOccOperationCommand(
    Guid AccountId,
    Guid TurnaroundId,
    Guid AgentId,
    string ExpectedConcurrencyToken,
    Guid CorrelationId,
    string? RequestId);
