using System.Text.RegularExpressions;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations;

/// <summary>A recorded Flight Report milestone of an operation.</summary>
public sealed record RampMilestoneData(string Code, DateTimeOffset ActualAt);

/// <summary>Flight data the agent captures once (ADR-0031); every form reads it from here.</summary>
public sealed record RampFlightData(int? PassengersIn, int? PassengersOut, int? MtowKg);

public sealed record RampMilestoneWriteRequest(Guid ActorAccountId, IReadOnlyCollection<Guid> AllowedStationIds,
    Guid OperationId, string Code, DateTimeOffset OccurredAt, Guid InstallationId, Guid IdempotencyKey,
    string? RequestId);

/// <summary>
/// Flight data typed once on the ramp (ADR-0031). The registration correction propagates to the turnaround; the
/// aircraft type (3-B) too, and null keeps the current one, so an older tablet's command keeps its meaning and its
/// receipt hash.
/// </summary>
public sealed record RampFlightDataWriteRequest(Guid ActorAccountId, IReadOnlyCollection<Guid> AllowedStationIds,
    Guid OperationId, int? PassengersIn, int? PassengersOut, int? MtowKg, string? AircraftRegistration,
    Guid InstallationId, Guid IdempotencyKey, string? RequestId, Guid? AircraftTypeId = null);

/// <summary>What the tablet gets back: the operation's milestones and flight data after the write.</summary>
public sealed record RampExecutionData(Guid ReceiptId, Guid OperationId, IReadOnlyList<RampMilestoneData> Milestones,
    RampFlightData FlightData, string? AircraftRegistration);

public enum RampExecutionWriteFailure { Forbidden, NotFound, Conflict, IdempotencyKeyConflict }

/// <param name="Data">The operation's milestones and flight data after the write.</param>
/// <param name="Failure">Why the write was refused.</param>
/// <param name="CommitReceiptId">The device receipt the write committed with.</param>
/// <param name="Code">
/// The stable Problem Details code of a rejection the tablet explains (<c>aircraft_type_unavailable</c>,
/// <c>aircraft_type_locked</c>, 3-B); a replay of the rejected command answers the same one.
/// </param>
public sealed record RampExecutionWriteResult(RampExecutionData? Data, RampExecutionWriteFailure? Failure, Guid? CommitReceiptId,
    string? Code = null)
{
    public bool IsSuccess => Data is not null;

    public static RampExecutionWriteResult Success(RampExecutionData data, Guid receiptId) => new(data, null, receiptId);

    public static RampExecutionWriteResult Failed(RampExecutionWriteFailure failure, Guid? receiptId = null,
        string? code = null) => new(null, failure, receiptId, code);
}

/// <summary>The codes of the Flight Report rejections a tablet can act on (3-B).</summary>
public static class RampExecutionCodes
{
    /// <summary>The aircraft type is unknown or inactive in the catalog.</summary>
    public const string AircraftTypeUnavailable = "aircraft_type_unavailable";

    /// <summary>The operation was already submitted once: its aircraft type is evidence.</summary>
    public const string AircraftTypeLocked = "aircraft_type_locked";

    public static bool IsExplained(string? code) => code is AircraftTypeUnavailable or AircraftTypeLocked;
}

public interface IRampExecutionCommandStore
{
    Task<RampExecutionWriteResult> RecordMilestoneAsync(RampMilestoneWriteRequest request,
        CancellationToken cancellationToken = default);

    Task<RampExecutionWriteResult> UpdateFlightDataAsync(RampFlightDataWriteRequest request,
        CancellationToken cancellationToken = default);
}

/// <summary>Rules of the Flight Report capture on the ramp (ADR-0031).</summary>
public static partial class RampExecutionPolicy
{
    /// <summary>The tablet may queue a tap offline for this long before it reaches the server.</summary>
    public static readonly TimeSpan MaxOfflineDelay = TimeSpan.FromHours(24);

    /// <summary>Clock skew tolerated between the tablet and the server.</summary>
    public static readonly TimeSpan FutureTolerance = TimeSpan.FromMinutes(2);

    [GeneratedRegex("^[A-Z0-9-]{2,10}$")]
    private static partial Regex Registration();

    public static bool IsValidRegistration(string? value) => value is null || Registration().IsMatch(value);

    public static bool HasValidFlightData(int? passengersIn, int? passengersOut, int? mtowKg, string? registration) =>
        passengersIn is null or (>= 0 and <= 999) &&
        passengersOut is null or (>= 0 and <= 999) &&
        mtowKg is null or (>= 1_000 and <= 700_000) &&
        IsValidRegistration(registration);

    /// <summary>A milestone belongs to a started, not yet submitted operation, at a plausible time.</summary>
    public static bool CanRecordMilestone(TurnaroundStatus turnaroundStatus, GroundOperationStatus operationStatus,
        DateTimeOffset? actualStartAt, DateTimeOffset? actualEndAt, DateTimeOffset occurredAt, DateTimeOffset now) =>
        RampOperationExecutionPolicy.CanExecute(turnaroundStatus, operationStatus, actualStartAt, actualEndAt) &&
        occurredAt <= now + FutureTolerance && occurredAt >= now - MaxOfflineDelay;

    public static bool CanUpdateFlightData(TurnaroundStatus turnaroundStatus, GroundOperationStatus operationStatus,
        DateTimeOffset? actualStartAt, DateTimeOffset? actualEndAt) =>
        RampOperationExecutionPolicy.CanExecute(turnaroundStatus, operationStatus, actualStartAt, actualEndAt);
}

/// <summary>Milestones and flight data from the tablet: shape, actor and station checks, then the store.</summary>
public sealed class RampExecutionHandler(IActorContextResolver actors, IRampExecutionCommandStore store)
{
    public async Task<(RampExecutionData? Data, RampOperationsFailure? Failure, string? Code)> RecordMilestoneAsync(Guid accountId,
        Guid operationId, string? code, DateTimeOffset occurredAt, Guid installationId, Guid idempotencyKey, string? requestId,
        CancellationToken cancellationToken = default)
    {
        if (accountId == Guid.Empty) return (null, RampOperationsFailure.Unauthorized, null);
        if (operationId == Guid.Empty || installationId == Guid.Empty || idempotencyKey == Guid.Empty ||
            !FlightReportMilestones.IsKnown(code))
            return (null, RampOperationsFailure.InvalidRequest, null);
        var (stations, failure) = await StationsAsync(accountId, cancellationToken);
        if (failure is not null) return (null, failure, null);
        return Map(await store.RecordMilestoneAsync(new RampMilestoneWriteRequest(accountId, stations!, operationId, code!,
            occurredAt.ToUniversalTime(), installationId, idempotencyKey, requestId), cancellationToken));
    }

    /// <summary>
    /// Passengers, MTOW, the registration correction and the aircraft type the agent sees on the ramp (3-B); a null
    /// aircraft type keeps the current one.
    /// </summary>
    public async Task<(RampExecutionData? Data, RampOperationsFailure? Failure, string? Code)> UpdateFlightDataAsync(Guid accountId,
        Guid operationId, int? passengersIn, int? passengersOut, int? mtowKg, string? registration, Guid? aircraftTypeId,
        Guid installationId, Guid idempotencyKey, string? requestId, CancellationToken cancellationToken = default)
    {
        if (accountId == Guid.Empty) return (null, RampOperationsFailure.Unauthorized, null);
        var normalized = string.IsNullOrWhiteSpace(registration) ? null : registration.Trim().ToUpperInvariant();
        if (operationId == Guid.Empty || installationId == Guid.Empty || idempotencyKey == Guid.Empty ||
            aircraftTypeId == Guid.Empty ||
            !RampExecutionPolicy.HasValidFlightData(passengersIn, passengersOut, mtowKg, normalized))
            return (null, RampOperationsFailure.InvalidRequest, null);
        var (stations, failure) = await StationsAsync(accountId, cancellationToken);
        if (failure is not null) return (null, failure, null);
        return Map(await store.UpdateFlightDataAsync(new RampFlightDataWriteRequest(accountId, stations!, operationId,
            passengersIn, passengersOut, mtowKg, normalized, installationId, idempotencyKey, requestId, aircraftTypeId),
            cancellationToken));
    }

    private async Task<(Guid[]? Stations, RampOperationsFailure? Failure)> StationsAsync(Guid accountId,
        CancellationToken cancellationToken)
    {
        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        if (!ActorContextValidator.IsValid(actor, accountId)) return (null, RampOperationsFailure.Unauthorized);
        if (!RampOperationsAccess.IsAuthorized(actor!)) return (null, RampOperationsFailure.Forbidden);
        var stations = actor!.StationScopes.Select(scope => scope.StationId).Where(id => id != Guid.Empty).Distinct().ToArray();
        return stations.Length == 0 ? (null, RampOperationsFailure.NotFound) : (stations, null);
    }

    private static (RampExecutionData?, RampOperationsFailure?, string?) Map(RampExecutionWriteResult result) => result.IsSuccess
        ? (result.Data, null, null)
        : (null, result.Failure switch
        {
            RampExecutionWriteFailure.Forbidden => RampOperationsFailure.Forbidden,
            RampExecutionWriteFailure.NotFound => RampOperationsFailure.NotFound,
            _ => RampOperationsFailure.Conflict,
        }, RampExecutionCodes.IsExplained(result.Code) ? result.Code : null);
}
