namespace Elevant.Application.Abstractions.Identity;

public sealed record RecordHumanResourcesAvailabilityInput(
    Guid RampProfileId, DateOnly StartsOn, DateOnly EndsOn,
    string Type, string Reason);

public sealed record ResolveHumanResourcesAvailabilityInput(
    string Decision, string? Note);

public sealed record HumanResourcesAvailabilityWritten(Guid Id, string Status);

public enum HumanResourcesAvailabilityWriteFailure
{
    Forbidden, Invalid, Conflict,
}

public sealed record HumanResourcesAvailabilityWriteResult(
    HumanResourcesAvailabilityWritten? Request,
    HumanResourcesAvailabilityWriteFailure? Failure)
{
    public static HumanResourcesAvailabilityWriteResult Success(Guid id, string status) =>
        new(new HumanResourcesAvailabilityWritten(id, status), null);

    public static HumanResourcesAvailabilityWriteResult Failed(
        HumanResourcesAvailabilityWriteFailure failure) => new(null, failure);
}

public interface IHumanResourcesAvailabilityWriteStore
{
    Task<HumanResourcesAvailabilityWriteResult> RecordAsync(Guid actorId, Guid requestId,
        RecordHumanResourcesAvailabilityInput input,
        CancellationToken cancellationToken = default);

    Task<HumanResourcesAvailabilityWriteResult> ResolveAsync(Guid actorId, Guid requestId,
        ResolveHumanResourcesAvailabilityInput input,
        CancellationToken cancellationToken = default);
}
