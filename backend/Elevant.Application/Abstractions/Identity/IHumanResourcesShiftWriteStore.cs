namespace Elevant.Application.Abstractions.Identity;

public sealed record RecordHumanResourcesShiftInput(
    Guid RampProfileId, Guid StationId, Guid TerminalId,
    DateOnly WorkDate, TimeOnly StartsAtLocal, TimeOnly EndsAtLocal,
    string? Notes);

/// <summary>
/// The removal of a shift (2-N11): the version the client read and the Idempotency-Key of the intent. Both are
/// optional while older clients exist (expand); a key needs the version.
/// </summary>
public sealed record RemoveHumanResourcesShiftInput(string? ExpectedVersion, Guid? IdempotencyKey);

public sealed record HumanResourcesShiftRecorded(Guid Id);

/// <summary>
/// The adjustment of a shift's hours (3-E): the new local start and end (an end at or before the start crosses
/// midnight), the reason the audit keeps (5 to 500 characters) and the version the client read.
/// </summary>
public sealed record AdjustHumanResourcesShiftInput(TimeOnly StartsAtLocal, TimeOnly EndsAtLocal, string? Reason,
    string? ExpectedVersion);

/// <summary>The shift after the adjustment, with its new version.</summary>
public sealed record HumanResourcesShiftAdjusted(Guid Id, TimeOnly StartsAtLocal, TimeOnly EndsAtLocal, string Version);

/// <summary>Outcome of an adjustment; <paramref name="Code"/> names the rule a failure broke.</summary>
public sealed record HumanResourcesShiftAdjustResult(HumanResourcesShiftAdjusted? Shift,
    HumanResourcesShiftWriteFailure? Failure, string? Code = null, bool Replayed = false)
{
    public static HumanResourcesShiftAdjustResult Success(HumanResourcesShiftAdjusted shift, bool replayed = false) =>
        new(shift, null, null, replayed);

    public static HumanResourcesShiftAdjustResult Failed(HumanResourcesShiftWriteFailure failure, string code) =>
        new(null, failure, code);
}

public enum HumanResourcesShiftWriteFailure
{
    Forbidden, Invalid, Conflict, NotFound,
}

/// <summary>Outcome of a shift command; <paramref name="Code"/> names the rule a failure broke.</summary>
public sealed record HumanResourcesShiftWriteResult(
    HumanResourcesShiftRecorded? Shift, HumanResourcesShiftWriteFailure? Failure, string? Code = null)
{
    public static HumanResourcesShiftWriteResult Success(Guid id) =>
        new(new HumanResourcesShiftRecorded(id), null);

    public static HumanResourcesShiftWriteResult Failed(
        HumanResourcesShiftWriteFailure failure, string? code = null) => new(null, failure, code);
}

public interface IHumanResourcesShiftWriteStore
{
    /// <summary>
    /// Records a shift; the route id is the intent (the same id and body replay it). A day of an approved
    /// absence takes no shift (<c>shift_on_approved_absence</c>, 2-N24).
    /// </summary>
    Task<HumanResourcesShiftWriteResult> RecordAsync(Guid actorId, Guid shiftId,
        RecordHumanResourcesShiftInput input, CancellationToken cancellationToken = default);

    /// <summary>
    /// Removes a shift of today or later in its station's calendar, with the same permission and station scope
    /// as recording it. Past shifts are history (<c>shift_in_past</c>), and a shift whose agent already covers
    /// stands or carries operations in it stays (<c>shift_in_use</c>, 2-N11).
    /// </summary>
    Task<HumanResourcesShiftWriteResult> RemoveAsync(Guid actorId, Guid shiftId,
        RemoveHumanResourcesShiftInput input, CancellationToken cancellationToken = default);

    /// <summary>
    /// Adjusts the hours of a shift of today or later in its station's calendar (3-E), for Gestión Humana and OCC with
    /// the same permission and station scope as recording it. The Idempotency-Key is required; the same key and body
    /// replay the result, another body is <c>idempotency_conflict</c>; a stale version is <c>version_conflict</c>. The
    /// adjusted shift keeps covering the agent's coverages and operations in it (<c>shift_uncovers_work</c>); a past
    /// shift (<c>shift_in_past</c>) or one whose attendance was validated (<c>attendance_validated</c>) stays.
    /// </summary>
    Task<HumanResourcesShiftAdjustResult> AdjustAsync(Guid actorId, Guid shiftId, AdjustHumanResourcesShiftInput input,
        Guid? idempotencyKey, CancellationToken cancellationToken = default);
}
