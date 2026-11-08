namespace Elevant.Application.Operations.StartRampOperation;

/// <summary>
/// «Iniciar» from the tablet. <c>StartedAt</c> is when the agent tapped it (3-I); null, as the first version of the
/// app sends it, records the server's time.
/// </summary>
public sealed record StartRampOperationCommand(
    Guid AccountId,
    Guid OperationId,
    Guid InstallationId,
    Guid IdempotencyKey,
    Guid CorrelationId,
    string? RequestId,
    DateTimeOffset? StartedAt = null);
