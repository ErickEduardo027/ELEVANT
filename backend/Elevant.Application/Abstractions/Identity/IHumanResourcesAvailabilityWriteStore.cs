namespace Elevant.Application.Abstractions.Identity;

public sealed record RecordHumanResourcesAvailabilityInput(
    Guid RampProfileId, DateOnly StartsOn, DateOnly EndsOn,
    string Type, string Reason);

/// <summary>
/// A decision on a pending request. <paramref name="ExpectedVersion"/> is the version the client read; it is
/// optional while older clients exist (expand) and required with an Idempotency-Key.
/// </summary>
public sealed record ResolveHumanResourcesAvailabilityInput(
    string Decision, string? Note, string? ExpectedVersion = null);

/// <summary>
/// 2-N22: <c>Cancel</c> an approved request that has not started, or <c>Shorten</c> it to an earlier last day
/// (<paramref name="EndsOn"/>). Always with a reason and the version the client read.
/// </summary>
public sealed record AmendHumanResourcesAvailabilityInput(
    string Action, DateOnly? EndsOn, string Reason, string ExpectedVersion);

public sealed record HumanResourcesAvailabilityWritten(Guid Id, string Status);

/// <summary>The amended request: its status, its last day and its new version.</summary>
public sealed record HumanResourcesAvailabilityAmended(Guid Id, string Status, DateOnly EndsOn, string Version);

public enum HumanResourcesAvailabilityWriteFailure
{
    Forbidden, Invalid, Conflict, NotFound,
}

/// <summary>Outcome of an availability command; <paramref name="Code"/> names the rule a failure broke.</summary>
public sealed record HumanResourcesAvailabilityWriteResult(
    HumanResourcesAvailabilityWritten? Request,
    HumanResourcesAvailabilityWriteFailure? Failure, string? Code = null)
{
    public static HumanResourcesAvailabilityWriteResult Success(Guid id, string status) =>
        new(new HumanResourcesAvailabilityWritten(id, status), null);

    public static HumanResourcesAvailabilityWriteResult Failed(
        HumanResourcesAvailabilityWriteFailure failure, string? code = null) => new(null, failure, code);
}

public sealed record HumanResourcesAvailabilityAmendmentResult(
    HumanResourcesAvailabilityAmended? Amendment,
    HumanResourcesAvailabilityWriteFailure? Failure, string? Code = null)
{
    public static HumanResourcesAvailabilityAmendmentResult Success(HumanResourcesAvailabilityAmended amendment) =>
        new(amendment, null);

    public static HumanResourcesAvailabilityAmendmentResult Failed(
        HumanResourcesAvailabilityWriteFailure failure, string code) => new(null, failure, code);
}

public interface IHumanResourcesAvailabilityWriteStore
{
    Task<HumanResourcesAvailabilityWriteResult> RecordAsync(Guid actorId, Guid requestId,
        RecordHumanResourcesAvailabilityInput input,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Approves, rejects or cancels a pending request. Approving a day off or a restriction releases the
    /// agent's coverages, unstarted operations and unstarted shifts of those days through the release path
    /// (2-N08), or fails with <c>agent_has_operation_in_progress</c>. The Idempotency-Key is optional (expand).
    /// </summary>
    Task<HumanResourcesAvailabilityWriteResult> ResolveAsync(Guid actorId, Guid requestId,
        ResolveHumanResourcesAvailabilityInput input, Guid? idempotencyKey,
        CancellationToken cancellationToken = default);

    /// <summary>Cancels or shortens an approved request (2-N22); the Idempotency-Key is required.</summary>
    Task<HumanResourcesAvailabilityAmendmentResult> AmendAsync(Guid actorId, Guid requestId,
        AmendHumanResourcesAvailabilityInput input, Guid idempotencyKey,
        CancellationToken cancellationToken = default);
}
