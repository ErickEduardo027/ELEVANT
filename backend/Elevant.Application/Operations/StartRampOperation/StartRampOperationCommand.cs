namespace Elevant.Application.Operations.StartRampOperation;

public sealed record StartRampOperationCommand(
    Guid AccountId,
    Guid OperationId,
    Guid InstallationId,
    Guid IdempotencyKey,
    Guid CorrelationId,
    string? RequestId);
