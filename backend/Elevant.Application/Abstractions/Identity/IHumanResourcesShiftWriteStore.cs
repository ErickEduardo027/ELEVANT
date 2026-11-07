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

public enum HumanResourcesShiftWriteFailure
{
    Forbidden, Invalid, Conflict,
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
}
