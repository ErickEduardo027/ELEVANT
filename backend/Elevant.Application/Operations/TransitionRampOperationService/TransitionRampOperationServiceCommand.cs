using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations.TransitionRampOperationService;

/// <summary>
/// A service transition from the tablet. <c>OccurredAt</c> is when the agent recorded it (3-I); null, as the first
/// version of the app sends it, records the server's time.
/// </summary>
public sealed record TransitionRampOperationServiceCommand(
    Guid AccountId,
    Guid OperationId,
    Guid ServiceId,
    ServiceExecutionStatus TargetStatus,
    decimal? ExecutedQuantity,
    string? Note,
    Guid InstallationId,
    Guid IdempotencyKey,
    Guid CorrelationId,
    string? RequestId,
    DateTimeOffset? OccurredAt = null);
