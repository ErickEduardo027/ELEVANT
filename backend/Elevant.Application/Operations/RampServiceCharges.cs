using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations;

/// <summary>A charge the agent may mark on a service. Prices are never sent to the ramp.</summary>
public sealed record RampChargeOptionData(Guid Id, string Code, string Name, string? Description, string Category,
    bool AllowMultiple);

public sealed record RampAppliedChargeData(Guid Id, Guid ChargeId, string Code, string Name, DateTimeOffset AppliedAt);

public sealed record RampServiceChargesData(Guid ServiceId, bool CanEdit, IReadOnlyList<RampChargeOptionData> Available,
    IReadOnlyList<RampAppliedChargeData> Applied);

public sealed record RampOperationChargesData(Guid OperationId, IReadOnlyList<RampServiceChargesData> Services);

public sealed record RampServiceChargeCommandData(Guid ReceiptId, RampServiceChargesData Service);

public enum RampServiceChargeAction { Apply, Remove }

public sealed record RampServiceChargeWriteRequest(Guid ActorAccountId, IReadOnlyList<Guid> AllowedStationIds,
    Guid OperationId, Guid ServiceId, Guid ChargeId, RampServiceChargeAction Action, Guid InstallationId,
    Guid IdempotencyKey, Guid CorrelationId, string? RequestId);

public sealed record RampServiceChargeWriteResult(RampServiceChargeCommandData? Command,
    RampOperationServiceTransitionWriteFailure? Failure, Guid? CommitReceiptId = null)
{
    public bool IsSuccess => Command is not null && Failure is null;

    public static RampServiceChargeWriteResult Success(RampServiceChargeCommandData command, Guid receiptId) =>
        new(command, null, receiptId);

    public static RampServiceChargeWriteResult Failed(RampOperationServiceTransitionWriteFailure failure,
        Guid? receiptId = null) => new(null, failure, receiptId);
}

/// <summary>
/// Charges are marked while the agent still owns the delivery: services that are in
/// progress or finished (not "not performed") of an operation that has not been
/// submitted, or that was returned for correction.
/// </summary>
public static class RampServiceChargePolicy
{
    public static bool CanEdit(TurnaroundStatus turnaroundStatus, GroundOperationStatus operationStatus,
        DateTimeOffset? actualStartAt, DateTimeOffset? actualEndAt, ServiceExecutionStatus serviceStatus) =>
        RampOperationExecutionPolicy.CanExecute(turnaroundStatus, operationStatus, actualStartAt, actualEndAt) &&
        serviceStatus is ServiceExecutionStatus.InProgress or ServiceExecutionStatus.Completed or
            ServiceExecutionStatus.Exception;
}

public sealed record RampServiceChargeCommand(Guid AccountId, Guid OperationId, Guid ServiceId, Guid ChargeId,
    RampServiceChargeAction Action, Guid InstallationId, Guid IdempotencyKey, Guid CorrelationId, string? RequestId);

public sealed record RampServiceChargeResult(RampServiceChargeCommandData? Command, RampOperationChargesData? Charges,
    RampOperationsFailure? Failure)
{
    public bool IsSuccess => Failure is null;
}

/// <summary>Reads and marks the charges of an assigned operation for the authenticated ramp agent.</summary>
public sealed class RampServiceChargesHandler(
    IActorContextResolver actorContextResolver,
    IRampServiceChargeStore store)
{
    public async Task<RampServiceChargeResult> ReadAsync(Guid accountId, Guid operationId, Guid installationId,
        CancellationToken cancellationToken = default)
    {
        var (stations, failure) = await AuthorizeAsync(accountId, cancellationToken);
        if (failure is not null) return new RampServiceChargeResult(null, null, failure);
        if (operationId == Guid.Empty || installationId == Guid.Empty)
            return new RampServiceChargeResult(null, null, RampOperationsFailure.InvalidRequest);
        var charges = await store.ReadAsync(accountId, stations!, operationId, installationId, cancellationToken);
        return charges is null
            ? new RampServiceChargeResult(null, null, RampOperationsFailure.NotFound)
            : new RampServiceChargeResult(null, charges, null);
    }

    public async Task<RampServiceChargeResult> HandleAsync(RampServiceChargeCommand command,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        var (stations, failure) = await AuthorizeAsync(command.AccountId, cancellationToken);
        if (failure is not null) return new RampServiceChargeResult(null, null, failure);
        if (command.OperationId == Guid.Empty || command.ServiceId == Guid.Empty || command.ChargeId == Guid.Empty ||
            command.InstallationId == Guid.Empty || command.IdempotencyKey == Guid.Empty || !Enum.IsDefined(command.Action))
            return new RampServiceChargeResult(null, null, RampOperationsFailure.InvalidRequest);
        var result = await store.ApplyAsync(new RampServiceChargeWriteRequest(command.AccountId, stations!,
            command.OperationId, command.ServiceId, command.ChargeId, command.Action, command.InstallationId,
            command.IdempotencyKey, command.CorrelationId, command.RequestId), cancellationToken);
        return result.IsSuccess
            ? new RampServiceChargeResult(result.Command, null, null)
            : new RampServiceChargeResult(null, null, result.Failure switch
            {
                RampOperationServiceTransitionWriteFailure.Forbidden => RampOperationsFailure.Forbidden,
                RampOperationServiceTransitionWriteFailure.NotFound => RampOperationsFailure.NotFound,
                _ => RampOperationsFailure.Conflict,
            });
    }

    private async Task<(Guid[]? Stations, RampOperationsFailure? Failure)> AuthorizeAsync(Guid accountId,
        CancellationToken cancellationToken)
    {
        if (accountId == Guid.Empty) return (null, RampOperationsFailure.Unauthorized);
        var actor = await actorContextResolver.ResolveAsync(accountId, cancellationToken);
        if (!ActorContextValidator.IsValid(actor, accountId)) return (null, RampOperationsFailure.Unauthorized);
        if (!RampOperationsAccess.IsAuthorized(actor!)) return (null, RampOperationsFailure.Forbidden);
        var stations = actor!.StationScopes.Select(scope => scope.StationId).Where(id => id != Guid.Empty).Distinct()
            .ToArray();
        return stations.Length == 0 ? (null, RampOperationsFailure.NotFound) : (stations, null);
    }
}
