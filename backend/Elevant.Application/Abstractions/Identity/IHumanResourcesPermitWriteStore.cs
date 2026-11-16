namespace Elevant.Application.Abstractions.Identity;

public sealed record RecordHumanResourcesPermitInput(
    Guid RampProfileId, string DocumentType, Guid? ExpectedCurrentId,
    string DocumentNumber, DateOnly IssuedOn, DateOnly ExpiresOn);

public sealed record HumanResourcesPermitRecorded(Guid Id, int CycleNumber);

public enum HumanResourcesPermitWriteFailure
{
    Forbidden, Invalid, NotFound, Conflict,
}

public sealed record HumanResourcesPermitWriteResult(
    HumanResourcesPermitRecorded? Permit, HumanResourcesPermitWriteFailure? Failure)
{
    public static HumanResourcesPermitWriteResult Success(Guid id, int cycleNumber) =>
        new(new HumanResourcesPermitRecorded(id, cycleNumber), null);

    public static HumanResourcesPermitWriteResult Failed(
        HumanResourcesPermitWriteFailure failure) => new(null, failure);
}

public interface IHumanResourcesPermitWriteStore
{
    Task<HumanResourcesPermitWriteResult> RecordAsync(Guid actorId, Guid permitId,
        RecordHumanResourcesPermitInput input, CancellationToken cancellationToken = default);
}
