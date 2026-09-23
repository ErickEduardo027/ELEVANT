using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations.TransitionRampOperationService;

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
    string? RequestId);
