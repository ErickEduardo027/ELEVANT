namespace Elevant.Application.Abstractions.Identity;

public sealed record RecordHumanResourcesShiftInput(
    Guid RampProfileId, Guid StationId, Guid TerminalId,
    DateOnly WorkDate, TimeOnly StartsAtLocal, TimeOnly EndsAtLocal,
    string? Notes);

public sealed record HumanResourcesShiftRecorded(Guid Id);

public enum HumanResourcesShiftWriteFailure
{
    Forbidden, Invalid, Conflict,
}

public sealed record HumanResourcesShiftWriteResult(
    HumanResourcesShiftRecorded? Shift, HumanResourcesShiftWriteFailure? Failure)
{
    public static HumanResourcesShiftWriteResult Success(Guid id) =>
        new(new HumanResourcesShiftRecorded(id), null);

    public static HumanResourcesShiftWriteResult Failed(
        HumanResourcesShiftWriteFailure failure) => new(null, failure);
}

public interface IHumanResourcesShiftWriteStore
{
    Task<HumanResourcesShiftWriteResult> RecordAsync(Guid actorId, Guid shiftId,
        RecordHumanResourcesShiftInput input, CancellationToken cancellationToken = default);

    /// <summary>
    /// Removes a shift that has not started its day yet (today or later), with the same
    /// permission and station scope as recording it. Past shifts are history and stay.
    /// </summary>
    Task<HumanResourcesShiftWriteResult> RemoveAsync(Guid actorId, Guid shiftId,
        CancellationToken cancellationToken = default);
}
